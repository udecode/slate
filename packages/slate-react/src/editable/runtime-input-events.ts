import {
  type InputEvent as ReactInputEvent,
  type RefObject,
  useCallback,
  useRef,
} from 'react'
import type { ReactRuntimeEditor } from '../plugin/react-editor'
import { prepareEditableInputKernel } from './editing-kernel'
import {
  useEditableDOMInputHandler,
  useEditableInputHandler,
} from './input-router'
import type { EditableInputController } from './input-state'
import {
  applyEditableInput,
  type DeferredOperation,
} from './model-input-strategy'
import type { EditableEventRuntime } from './runtime-event-engine'

type InputHandler = (event: ReactInputEvent<HTMLDivElement>) => boolean | void

export const useRuntimeInputEvents = ({
  androidInputManagerRef,
  deferredOperations,
  editor,
  handledDOMBeforeInputRef,
  inputController,
  onInput,
  readOnly,
  repair,
  rootRef,
  trace,
}: {
  androidInputManagerRef: EditableEventRuntime['android']['managerRef']
  deferredOperations: RefObject<DeferredOperation[]>
  editor: ReactRuntimeEditor
  handledDOMBeforeInputRef: RefObject<boolean>
  inputController: EditableInputController
  onInput?: InputHandler
  readOnly: boolean
  repair: EditableEventRuntime['repair']
  rootRef: RefObject<HTMLDivElement | null>
  trace: EditableEventRuntime['trace']
}) => {
  const handledDOMInputEventsRef = useRef<WeakSet<Event>>(new WeakSet())
  const markHandledDOMInput = useCallback((event: Event) => {
    handledDOMInputEventsRef.current.add(event)
  }, [])
  const onRuntimeDOMInput = useEditableDOMInputHandler({
    editor,
    onHandledDOMInput: markHandledDOMInput,
    repairDOMInput: trace.repairDOMInputWithTrace,
    rootRef,
  })

  const handleInput = useCallback(
    (event: ReactInputEvent<HTMLDivElement>) => {
      const decision = prepareEditableInputKernel({
        editor,
        event,
        inputController,
      })
      if (decision.internalTarget) {
        trace.recordKernelEventTrace({
          family: 'input',
          intent: decision.intent,
          ownership: decision.ownership,
          target: event.target,
        })
        event.stopPropagation()
        return
      }

      const skipNativeTextInputRepair = handledDOMInputEventsRef.current.has(
        event.nativeEvent
      )
      trace.recordKernelEventTrace({
        family: 'input',
        intent: decision.intent,
        ownership: decision.ownership,
        target: event.target,
      })
      const inputResult = applyEditableInput({
        androidInputManagerRef,
        deferredOperations,
        editor,
        event,
        handledDOMBeforeInputRef,
        inputController,
        onInput,
        readOnly,
        skipNativeTextInputRepair,
      })
      for (const request of inputResult.repairs) {
        repair.requestEditableRepair(request)
      }
    },
    [
      androidInputManagerRef,
      deferredOperations,
      editor,
      handledDOMBeforeInputRef,
      inputController,
      onInput,
      readOnly,
      repair,
      trace,
    ]
  )
  const onRuntimeInput = useEditableInputHandler({ handleInput })

  const handleInputCapture = useCallback(
    (event: ReactInputEvent<HTMLDivElement>) => {
      const decision = prepareEditableInputKernel({
        editor,
        event,
        inputController,
      })
      if (decision.internalTarget) {
        trace.recordKernelEventTrace({
          family: 'input',
          intent: decision.intent,
          ownership: decision.ownership,
          target: event.target,
        })
        event.stopPropagation()
        return
      }

      trace.recordKernelEventTrace({
        family: 'input',
        intent: decision.intent,
        ownership: decision.ownership,
        target: event.target,
      })

      const rootElement = event.currentTarget
      const { data, inputType } = event.nativeEvent as InputEvent
      const frameId = trace.getCurrentKernelFrameId()

      trace.repairDOMInputAfterFrame({ data, inputType }, rootElement, frameId)
    },
    [editor, inputController, trace]
  )
  const onRuntimeInputCapture = useEditableInputHandler({
    handleInput: handleInputCapture,
  })

  return {
    onDOMInput: onRuntimeDOMInput,
    onInput: onRuntimeInput,
    onInputCapture: onRuntimeInputCapture,
  }
}
