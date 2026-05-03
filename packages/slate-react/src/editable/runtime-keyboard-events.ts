import { type KeyboardEvent, useCallback } from 'react'
import type { RuntimeId } from 'slate'
import type { EditableKeyDownHandler } from '../components/editable'
import type { MountedTopLevelRange } from '../large-document/large-document-commands'
import type { ReactEditor } from '../plugin/react-editor'
import { prepareEditableKeyDownKernel } from './editing-kernel'
import { useEditableKeyboardHandler } from './input-router'
import type { EditableInputController } from './input-state'
import { applyEditableKeyDown } from './keyboard-input-strategy'
import type { EditableEventRuntimeCore } from './runtime-event-engine'

export const useRuntimeKeyboardEvents = ({
  editor,
  inputController,
  largeDocument,
  onKeyDown,
  readOnly,
  runtime,
  setExplicitShellBackedSelection,
  shellBackedSelection,
}: {
  editor: ReactEditor
  inputController: EditableInputController
  largeDocument: {
    mode: 'dom-present' | 'shell'
    mountedTopLevelRuntimeIds: ReadonlySet<RuntimeId> | null
    mountedTopLevelRanges?: readonly MountedTopLevelRange[]
  } | null
  onKeyDown?: EditableKeyDownHandler
  readOnly: boolean
  runtime: EditableEventRuntimeCore
  setExplicitShellBackedSelection: (nextValue: boolean) => void
  shellBackedSelection: boolean
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
        onKeyDown,
        readOnly,
        setExplicitShellBackedSelection,
        setComposing: runtime.composition.setComposing,
        shellBackedSelection,
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
      onKeyDown,
      readOnly,
      runtime,
      setExplicitShellBackedSelection,
      shellBackedSelection,
    ]
  )

  return {
    onKeyDown: useEditableKeyboardHandler({
      handleKeyboard: handleKeyDown,
    }),
  }
}
