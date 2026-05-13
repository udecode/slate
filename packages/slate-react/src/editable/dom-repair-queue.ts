import { RangeApi } from 'slate'
import { type DOMRange, getSelection, isDOMElement, isDOMText } from 'slate-dom'
import {
  getSlateNodeElementByPath,
  getSlateNodePathFromDOMElement,
} from '../hooks/use-slate-node-ref'
import { ReactEditor } from '../plugin/react-editor'
import type { EditableRepairPolicy } from './editing-kernel'
import {
  getCurrentEditableEventFrame,
  recordEditableKernelTrace,
} from './editing-kernel'
import { getNativeTextInputHistoryMetadata } from './input-history'
import type { EditableInputController } from './input-state'
import { readRuntimeText } from './runtime-live-state'
import { readRuntimeSelection } from './runtime-selection-state'
import { shouldSkipSelectionScroll } from './selection-side-effect-policy'

export type DOMInputRepair = {
  data: string | null
  inputType: string
}

export type DOMRepairQueue = {
  beginFrame: (frameId: number) => void
  cancelBefore: (frameId: number) => void
  repairDOMInput: (
    nativeInput: DOMInputRepair,
    rootElement: HTMLElement,
    frameId?: number | null
  ) => void
  repair: (repairPolicy: EditableRepairPolicy) => void
  repairCaretAfterModelOperation: (
    kind?: 'repair-caret' | 'repair-caret-after-text-insert'
  ) => void
  repairCaretAfterModelTextInsert: () => void
}

export type DOMRepairFrameState = {
  cancelledBeforeFrameId: number
  currentFrameId: number | null
}

export const createDOMRepairFrameState = (): DOMRepairFrameState => ({
  cancelledBeforeFrameId: 0,
  currentFrameId: null,
})

export const beginDOMRepairFrame = (
  state: DOMRepairFrameState,
  frameId: number
) => {
  state.currentFrameId = frameId
}

export const cancelDOMRepairBefore = (
  state: DOMRepairFrameState,
  frameId: number
) => {
  state.cancelledBeforeFrameId = Math.max(state.cancelledBeforeFrameId, frameId)
}

export const isDOMRepairFrameCurrent = (
  state: DOMRepairFrameState,
  frameId: number
) => state.currentFrameId === frameId && frameId >= state.cancelledBeforeFrameId

export const createDOMRepairQueue = ({
  editor,
  inputController,
  scrollSelectionIntoView,
}: {
  editor: ReactEditor
  inputController: EditableInputController
  scrollSelectionIntoView: (editor: ReactEditor, domRange: DOMRange) => void
  syncDOMSelectionToEditor: () => void
}): DOMRepairQueue => {
  const frameState = createDOMRepairFrameState()

  return {
    beginFrame(frameId) {
      beginDOMRepairFrame(frameState, frameId)
    },

    cancelBefore(frameId) {
      cancelDOMRepairBefore(frameState, frameId)
    },

    repairDOMInput(nativeInput, rootElement, repairFrameId) {
      const frameId =
        repairFrameId ?? getCurrentEditableEventFrame(editor)?.id ?? null

      if (frameId !== null) {
        beginDOMRepairFrame(frameState, frameId)
      }

      if (frameId !== null && !isDOMRepairFrameCurrent(frameState, frameId)) {
        return
      }

      const modelText = editor.read((state) => state.text.string([]))
      const domText =
        rootElement.textContent?.replace(/\uFEFF/g, '') ?? modelText

      if (
        nativeInput.inputType !== 'insertText' ||
        typeof nativeInput.data !== 'string' ||
        nativeInput.data.length === 0
      ) {
        return
      }

      if (domText === modelText && modelText.includes(nativeInput.data)) {
        this.repairCaretAfterModelTextInsert()
        return
      }

      if (frameId !== null && !isDOMRepairFrameCurrent(frameState, frameId)) {
        return
      }

      const inputText = nativeInput.data
      const root = ReactEditor.findDocumentOrShadowRoot(editor)
      const domSelection = getSelection(root)
      const anchorNode = domSelection?.anchorNode ?? null
      const anchorOffset = domSelection?.anchorOffset ?? null
      const textHost = isDOMText(anchorNode)
        ? anchorNode.parentElement?.closest('[data-slate-node="text"]')
        : isDOMElement(anchorNode)
          ? anchorNode.closest('[data-slate-node="text"]')
          : null
      const path = textHost ? getSlateNodePathFromDOMElement(textHost) : null
      const slateNode = path ? readRuntimeText(editor, path) : null

      if (slateNode && anchorOffset != null && path) {
        const offset = Math.max(
          0,
          Math.min(slateNode.text.length, anchorOffset - inputText.length)
        )
        const nextOffset = offset + inputText.length
        editor.update(
          (tx) => {
            tx.text.insert(inputText, { at: { path, offset } })
            tx.selection.set({
              anchor: { path, offset: nextOffset },
              focus: { path, offset: nextOffset },
            })
          },
          { metadata: getNativeTextInputHistoryMetadata(editor) }
        )

        this.repairCaretAfterModelTextInsert()
      }
    },

    repair(repairPolicy) {
      if (repairPolicy.kind === 'repair-caret') {
        this.repairCaretAfterModelOperation(
          repairPolicy.reason === 'repair-caret-after-text-insert'
            ? 'repair-caret-after-text-insert'
            : 'repair-caret'
        )
      }
    },

    repairCaretAfterModelOperation(
      kind: 'repair-caret' | 'repair-caret-after-text-insert' = 'repair-caret'
    ) {
      const frameId = getCurrentEditableEventFrame(editor)?.id ?? null

      if (frameId !== null) {
        beginDOMRepairFrame(frameState, frameId)
      }

      const isCurrentRepairFrame = () =>
        frameId === null || isDOMRepairFrameCurrent(frameState, frameId)
      const selectionBefore = readRuntimeSelection(editor)
      recordEditableKernelTrace({
        editor,
        trace: {
          command: null,
          eventFamily: 'repair',
          intent: null,
          nativeAllowed: false,
          ownership: 'model-owned',
          repair: { kind },
          selectionChangeOrigin: 'repair-induced',
          selectionBefore,
          selectionSource: 'model-owned',
          stateAfter: 'repairing',
          stateBefore: 'model-owned',
          targetOwner: 'editor',
        },
      })
      const repairCollapsedSelectionByPath = () => {
        if (!isCurrentRepairFrame()) {
          return
        }

        const scrollCurrentDOMSelectionIntoView = () => {
          let root: Document | ShadowRoot

          try {
            root = ReactEditor.findDocumentOrShadowRoot(editor)
          } catch {
            return false
          }

          const domSelection = getSelection(root)
          const anchorNode = domSelection?.anchorNode ?? null
          const focusNode = domSelection?.focusNode ?? null

          if (
            !domSelection ||
            domSelection.rangeCount === 0 ||
            !ReactEditor.hasSelectableTarget(editor, anchorNode) ||
            !ReactEditor.hasSelectableTarget(editor, focusNode)
          ) {
            return false
          }

          if (!shouldSkipSelectionScroll(editor)) {
            scrollSelectionIntoView(editor, domSelection.getRangeAt(0))
          }
          return true
        }

        const selection = readRuntimeSelection(editor)

        if (!selection || !RangeApi.isCollapsed(selection)) {
          scrollCurrentDOMSelectionIntoView()
          return
        }

        const { path, offset: slateOffset } = selection.anchor
        const textHost = getSlateNodeElementByPath(editor, path)

        if (!textHost) {
          scrollCurrentDOMSelectionIntoView()
          return
        }

        const root = ReactEditor.findDocumentOrShadowRoot(editor)
        const domSelection = getSelection(root)

        if (!domSelection) {
          return
        }

        const strings = Array.from(
          textHost.querySelectorAll(
            '[data-slate-string], [data-slate-zero-width]'
          )
        )
        let offset = 0

        for (const string of strings) {
          const textNode = Array.from(string.childNodes).find(isDOMText)
          const lengthAttribute = string.getAttribute('data-slate-length')
          const length =
            lengthAttribute == null
              ? (textNode?.textContent?.length ??
                string.textContent?.length ??
                0)
              : Number.parseInt(lengthAttribute, 10)
          const nextOffset = offset + (Number.isFinite(length) ? length : 0)

          if (slateOffset <= nextOffset) {
            const zeroWidthOffset =
              textNode?.textContent?.startsWith('\uFEFF') ||
              string.textContent === '\uFEFF'
                ? 1
                : 0
            const domOffset = string.hasAttribute('data-slate-zero-width')
              ? zeroWidthOffset
              : Math.max(0, Math.min(slateOffset - offset, length))

            const domNode = textNode ?? string
            const domRange = domNode.ownerDocument.createRange()

            domRange.setStart(domNode, domOffset)
            domRange.setEnd(domNode, domOffset)

            inputController.state.selectionChangeOrigin = 'repair-induced'
            domSelection.setBaseAndExtent(
              domNode,
              domOffset,
              domNode,
              domOffset
            )
            if (!shouldSkipSelectionScroll(editor)) {
              scrollSelectionIntoView(editor, domRange)
            }
            return
          }

          offset = nextOffset
        }

        scrollCurrentDOMSelectionIntoView()
      }

      const retry = (remainingRetries: number) => {
        requestAnimationFrame(() => {
          if (!isCurrentRepairFrame()) {
            return
          }

          repairCollapsedSelectionByPath()
          if (remainingRetries > 0) {
            setTimeout(() => retry(remainingRetries - 1), 25)
          }
        })
      }

      repairCollapsedSelectionByPath()
      queueMicrotask(repairCollapsedSelectionByPath)
      setTimeout(repairCollapsedSelectionByPath)
      retry(8)
    },

    repairCaretAfterModelTextInsert() {
      this.repair({
        kind: 'repair-caret',
        reason: 'repair-caret-after-text-insert',
      })
    },
  }
}
