import { type FormEvent, type RefObject, useCallback } from 'react'
import type { Range } from 'slate'
import type {
  EditableCommandContext,
  EditableCommandHandler,
  EditableDOMBeforeInputContext,
  EditableDOMBeforeInputHandler,
} from '../components/editable'
import { ReactEditor } from '../plugin/react-editor'
import { recordSlateReactRender } from '../render-profiler'
import { shouldSkipDuplicateEditableEditingEpochCommand } from './editing-epoch-kernel'
import { prepareEditableBeforeInputKernel } from './editing-kernel'
import { isEditableModelSelectionPreferredForInput } from './input-controller'
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

type ReactBeforeInputHandler = (
  event: FormEvent<HTMLDivElement>
) => boolean | void

const DEFAULT_EDITABLE_COMMAND_REPAIR = {
  focus: true,
  kind: 'repair-caret',
  selectionSourceTransition: {
    preferModelSelection: true,
    reason: 'model-command',
    selectionSource: 'model-owned',
  },
} as const

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
    return shouldTreatEventAsHandled
  }

  return event.defaultPrevented
}

const applyCommandHandler = ({
  command,
  context,
  event,
  handler,
  repair,
}: {
  command: NonNullable<EditableDOMBeforeInputContext['command']>
  context: EditableCommandContext
  event: InputEvent
  handler?: EditableCommandHandler
  repair: EditableEventRuntime['repair']
}) => {
  if (!handler) {
    return false
  }

  const result = handler(command, context)

  if (result != null) {
    if (!result) {
      return false
    }

    event.preventDefault()
    repair.requestEditableRepair(
      result === true ? DEFAULT_EDITABLE_COMMAND_REPAIR : result
    )
    return true
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
  onCommand,
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
  onDOMBeforeInput?: EditableDOMBeforeInputHandler
  onCommand?: EditableCommandHandler
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

      if (decision.internalTarget) {
        event.stopImmediatePropagation()
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

      if (!readOnly && ReactEditor.hasEditableTarget(editor, event.target)) {
        handledDOMBeforeInputRef.current = true
        profileBeforeInputDuration('beforeinput-flush-selection', () =>
          selection.flushSelectionChange()
        )

        let currentSelection = profileBeforeInputDuration(
          'beforeinput-read-selection',
          () => readLiveSelection(editor)
        )
        const hasAppInputPolicy = Boolean(
          onDOMBeforeInput || onCommand || onBeforeInput || onInput || onKeyDown
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
          native: initialNative,
          shouldAbortForCompositionChange,
        } = beforeInputDecision

        const domBeforeInputContext: EditableDOMBeforeInputContext = {
          command: decision.command,
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
                isEditableModelSelectionPreferredForInput({
                  inputController,
                  inputType: type,
                }),
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

        if (
          decision.command &&
          applyCommandHandler({
            command: decision.command,
            context: {
              data,
              editor,
              event,
              inputType: type,
              intent: decision.intent,
              native,
              selection: currentSelection,
            },
            event,
            handler: onCommand,
            repair,
          })
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
        if (native && type === 'insertText' && typeof data === 'string') {
          deferredOperations.current.push(() =>
            trace.repairDOMInputWithTrace({ data, inputType: type }, el)
          )
        }
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
      onCommand,
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
