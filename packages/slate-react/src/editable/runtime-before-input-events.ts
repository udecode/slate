import { type FormEvent, type RefObject, useCallback } from 'react'
import { PathApi, type Range, RangeApi } from 'slate'
import { getSelection, isDOMElement, isDOMText } from 'slate-dom'
import type {
  EditableDOMBeforeInputContext,
  EditableDOMBeforeInputHandler,
} from '../components/editable'
import { focusSlateEditable } from '../hooks/focus-slate-editable'
import { useOptionalSlateRuntimeContext } from '../hooks/use-slate-runtime'
import { ReactEditor, type ReactRuntimeEditor } from '../plugin/react-editor'
import { recordSlateReactRender } from '../render-profiler'
import { completeDuplicateEditableEditingEpochCommand } from './editing-epoch-kernel'
import { prepareEditableBeforeInputKernel } from './editing-kernel'
import {
  getNestedEditableDOMSelectionRoot,
  isEditableModelSelectionPreferredForInput,
  isNestedEditableDOMTarget,
  isSelectionInEditorView,
  shouldForceModelOwnedTextInput,
} from './input-controller'
import {
  getDOMInputRepairTarget,
  useEditableDOMBeforeInputHandler,
  useEditableReactBeforeInputHandler,
} from './input-router'
import type { EditableInputController } from './input-state'
import {
  applyModelOwnedBeforeInputOperation,
  applyModelOwnedNativeHistoryEvent,
  type DeferredOperation,
  shouldForceRenderAfterModelOwnedHistory,
} from './model-input-strategy'
import { getNativeBeforeInputDecision } from './native-input-strategy'
import { hasEditorTransformMiddleware } from './runtime-editor-api'
import type { EditableEventRuntime } from './runtime-event-engine'
import { readLiveSelection } from './runtime-selection-state'
import {
  handleWebKitShadowDOMBeforeInput,
  restoreUserSelectionAfterBeforeInput,
  syncSelectionForBeforeInput,
} from './selection-reconciler'

type ApplyInputRules = ({
  data,
  event,
  inputType,
  selection,
}: {
  data: unknown
  event?: InputEvent
  inputType: string
  selection: Range | null
}) => boolean

type ReactBeforeInputHandler = (
  event: FormEvent<HTMLDivElement>
) => boolean | void

const now = () => globalThis.performance?.now?.() ?? Date.now()

const profileBeforeInputDuration = <T>(id: string, callback: () => T): T => {
  if (!globalThis.__SLATE_REACT_RENDER_PROFILER__) {
    return callback()
  }

  const start = now()

  try {
    return callback()
  } finally {
    recordSlateReactRender({
      duration: now() - start,
      id,
      kind: 'runtime-time',
    })
  }
}

const isDOMBeforeInputHandled = (
  event: InputEvent,
  handler: EditableDOMBeforeInputHandler | undefined,
  context: EditableDOMBeforeInputContext
) => {
  if (!handler) {
    return false
  }

  const shouldTreatEventAsHandled = handler(event, context)

  if (shouldTreatEventAsHandled != null) {
    if (shouldTreatEventAsHandled) {
      event.preventDefault()
    }

    return shouldTreatEventAsHandled
  }

  return event.defaultPrevented
}

const getSelectionRoot = (selection: Range | null) => selection?.anchor.root

const getDOMSelectionTextPoint = (root: Document | ShadowRoot) => {
  const domSelection = getSelection(root)
  const anchorNode = domSelection?.anchorNode ?? null
  const anchorElement = isDOMText(anchorNode)
    ? anchorNode.parentElement
    : isDOMElement(anchorNode)
      ? anchorNode
      : null

  const pathKey =
    anchorElement
      ?.closest('[data-slate-node="text"]')
      ?.getAttribute('data-slate-path') ?? null
  const offset =
    domSelection?.isCollapsed && isDOMText(anchorNode)
      ? domSelection.anchorOffset
      : null

  return pathKey ? { offset, pathKey } : null
}

export const getDeferredNativeTextInputRepairPathKey = ({
  data,
  deferNativeTextInputRepair,
  inputType,
  native,
  selection,
}: {
  data: unknown
  deferNativeTextInputRepair: boolean
  inputType: string
  native: boolean
  selection: Range | null
}) => {
  if (
    !deferNativeTextInputRepair ||
    !native ||
    inputType !== 'insertText' ||
    typeof data !== 'string' ||
    data.length === 0 ||
    !selection ||
    !RangeApi.isCollapsed(selection)
  ) {
    return null
  }

  return selection.anchor.path.join(',')
}

export const useRuntimeBeforeInputEvents = ({
  androidInputManagerRef,
  applyInputRules,
  deferNativeTextInputRepair = false,
  deferredOperations,
  editor,
  handledDOMBeforeInputRef,
  inputController,
  flushPendingNativeTextInput,
  onBeforeInput,
  onDOMBeforeInput,
  onInput,
  onUserInput,
  processing,
  queuePendingNativeTextInput,
  readOnly,
  repair,
  selection,
  setComposing,
  trace,
}: {
  androidInputManagerRef: EditableEventRuntime['android']['managerRef']
  applyInputRules: ApplyInputRules
  deferNativeTextInputRepair?: boolean
  deferredOperations: RefObject<DeferredOperation[]>
  editor: ReactRuntimeEditor
  handledDOMBeforeInputRef: RefObject<boolean>
  inputController: EditableInputController
  flushPendingNativeTextInput?: () => void
  onBeforeInput?: ReactBeforeInputHandler
  onDOMBeforeInput?: EditableDOMBeforeInputHandler
  onInput?: unknown
  onUserInput: () => void
  processing: RefObject<boolean>
  queuePendingNativeTextInput?: (input: {
    data: string
    inputType: string
    rootElement: HTMLElement
    selection: Range | null
  }) => void
  readOnly: boolean
  repair: EditableEventRuntime['repair']
  selection: EditableEventRuntime['selection']
  setComposing: EditableEventRuntime['composition']['setComposing']
  trace: EditableEventRuntime['trace']
}) => {
  const slateRuntimeContext = useOptionalSlateRuntimeContext()
  const handleDOMBeforeInput = useCallback(
    (event: InputEvent) => {
      if (event.inputType !== 'insertText') {
        flushPendingNativeTextInput?.()
      }

      const decision = profileBeforeInputDuration('beforeinput-prepare', () =>
        prepareEditableBeforeInputKernel({
          editor,
          event,
          inputController,
        })
      )
      inputController.state.activeIntent = decision.intent
      profileBeforeInputDuration('beforeinput-trace', () =>
        trace.recordKernelEventTrace({
          command: decision.command,
          family: 'beforeinput',
          intent: decision.intent,
          ownership: decision.ownership,
          target: event.target,
        })
      )
      if (applyModelOwnedNativeHistoryEvent({ editor, event, readOnly })) {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (shouldForceRenderAfterModelOwnedHistory(editor)) {
          repair.requestEditableRepair({
            forceRender: true,
            kind: 'force-render',
          })
        }
        handledDOMBeforeInputRef.current = true
        return
      }

      if (
        completeDuplicateEditableEditingEpochCommand(editor, decision.command)
      ) {
        event.preventDefault()
        event.stopImmediatePropagation()
        handledDOMBeforeInputRef.current = true
        return
      }

      if (decision.internalTarget) {
        event.stopImmediatePropagation()
        return
      }
      const el = profileBeforeInputDuration('beforeinput-root-node', () =>
        ReactEditor.assertDOMNode(editor, editor)
      )
      if (isNestedEditableDOMTarget(el, event.target)) {
        return
      }

      if (readOnly && ReactEditor.hasEditableTarget(editor, event.target)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        handledDOMBeforeInputRef.current = true
        return
      }

      const root = profileBeforeInputDuration(
        'beforeinput-root-owner',
        () => el.getRootNode() as Document | ShadowRoot
      )

      if (event.inputType === 'insertText') {
        const pendingPathKey =
          inputController.state.pendingNativeTextInputRepairPathKey
        const pendingOffset =
          inputController.state.pendingNativeTextInputRepairOffset
        const domPoint = pendingPathKey ? getDOMSelectionTextPoint(root) : null

        if (
          pendingPathKey &&
          (domPoint?.pathKey !== pendingPathKey ||
            (pendingOffset != null && domPoint.offset !== pendingOffset))
        ) {
          flushPendingNativeTextInput?.()
          inputController.state.pendingNativeTextInputRepairOffset = null
          inputController.state.pendingNativeTextInputRepairPathKey = null
        }
      }

      if (
        handleWebKitShadowDOMBeforeInput({
          editor,
          event,
          processing,
          root,
          window,
        })
      ) {
        return
      }
      onUserInput()

      if (!readOnly && ReactEditor.hasEditableTarget(editor, event.target)) {
        handledDOMBeforeInputRef.current = true
        profileBeforeInputDuration('beforeinput-flush-selection', () =>
          selection.flushSelectionChange()
        )

        let currentSelection = profileBeforeInputDuration(
          'beforeinput-read-selection',
          () => readLiveSelection(editor)
        )

        if (!isSelectionInEditorView(editor, currentSelection)) {
          return
        }

        const hasAppInputPolicy = Boolean(
          onDOMBeforeInput ||
            onBeforeInput ||
            onInput ||
            hasEditorTransformMiddleware(editor, 'insertText')
        )

        if (hasAppInputPolicy) {
          flushPendingNativeTextInput?.()
          currentSelection = profileBeforeInputDuration(
            'beforeinput-reread-selection-after-native-text-flush',
            () => readLiveSelection(editor)
          )
        }

        const beforeInputDecision = profileBeforeInputDuration(
          'beforeinput-native-decision',
          () =>
            getNativeBeforeInputDecision({
              allowDirtyDOMText:
                deferNativeTextInputRepair &&
                inputController.state.selectionSource === 'dom-current',
              editor,
              event,
              hasAppInputPolicy,
              selection: currentSelection,
            })
        )
        const {
          data,
          inputType: type,
          isCompositionChange,
          native: initialNative,
          shouldAbortForCompositionChange,
        } = beforeInputDecision
        const selectionRoot =
          getSelectionRoot(currentSelection) ??
          getNestedEditableDOMSelectionRoot(el)
        const viewRoot = editor.read((state) => state.view.root())
        const targetEditor =
          selectionRoot && selectionRoot !== viewRoot
            ? slateRuntimeContext?.getMountedViewEditor(selectionRoot)
            : null

        if (selectionRoot && selectionRoot !== viewRoot && !targetEditor) {
          return
        }

        if (targetEditor && targetEditor !== editor) {
          event.preventDefault()
          event.stopImmediatePropagation()
          handledDOMBeforeInputRef.current = true

          const request = profileBeforeInputDuration(
            'beforeinput-redirect-root',
            () =>
              applyModelOwnedBeforeInputOperation({
                command: decision.command,
                data,
                deferredOperations,
                editor: targetEditor,
                inputType: type,
                native: false,
                selection:
                  currentSelection ??
                  targetEditor.read((state) => state.selection.get()),
                setComposing,
              })
          )

          if (request) {
            focusSlateEditable(targetEditor)
          }

          return
        }

        const domBeforeInputContext: EditableDOMBeforeInputContext = {
          data,
          editor,
          event,
          inputType: type,
          intent: decision.intent,
          native: initialNative,
          selection: currentSelection,
        }

        if (
          isDOMBeforeInputHandled(
            event,
            onDOMBeforeInput,
            domBeforeInputContext
          )
        ) {
          return
        }

        if (androidInputManagerRef.current) {
          return androidInputManagerRef.current.handleDOMBeforeInput(event)
        }

        if (shouldAbortForCompositionChange) {
          return
        }

        for (const operation of deferredOperations.current) {
          operation()
        }
        deferredOperations.current = []

        let native = beforeInputDecision.native
        const forceModelOwnedTextInput = shouldForceModelOwnedTextInput({
          inputController,
          inputType: type,
        })

        const beforeInputSelection = profileBeforeInputDuration(
          'beforeinput-sync-selection',
          () =>
            syncSelectionForBeforeInput({
              allowDOMSelectionImport: selection.allowDOMSelectionImport(
                decision.selectionPolicy
              ),
              data,
              editor,
              editorElement: el,
              event,
              forceModelOwnedTextInput,
              inputType: type,
              isCompositionChange,
              native,
              pendingNativeTextInputRepairPathKey:
                inputController.state.pendingNativeTextInputRepairPathKey,
              pendingNativeTextInputRepairOffset:
                inputController.state.pendingNativeTextInputRepairOffset,
              preferModelSelectionForInput:
                isEditableModelSelectionPreferredForInput({
                  inputController,
                  inputType: type,
                }) || forceModelOwnedTextInput,
              root,
              selection: currentSelection,
            })
        )
        native = beforeInputSelection.native
        currentSelection = beforeInputSelection.selection

        if (
          deferNativeTextInputRepair &&
          !native &&
          type === 'insertText' &&
          typeof data === 'string' &&
          data.length > 0 &&
          currentSelection &&
          RangeApi.isCollapsed(currentSelection)
        ) {
          flushPendingNativeTextInput?.()
          currentSelection = readLiveSelection(editor)

          if (currentSelection && RangeApi.isCollapsed(currentSelection)) {
            const pendingTarget = getDOMInputRepairTarget(editor, el, {
              data,
              inputType: type,
            })

            if (
              pendingTarget?.insert &&
              PathApi.equals(pendingTarget.path, currentSelection.anchor.path)
            ) {
              trace.repairDOMInputWithTrace(
                {
                  data,
                  inputType: type,
                  target: pendingTarget,
                },
                el
              )
              currentSelection = readLiveSelection(editor)
            }
          }
        }

        inputController.state.pendingNativeTextInputRepairPathKey =
          getDeferredNativeTextInputRepairPathKey({
            data,
            deferNativeTextInputRepair,
            inputType: type,
            native,
            selection: currentSelection,
          })
        inputController.state.pendingNativeTextInputRepairOffset = null

        if (isCompositionChange) {
          return
        }

        if (
          profileBeforeInputDuration('beforeinput-input-rules', () =>
            applyInputRules({
              data,
              event,
              inputType: type,
              selection: currentSelection,
            })
          )
        ) {
          return
        }

        if (!native) {
          event.preventDefault()
        }

        if (
          deferNativeTextInputRepair &&
          native &&
          type === 'insertText' &&
          typeof data === 'string' &&
          data.length > 0
        ) {
          queuePendingNativeTextInput?.({
            data,
            inputType: type,
            rootElement: el,
            selection: currentSelection,
          })
        }

        const request = profileBeforeInputDuration(
          'beforeinput-apply-model',
          () =>
            applyModelOwnedBeforeInputOperation({
              command: decision.command,
              data,
              deferredOperations,
              editor,
              inputType: type,
              native,
              selection: currentSelection,
              setComposing,
            })
        )
        if (request) {
          const shouldDeferNativeTextRepair =
            deferNativeTextInputRepair &&
            native &&
            type === 'insertText' &&
            typeof data === 'string' &&
            data.length > 0 &&
            request.kind === 'repair-caret-after-text-insert'

          if (!shouldDeferNativeTextRepair) {
            profileBeforeInputDuration('beforeinput-request-repair', () =>
              repair.requestEditableRepair(request)
            )
          }
        }

        if (!decision.command) {
          restoreUserSelectionAfterBeforeInput({ editor })
        }
      }
    },
    [
      androidInputManagerRef,
      applyInputRules,
      deferNativeTextInputRepair,
      deferredOperations,
      editor,
      flushPendingNativeTextInput,
      handledDOMBeforeInputRef,
      inputController,
      onBeforeInput,
      onDOMBeforeInput,
      onInput,
      onUserInput,
      processing,
      queuePendingNativeTextInput,
      readOnly,
      repair,
      selection,
      setComposing,
      slateRuntimeContext,
      trace,
    ]
  )
  const onRuntimeDOMBeforeInput = useEditableDOMBeforeInputHandler({
    handleDOMBeforeInput,
  })

  const handleReactBeforeInputFallback = useCallback(
    (text: string) => {
      const request = applyModelOwnedBeforeInputOperation({
        command: { inputType: 'insertText', kind: 'insert-text', text },
        data: text,
        deferredOperations,
        editor,
        inputType: 'insertText',
        native: false,
        selection: readLiveSelection(editor),
        setComposing,
      })

      if (request) {
        repair.requestEditableRepair(request)
      }
    },
    [deferredOperations, editor, repair, setComposing]
  )
  const onRuntimeReactBeforeInput = useEditableReactBeforeInputHandler({
    editor,
    handleFallbackInsertText: handleReactBeforeInputFallback,
    onBeforeInput,
    readOnly,
  })

  return {
    onDOMBeforeInput: onRuntimeDOMBeforeInput,
    onReactBeforeInput: onRuntimeReactBeforeInput,
  }
}
