import { type ClipboardEvent, useCallback } from 'react'
import type { ReactRuntimeEditor } from '../plugin/react-editor'
import {
  applyEditableCopy,
  applyEditableCut,
  applyEditablePaste,
} from './clipboard-input-strategy'
import { prepareEditableClipboardKernel } from './editing-kernel'
import {
  useEditableClipboardHandler,
  useEditablePasteHandler,
} from './input-router'
import type { EditableInputController } from './input-state'
import type { EditableEventRuntime } from './runtime-event-engine'

type ClipboardHandler = (
  event: ClipboardEvent<HTMLDivElement>
) => boolean | void

export const useRuntimeClipboardEvents = ({
  editor,
  inputController,
  onCopy,
  onCut,
  onPaste,
  readOnly,
  repair,
  setExplicitShellBackedSelection,
  shellBackedSelection,
  trace,
}: {
  editor: ReactRuntimeEditor
  inputController: EditableInputController
  onCopy?: ClipboardHandler
  onCut?: ClipboardHandler
  onPaste?: ClipboardHandler
  readOnly: boolean
  repair: EditableEventRuntime['repair']
  setExplicitShellBackedSelection: (nextValue: boolean) => void
  shellBackedSelection: boolean
  trace: EditableEventRuntime['trace']
}) => {
  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      const decision = prepareEditableClipboardKernel({
        editor,
        event,
        inputController,
      })
      inputController.state.activeIntent = decision.intent
      trace.beginKernelEventFrame({
        family: 'paste',
        intent: decision.intent,
        target: event.target,
      })
      const pasteResult = applyEditablePaste({
        editor,
        event,
        onPaste,
        readOnly,
        shellBackedSelection,
      })
      if (pasteResult.repair) {
        repair.requestEditableRepair(pasteResult.repair)
      }
      if (pasteResult.explicitShellBackedSelection !== undefined) {
        setExplicitShellBackedSelection(
          pasteResult.explicitShellBackedSelection
        )
      }
      trace.recordKernelEventTrace({
        command: pasteResult.command,
        family: 'paste',
        intent: decision.intent,
        ownership: decision.ownership,
        target: event.target,
      })
    },
    [
      editor,
      inputController,
      onPaste,
      readOnly,
      repair,
      setExplicitShellBackedSelection,
      shellBackedSelection,
      trace,
    ]
  )
  const onRuntimePaste = useEditablePasteHandler({ handlePaste })

  const handleCopy = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      const decision = prepareEditableClipboardKernel({
        editor,
        event,
        inputController,
      })
      inputController.state.activeIntent = decision.intent
      trace.recordKernelEventTrace({
        family: 'copy',
        intent: decision.intent,
        ownership: decision.ownership,
        target: event.target,
      })
      applyEditableCopy({
        editor,
        event,
        onCopy,
      })
    },
    [editor, inputController, onCopy, trace]
  )
  const onRuntimeCopy = useEditableClipboardHandler({
    handleClipboard: handleCopy,
  })

  const handleCut = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      const decision = prepareEditableClipboardKernel({
        editor,
        event,
        inputController,
      })
      inputController.state.activeIntent = decision.intent
      trace.beginKernelEventFrame({
        family: 'cut',
        intent: decision.intent,
        target: event.target,
      })
      const cutResult = applyEditableCut({
        editor,
        event,
        onCut,
        readOnly,
      })
      if (cutResult.repair) {
        repair.requestEditableRepair(cutResult.repair)
      }
      trace.recordKernelEventTrace({
        command: cutResult.command,
        family: 'cut',
        intent: decision.intent,
        ownership: decision.ownership,
        target: event.target,
      })
    },
    [editor, inputController, onCut, readOnly, repair, trace]
  )
  const onRuntimeCut = useEditableClipboardHandler({
    handleClipboard: handleCut,
  })

  return {
    onCopy: onRuntimeCopy,
    onCut: onRuntimeCut,
    onPaste: onRuntimePaste,
  }
}
