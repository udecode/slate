import { type FormEvent, type RefObject, useCallback } from 'react'
import type { Range } from 'slate'
import { ReactEditor } from '../plugin/react-editor'
import { recordSlateReactRender } from '../render-profiler'
import { shouldSkipDuplicateEditableEditingEpochCommand } from './editing-epoch-kernel'
import { prepareEditableBeforeInputKernel } from './editing-kernel'
import { isEditableModelSelectionPreferred } from './input-controller'
import {
  useEditableDOMBeforeInputHandler,
  useEditableReactBeforeInputHandler,
} from './input-router'
import type { EditableInputController } from './input-state'
import {
  applyModelOwnedBeforeInputOperation,
  applyModelOwnedNativeHistoryEvent,
  shouldForceRenderAfterModelOwnedHistory,
} from './model-input-strategy'
import { getNativeBeforeInputDecision } from './native-input-strategy'
import type { EditableEventRuntime } from './runtime-event-engine'
import { readLiveSelection } from './runtime-selection-state'
import {
  handleWebKitShadowDOMBeforeInput,
  restoreUserSelectionAfterBeforeInput,
  syncSelectionForBeforeInput,
} from './selection-reconciler'

type DeferredOperation = () => void

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

type DOMBeforeInputHandler = (event: InputEvent) => boolean | void
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

const isDOMEventHandled = <E extends Event>(
  event: E,
  handler?: (event: E) => void | boolean
) => {
  if (!handler) {
    return false
  }

  const shouldTreatEventAsHandled = handler(event)

  if (shouldTreatEventAsHandled != null) {
    return shouldTreatEventAsHandled
  }

  return event.defaultPrevented
}

export const useRuntimeBeforeInputEvents = ({
  androidInputManagerRef,
  applyInputRules,
  deferredOperations,
  editor,
  handledDOMBeforeInputRef,
  inputController,
  onBeforeInput,
  onDOMBeforeInput,
  onInput,
  onKeyDown,
  onUserInput,
  processing,
  readOnly,
  repair,
  selection,
  setComposing,
  trace,
}: {
  androidInputManagerRef: EditableEventRuntime['android']['managerRef']
  applyInputRules: ApplyInputRules
  deferredOperations: RefObject<DeferredOperation[]>
  editor: ReactEditor
  handledDOMBeforeInputRef: RefObject<boolean>
  inputController: EditableInputController
  onBeforeInput?: ReactBeforeInputHandler
  onDOMBeforeInput?: DOMBeforeInputHandler
  onInput?: unknown
  onKeyDown?: unknown
  onUserInput: () => void
  processing: RefObject<boolean>
  readOnly: boolean
  repair: EditableEventRuntime['repair']
  selection: EditableEventRuntime['selection']
  setComposing: EditableEventRuntime['composition']['setComposing']
  trace: EditableEventRuntime['trace']
}) => {
  const handleDOMBeforeInput = useCallback(
    (event: InputEvent) => {
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
      if (decision.internalTarget) {
        event.stopImmediatePropagation()
        return
      }

      if (applyModelOwnedNativeHistoryEvent({ editor, event })) {
        event.preventDefault()
        if (shouldForceRenderAfterModelOwnedHistory(editor)) {
          repair.requestEditableRepair({
            forceRender: true,
            kind: 'force-render',
          })
        }
        handledDOMBeforeInputRef.current = true
        return
      }
      const el = profileBeforeInputDuration('beforeinput-root-node', () =>
        ReactEditor.toDOMNode(editor, editor)
      )
      const root = profileBeforeInputDuration('beforeinput-root-owner', () =>
        el.getRootNode()
      )

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

      if (
        !readOnly &&
        ReactEditor.hasEditableTarget(editor, event.target) &&
        !isDOMEventHandled(event, onDOMBeforeInput)
      ) {
        handledDOMBeforeInputRef.current = true
        if (androidInputManagerRef.current) {
          return androidInputManagerRef.current.handleDOMBeforeInput(event)
        }

        profileBeforeInputDuration('beforeinput-flush-selection', () =>
          selection.flushSelectionChange()
        )

        let currentSelection = profileBeforeInputDuration(
          'beforeinput-read-selection',
          () => readLiveSelection(editor)
        )
        const hasAppInputPolicy = Boolean(
          onDOMBeforeInput || onBeforeInput || onInput || onKeyDown
        )
        const beforeInputDecision = profileBeforeInputDuration(
          'beforeinput-native-decision',
          () =>
            getNativeBeforeInputDecision({
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
          shouldAbortForCompositionChange,
        } = beforeInputDecision

        if (shouldAbortForCompositionChange) {
          return
        }

        if (
          shouldSkipDuplicateEditableEditingEpochCommand(
            editor,
            decision.command
          )
        ) {
          event.preventDefault()
          handledDOMBeforeInputRef.current = true
          return
        }

        let native = beforeInputDecision.native

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
              inputType: type,
              isCompositionChange,
              native,
              preferModelSelectionForInput:
                isEditableModelSelectionPreferred(inputController),
              root,
              selection: currentSelection,
            })
        )
        native = beforeInputSelection.native
        currentSelection = beforeInputSelection.selection

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
          profileBeforeInputDuration('beforeinput-request-repair', () =>
            repair.requestEditableRepair(request)
          )
        }

        if (!decision.command) {
          restoreUserSelectionAfterBeforeInput({ editor })
        }
      }
    },
    [
      androidInputManagerRef,
      applyInputRules,
      deferredOperations,
      editor,
      handledDOMBeforeInputRef,
      inputController,
      onBeforeInput,
      onDOMBeforeInput,
      onInput,
      onKeyDown,
      onUserInput,
      processing,
      readOnly,
      repair,
      selection,
      setComposing,
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
