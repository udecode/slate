import { type Path, PathApi, RangeApi } from 'slate'
import { type DOMRange, getSelection, isDOMElement, isDOMText } from 'slate-dom'
import {
  getSlateNodeElementByPath,
  getSlateNodePathFromDOMElement,
} from '../hooks/use-slate-node-ref'
import { ReactEditor, type ReactRuntimeEditor } from '../plugin/react-editor'
import type { EditableRepairPolicy } from './editing-kernel'
import {
  getCurrentEditableEventFrame,
  recordEditableKernelTrace,
} from './editing-kernel'
import { getNativeTextInputHistoryMetadata } from './input-history'
import type { EditableInputController } from './input-state'
import { getNativeTextInsertDelta } from './native-text-input-delta'
import { readRuntimeText } from './runtime-live-state'
import { readRuntimeSelection } from './runtime-selection-state'
import {
  armModelOwnedTextInputGuard,
  setEditableModelSelectionPreference,
} from './selection-controller'
import { shouldSkipSelectionScroll } from './selection-side-effect-policy'

export type DOMInputRepair = {
  data: string | null
  inputType: string
  target?: {
    insert?: {
      offset: number
      text: string
    }
    path: Path
    preferCapturedInsert?: boolean
    selectionOffset: number
    text: string
  } | null
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
  if (frameId < state.cancelledBeforeFrameId) {
    return
  }

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

const applyTextInsert = (
  text: string,
  insert: {
    offset: number
    text: string
  }
) => text.slice(0, insert.offset) + insert.text + text.slice(insert.offset)

const REPAIR_INDUCED_SELECTION_ORIGIN_GUARD_MS = 150

const getDOMTextRepairInsert = ({
  inputText,
  preferCapturedInsert,
  selectionOffset,
  slateText,
  targetInsert,
  textHostText,
}: {
  inputText: string
  preferCapturedInsert?: boolean
  selectionOffset: number
  slateText: string
  targetInsert?: {
    offset: number
    text: string
  }
  textHostText: string
}) => {
  const clampedTargetInsert = targetInsert
    ? {
        offset: Math.max(0, Math.min(slateText.length, targetInsert.offset)),
        text: targetInsert.text,
      }
    : null

  if (clampedTargetInsert && preferCapturedInsert) {
    return clampedTargetInsert
  }

  const insert = getNativeTextInsertDelta({
    inputText,
    selectionOffset,
    slateText,
    textHostText,
  })

  if (applyTextInsert(slateText, insert) === textHostText) {
    return insert
  }

  if (clampedTargetInsert) {
    return clampedTargetInsert
  }

  return insert
}

const getTextHostSelectionOffset = ({
  anchorNode,
  anchorOffset,
  textHost,
}: {
  anchorNode: Node | null
  anchorOffset: number | null
  textHost: Element
}) => {
  if (anchorOffset == null || !anchorNode) {
    return null
  }

  const strings = Array.from(
    textHost.querySelectorAll('[data-slate-string], [data-slate-zero-width]')
  )
  let offset = 0

  for (const string of strings) {
    const textNode = Array.from(string.childNodes).find(isDOMText)
    const lengthAttribute = string.getAttribute('data-slate-length')
    const length =
      lengthAttribute == null
        ? (textNode?.textContent?.length ?? string.textContent?.length ?? 0)
        : Number.parseInt(lengthAttribute, 10)
    const safeLength = Number.isFinite(length) ? length : 0

    if (anchorNode === textNode || string.contains(anchorNode)) {
      return offset + Math.max(0, Math.min(anchorOffset, safeLength))
    }

    offset += safeLength
  }

  return null
}

const isInsideVirtualizedDOM = (element: Element) =>
  !!element.closest(
    [
      '[data-slate-dom-strategy-virtual-row="true"]',
      '[data-slate-dom-strategy-virtualizer="true"]',
      '[data-slate-paged-editable-page-virtualization="true"]',
    ].join(',')
  )

export const createDOMRepairQueue = ({
  editor,
  inputController,
  scrollSelectionIntoView,
}: {
  editor: ReactRuntimeEditor
  inputController: EditableInputController
  scrollSelectionIntoView: (
    editor: ReactRuntimeEditor,
    domRange: DOMRange
  ) => void
  syncDOMSelectionToEditor: () => void
}): DOMRepairQueue => {
  const frameState = createDOMRepairFrameState()
  const armRepairInducedSelectionOriginGuard = () => {
    const repairOriginVersion =
      (inputController.state.repairInducedSelectionOriginVersion ?? 0) + 1

    inputController.state.repairInducedSelectionOriginVersion =
      repairOriginVersion
    inputController.state.selectionChangeOrigin = 'repair-induced'
    setTimeout(() => {
      if (
        inputController.state.repairInducedSelectionOriginVersion ===
          repairOriginVersion &&
        inputController.state.selectionChangeOrigin === 'repair-induced'
      ) {
        inputController.state.selectionChangeOrigin = null
      }
    }, REPAIR_INDUCED_SELECTION_ORIGIN_GUARD_MS)
  }

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

      if (
        nativeInput.inputType !== 'insertText' ||
        typeof nativeInput.data !== 'string' ||
        nativeInput.data.length === 0
      ) {
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
      let textHost = isDOMText(anchorNode)
        ? anchorNode.parentElement?.closest('[data-slate-node="text"]')
        : isDOMElement(anchorNode)
          ? anchorNode.closest('[data-slate-node="text"]')
          : null
      let path = textHost ? getSlateNodePathFromDOMElement(textHost) : null
      let slateNode = path ? readRuntimeText(editor, path) : null
      let selectionOffset =
        textHost && anchorOffset != null
          ? getTextHostSelectionOffset({ anchorNode, anchorOffset, textHost })
          : null
      let textHostText = textHost?.textContent?.replace(/\uFEFF/g, '') ?? null
      const liveDOMTextHost = textHost
      const liveDOMPath = path
      const liveDOMSelectionOffset = selectionOffset

      if (nativeInput.target) {
        path = nativeInput.target.path
        slateNode = readRuntimeText(editor, path)
        textHost =
          getSlateNodeElementByPath(editor, path) ??
          (liveDOMPath && PathApi.equals(liveDOMPath, path)
            ? liveDOMTextHost
            : null)
        selectionOffset = nativeInput.target.selectionOffset
        textHostText = nativeInput.target.text
      }

      if (
        !slateNode ||
        !path ||
        selectionOffset == null ||
        textHostText == null
      ) {
        const selection = readRuntimeSelection(editor)

        if (selection && RangeApi.isCollapsed(selection)) {
          const fallbackPath = selection.anchor.path
          const fallbackTextHost = getSlateNodeElementByPath(
            editor,
            fallbackPath
          )
          const fallbackSlateNode = readRuntimeText(editor, fallbackPath)

          if (fallbackTextHost && fallbackSlateNode) {
            path = fallbackPath
            slateNode = fallbackSlateNode
            textHost = fallbackTextHost
            selectionOffset = selection.anchor.offset + inputText.length
            textHostText =
              fallbackTextHost.textContent?.replace(/\uFEFF/g, '') ?? null
          }
        }
      }

      if (
        slateNode &&
        path &&
        selectionOffset != null &&
        textHostText != null
      ) {
        if (textHostText === slateNode.text) {
          return
        }

        const insert = getDOMTextRepairInsert({
          inputText,
          preferCapturedInsert: nativeInput.target?.preferCapturedInsert,
          selectionOffset,
          slateText: slateNode.text,
          targetInsert: nativeInput.target?.insert,
          textHostText,
        })

        if (insert.text.length === 0) {
          return
        }
        const nextOffset = insert.offset + insert.text.length
        const currentSelection = readRuntimeSelection(editor)
        const expandedReplacementRange =
          currentSelection &&
          RangeApi.isExpanded(currentSelection) &&
          PathApi.equals(currentSelection.anchor.path, path) &&
          PathApi.equals(currentSelection.focus.path, path)
            ? currentSelection
            : null
        const expandedReplacementEdges = expandedReplacementRange
          ? RangeApi.edges(expandedReplacementRange)
          : null
        const expandedReplacementStart = expandedReplacementEdges?.[0] ?? null
        const expandedReplacementEnd = expandedReplacementEdges?.[1] ?? null
        const shouldReplaceExpandedSelection =
          !!expandedReplacementRange &&
          !!expandedReplacementStart &&
          !!expandedReplacementEnd &&
          insert.offset === expandedReplacementStart.offset &&
          textHostText ===
            slateNode.text.slice(0, expandedReplacementStart.offset) +
              insert.text +
              slateNode.text.slice(expandedReplacementEnd.offset)
        const targetStillOwnsDOMSelection =
          !!nativeInput.target &&
          !!liveDOMPath &&
          PathApi.equals(liveDOMPath, nativeInput.target.path) &&
          liveDOMSelectionOffset === nativeInput.target.selectionOffset
        const targetPathStillOwnsDOMSelection =
          !!nativeInput.target &&
          !!liveDOMPath &&
          PathApi.equals(liveDOMPath, nativeInput.target.path)
        const capturedInsertStillOwnsDOMSelection =
          !!nativeInput.target?.preferCapturedInsert &&
          targetStillOwnsDOMSelection
        const capturedInsertStillOwnsVirtualizedPath =
          !!nativeInput.target?.preferCapturedInsert &&
          !!textHost &&
          isInsideVirtualizedDOM(textHost) &&
          targetPathStillOwnsDOMSelection
        const shouldMoveSelection =
          shouldReplaceExpandedSelection ||
          capturedInsertStillOwnsDOMSelection ||
          capturedInsertStillOwnsVirtualizedPath ||
          !nativeInput.target ||
          targetStillOwnsDOMSelection
        const shouldRepairCaretAfterTextInsert =
          shouldMoveSelection &&
          !(
            textHost &&
            isInsideVirtualizedDOM(textHost) &&
            targetStillOwnsDOMSelection
          )

        if (shouldMoveSelection) {
          armRepairInducedSelectionOriginGuard()
          if (textHost && isInsideVirtualizedDOM(textHost)) {
            if (targetPathStillOwnsDOMSelection) {
              setEditableModelSelectionPreference({
                inputController,
                preferModelSelection: false,
                reason: 'native-selection',
                selectionSource: 'dom-current',
              })
            } else {
              setEditableModelSelectionPreference({
                inputController,
                preferModelSelection: true,
                reason: 'repair-induced',
                selectionSource: 'model-owned',
              })
              armModelOwnedTextInputGuard({ inputController })
            }
          }
        }
        editor.update(
          (tx) => {
            tx.text.insert(insert.text, {
              at: shouldReplaceExpandedSelection
                ? expandedReplacementRange
                : { path, offset: insert.offset },
            })

            if (shouldMoveSelection) {
              tx.selection.set({
                anchor: { path, offset: nextOffset },
                focus: { path, offset: nextOffset },
              })
            }
          },
          { metadata: getNativeTextInputHistoryMetadata(editor) }
        )

        if (shouldRepairCaretAfterTextInsert) {
          this.repairCaretAfterModelTextInsert()
        }
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
      let textInsertRepairCompleted = false
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
        if (
          kind === 'repair-caret-after-text-insert' &&
          textInsertRepairCompleted
        ) {
          return true
        }

        if (!isCurrentRepairFrame()) {
          return false
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
          return scrollCurrentDOMSelectionIntoView()
        }

        const { path, offset: slateOffset } = selection.anchor
        const textHost = getSlateNodeElementByPath(editor, path)

        if (!textHost) {
          if (kind === 'repair-caret-after-text-insert') {
            return false
          }

          return scrollCurrentDOMSelectionIntoView()
        }

        if (kind === 'repair-caret-after-text-insert') {
          const slateText = readRuntimeText(editor, path)?.text
          const textHostText = textHost.textContent?.replace(/\uFEFF/g, '')

          if (slateText != null && textHostText !== slateText) {
            return false
          }
        }

        const isProjectedTextHost =
          textHost.getAttribute('data-slate-dom-sync-reason') === 'projection'
        const isVirtualizedTextHost = isInsideVirtualizedDOM(textHost)
        const shouldScrollTextHost =
          kind !== 'repair-caret-after-text-insert' || !isVirtualizedTextHost
        const shouldReleaseTextInsertSelectionToDOM =
          !isVirtualizedTextHost && !isProjectedTextHost
        const root = ReactEditor.findDocumentOrShadowRoot(editor)
        const domSelection = getSelection(root)

        if (!domSelection) {
          return false
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

            armRepairInducedSelectionOriginGuard()
            domSelection.setBaseAndExtent(
              domNode,
              domOffset,
              domNode,
              domOffset
            )
            if (
              domSelection.rangeCount === 0 ||
              domSelection.anchorNode !== domNode ||
              domSelection.anchorOffset !== domOffset ||
              domSelection.focusNode !== domNode ||
              domSelection.focusOffset !== domOffset
            ) {
              domSelection.removeAllRanges()
              domSelection.addRange(domRange)
            }
            if (shouldScrollTextHost && !shouldSkipSelectionScroll(editor)) {
              scrollSelectionIntoView(editor, domRange)
            }
            if (kind === 'repair-caret-after-text-insert') {
              if (shouldReleaseTextInsertSelectionToDOM) {
                setEditableModelSelectionPreference({
                  inputController,
                  preferModelSelection: false,
                  selectionSource: 'dom-current',
                })
              }
              textInsertRepairCompleted = true
            }
            return true
          }

          offset = nextOffset
        }

        if (kind === 'repair-caret-after-text-insert') {
          return false
        }

        return scrollCurrentDOMSelectionIntoView()
      }

      const retry = (remainingRetries: number) => {
        requestAnimationFrame(() => {
          if (!isCurrentRepairFrame()) {
            return
          }

          const repaired = repairCollapsedSelectionByPath()
          if (
            kind === 'repair-caret-after-text-insert' &&
            repaired &&
            textInsertRepairCompleted
          ) {
            return
          }

          if (remainingRetries > 0) {
            setTimeout(() => retry(remainingRetries - 1), 25)
          }
        })
      }

      const repaired = repairCollapsedSelectionByPath()
      if (
        kind === 'repair-caret-after-text-insert' &&
        repaired &&
        textInsertRepairCompleted
      ) {
        return
      }

      queueMicrotask(() => {
        const repaired = repairCollapsedSelectionByPath()
        if (
          kind === 'repair-caret-after-text-insert' &&
          repaired &&
          textInsertRepairCompleted
        ) {
          return
        }
      })
      setTimeout(() => {
        repairCollapsedSelectionByPath()
      })
      retry(kind === 'repair-caret-after-text-insert' ? 40 : 8)
    },

    repairCaretAfterModelTextInsert() {
      this.repair({
        kind: 'repair-caret',
        reason: 'repair-caret-after-text-insert',
      })
    },
  }
}
