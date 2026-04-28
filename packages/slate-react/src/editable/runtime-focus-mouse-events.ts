import { type FocusEvent, type MouseEvent, useCallback } from 'react'
import type { ReactEditor } from '../plugin/react-editor'
import { prepareEditableFocusMouseKernel } from './editing-kernel'
import { isInteractiveInternalTarget } from './input-controller'
import {
  useEditableFocusHandler,
  useEditableMouseHandler,
} from './input-router'
import type { EditableInputController } from './input-state'
import type { EditableEventRuntime } from './runtime-event-engine'
import {
  applyEditableBlur,
  applyEditableClick,
  applyEditableFocus,
  applyEditableMouseDown,
  type EditableSelectionReconcilerState,
} from './selection-reconciler'

type FocusHandler = (event: FocusEvent<HTMLDivElement>) => boolean | void
type MouseHandler = (event: MouseEvent<HTMLDivElement>) => boolean | void

export const useRuntimeFocusMouseEvents = ({
  editor,
  inputController,
  onBlur,
  onClick,
  onFocus,
  onMouseDown,
  onMouseUp,
  readOnly,
  selection,
  state,
  trace,
}: {
  editor: ReactEditor
  inputController: EditableInputController
  onBlur?: FocusHandler
  onClick?: MouseHandler
  onFocus?: FocusHandler
  onMouseDown?: MouseHandler
  onMouseUp?: MouseHandler
  readOnly: boolean
  selection: EditableEventRuntime['selection']
  state: EditableSelectionReconcilerState
  trace: EditableEventRuntime['trace']
}) => {
  const handleBlur = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      const decision = prepareEditableFocusMouseKernel({
        editor,
        event,
        inputController,
      })
      trace.recordKernelEventTrace({
        family: 'blur',
        intent: decision.intent,
        ownership: decision.ownership,
        target: event.target,
      })
      applyEditableBlur({
        editor,
        event,
        onBlur,
        readOnly,
        state,
      })
    },
    [editor, inputController, onBlur, readOnly, state, trace]
  )
  const onRuntimeBlur = useEditableFocusHandler({ handleFocus: handleBlur })

  const handleFocus = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      const decision = prepareEditableFocusMouseKernel({
        editor,
        event,
        inputController,
      })
      trace.recordKernelEventTrace({
        family: 'focus',
        intent: decision.intent,
        ownership: decision.ownership,
        target: event.target,
      })
      applyEditableFocus({
        editor,
        event,
        onFocus,
        readOnly,
        state,
      })
    },
    [editor, inputController, onFocus, readOnly, state, trace]
  )
  const onRuntimeFocus = useEditableFocusHandler({ handleFocus })

  const handleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const decision = prepareEditableFocusMouseKernel({
        editor,
        event,
        inputController,
      })
      trace.recordKernelEventTrace({
        family: 'click',
        intent: decision.intent,
        ownership: decision.ownership,
        target: event.target,
      })
      applyEditableClick({
        editor,
        event,
        inputController,
        onClick,
        readOnly,
      })
    },
    [editor, inputController, onClick, readOnly, trace]
  )
  const onRuntimeClick = useEditableMouseHandler({ handleMouse: handleClick })

  const handleMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const decision = prepareEditableFocusMouseKernel({
        editor,
        event,
        inputController,
      })
      trace.recordKernelEventTrace({
        family: 'mousedown',
        intent: decision.intent,
        ownership: decision.ownership,
        target: event.target,
      })
      applyEditableMouseDown({
        editor,
        event,
        inputController,
        onMouseDown,
      })
    },
    [editor, inputController, onMouseDown, trace]
  )
  const onRuntimeMouseDown = useEditableMouseHandler({
    handleMouse: handleMouseDown,
  })

  const handleMouseUp = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (isInteractiveInternalTarget(editor, event.target)) {
        onMouseUp?.(event)
        return
      }

      const handled =
        (onMouseUp?.(event) as boolean | void) ?? event.defaultPrevented

      if (!handled) {
        selection.syncDOMSelectionFromRuntime()
      }
    },
    [editor, onMouseUp, selection]
  )
  const onRuntimeMouseUp = useEditableMouseHandler({
    handleMouse: handleMouseUp,
  })

  return {
    onBlur: onRuntimeBlur,
    onClick: onRuntimeClick,
    onFocus: onRuntimeFocus,
    onMouseDown: onRuntimeMouseDown,
    onMouseUp: onRuntimeMouseUp,
  }
}
