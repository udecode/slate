import { type KeyboardEvent, useCallback } from 'react'
import type { RuntimeId } from 'slate'
import type { MountedTopLevelRange } from '../large-document/large-document-commands'
import type { ReactEditor } from '../plugin/react-editor'
import { prepareEditableKeyDownKernel } from './editing-kernel'
import type { EditableRepairRequest } from './input-controller'
import { useEditableKeyboardHandler } from './input-router'
import type { EditableInputController } from './input-state'
import { applyEditableKeyDown } from './keyboard-input-strategy'
import type { EditableEventRuntimeCore } from './runtime-event-engine'

type EditableKeyCommandHandler = (
  event: KeyboardEvent<HTMLDivElement>
) => boolean | EditableRepairRequest | void

export const useRuntimeKeyboardEvents = ({
  editor,
  inputController,
  largeDocument,
  onKeyCommand,
  onKeyDown,
  readOnly,
  runtime,
  setExplicitShellBackedSelection,
}: {
  editor: ReactEditor
  inputController: EditableInputController
  largeDocument: {
    mountedTopLevelRuntimeIds: ReadonlySet<RuntimeId> | null
    mountedTopLevelRanges?: readonly MountedTopLevelRange[]
  } | null
  onKeyCommand?: EditableKeyCommandHandler
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => boolean | void
  readOnly: boolean
  runtime: EditableEventRuntimeCore
  setExplicitShellBackedSelection: (nextValue: boolean) => void
}) => {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const decision = prepareEditableKeyDownKernel({
        editor,
        event,
        inputController,
        largeDocument,
      })
      inputController.state.activeIntent = decision.intent
      runtime.selection.applyKeyDownSelectionPolicy(decision)
      runtime.trace.beginKeyDownEventFrame(decision)
      const keyDownWorkerResult = applyEditableKeyDown({
        androidInputManagerRef: runtime.android.managerRef,
        editor,
        event,
        forceRender: runtime.repair.forceRender,
        largeDocument,
        onKeyCommand,
        onKeyDown,
        readOnly,
        setExplicitShellBackedSelection,
        setComposing: runtime.composition.setComposing,
      })
      if (keyDownWorkerResult.repair) {
        runtime.repair.requestEditableRepair(keyDownWorkerResult.repair)
      }
      if (
        !readOnly &&
        decision.intent === 'native-selection-move' &&
        (event.key === 'ArrowUp' || event.key === 'ArrowDown')
      ) {
        setTimeout(() => {
          runtime.selection.syncDOMSelectionFromRuntime()
        })
      }
      runtime.trace.recordKeyDownTrace({
        decision,
        eventKey: event.key,
        handled: keyDownWorkerResult.handled,
      })
    },
    [
      editor,
      inputController,
      largeDocument,
      onKeyCommand,
      onKeyDown,
      readOnly,
      runtime,
      setExplicitShellBackedSelection,
    ]
  )

  return {
    onKeyDown: useEditableKeyboardHandler({
      handleKeyboard: handleKeyDown,
    }),
  }
}
