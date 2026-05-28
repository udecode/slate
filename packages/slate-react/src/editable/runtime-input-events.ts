import {
  type InputEvent as ReactInputEvent,
  type RefObject,
  useCallback,
  useRef,
} from 'react'
import { RangeApi } from 'slate'
import type { ReactRuntimeEditor } from '../plugin/react-editor'
import { prepareEditableInputKernel } from './editing-kernel'
import { isSelectionInEditorView } from './input-controller'
import {
  getDOMInputRepairTarget,
  useEditableDOMInputHandler,
  useEditableInputHandler,
} from './input-router'
import type { EditableInputController } from './input-state'
import {
  applyEditableInput,
  type DeferredOperation,
} from './model-input-strategy'
import type { EditableEventRuntime } from './runtime-event-engine'
import { readRuntimeSelection } from './runtime-selection-state'

type InputHandler = (event: ReactInputEvent<HTMLDivElement>) => boolean | void

type DeferredNativeTextInput = {
  nextOffset: number
  pathKey: string
}

export const useRuntimeInputEvents = ({
  androidInputManagerRef,
  deferNativeTextInputRepair = false,
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
  deferNativeTextInputRepair?: boolean
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
  const deferredNativeTextInputRef = useRef<DeferredNativeTextInput | null>(
    null
  )
  const deferredNativeTextInputResetRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null)
  const resetDeferredNativeTextInput = useCallback(() => {
    if (deferredNativeTextInputResetRef.current !== null) {
      clearTimeout(deferredNativeTextInputResetRef.current)
      deferredNativeTextInputResetRef.current = null
    }
    deferredNativeTextInputRef.current = null
  }, [])
  const scheduleDeferredNativeTextInputReset = useCallback(() => {
    if (deferredNativeTextInputResetRef.current !== null) {
      clearTimeout(deferredNativeTextInputResetRef.current)
    }
    deferredNativeTextInputResetRef.current = setTimeout(() => {
      deferredNativeTextInputResetRef.current = null
      deferredNativeTextInputRef.current = null
    })
  }, [])
  const markHandledDOMInput = useCallback((event: Event) => {
    handledDOMInputEventsRef.current.add(event)
  }, [])
  const onRuntimeDOMInput = useEditableDOMInputHandler({
    deferNativeTextInputRepair,
    editor,
    onHandledDOMInput: markHandledDOMInput,
    onReadOnlyDOMInput: repair.forceRender,
    repairDOMInput: trace.repairDOMInputWithTrace,
    readOnly,
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
      if (!isSelectionInEditorView(editor, readRuntimeSelection(editor))) {
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
      if (!isSelectionInEditorView(editor, readRuntimeSelection(editor))) {
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
      let target =
        inputType === 'insertText'
          ? getDOMInputRepairTarget(editor, rootElement, { data, inputType })
          : null
      const frameId = trace.getCurrentKernelFrameId()

      if (readOnly) {
        return
      }

      let shouldResetDeferredNativeTextInput = false

      if (
        deferNativeTextInputRepair &&
        target &&
        inputType === 'insertText' &&
        typeof data === 'string' &&
        data.length > 0
      ) {
        const pathKey = target.path.join(',')
        const pending = deferredNativeTextInputRef.current
        const selection = readRuntimeSelection(editor)
        const selectionOffset =
          selection &&
          RangeApi.isCollapsed(selection) &&
          selection.anchor.path.join(',') === pathKey
            ? selection.anchor.offset
            : null
        const targetInsertOffset = Math.max(
          0,
          target.selectionOffset - data.length
        )
        const pendingOffset =
          pending?.pathKey === pathKey ? pending.nextOffset : null
        const insertOffset =
          pendingOffset != null &&
          (pendingOffset === selectionOffset ||
            pendingOffset === targetInsertOffset)
            ? pendingOffset
            : (selectionOffset ?? targetInsertOffset)

        deferredNativeTextInputRef.current = {
          nextOffset: insertOffset + data.length,
          pathKey,
        }
        target = {
          ...target,
          insert: {
            offset: insertOffset,
            text: data,
          },
        }
        shouldResetDeferredNativeTextInput = true
      } else {
        resetDeferredNativeTextInput()
      }

      trace.repairDOMInputAfterFrame(
        { data, inputType, target },
        rootElement,
        frameId
      )

      if (shouldResetDeferredNativeTextInput) {
        scheduleDeferredNativeTextInputReset()
      }
    },
    [
      deferNativeTextInputRepair,
      editor,
      inputController,
      readOnly,
      resetDeferredNativeTextInput,
      scheduleDeferredNativeTextInputReset,
      trace,
    ]
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
