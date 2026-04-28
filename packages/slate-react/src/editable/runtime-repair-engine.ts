import { useCallback, useMemo, useReducer } from 'react'
import { EDITOR_TO_FORCE_RENDER } from 'slate-dom'
import type { ReactEditor } from '../plugin/react-editor'
import { createDOMRepairQueue } from './dom-repair-queue'
import type { EditableInputController } from './input-state'
import {
  applyEditableRepairRequest,
  type EditableRepairRequest,
} from './mutation-controller'

export const useRuntimeRepairEngine = ({
  editor,
  inputController,
  syncDOMSelectionToEditor,
}: {
  editor: ReactEditor
  inputController: EditableInputController
  syncDOMSelectionToEditor: () => void
}) => {
  const [, forceRender] = useReducer((s) => s + 1, 0)
  const domRepairQueue = useMemo(
    () =>
      createDOMRepairQueue({
        editor,
        inputController,
        syncDOMSelectionToEditor,
      }),
    [editor, inputController, syncDOMSelectionToEditor]
  )

  EDITOR_TO_FORCE_RENDER.set(editor, forceRender)

  const requestEditableRepair = useCallback(
    (request: EditableRepairRequest) => {
      applyEditableRepairRequest({
        domRepairQueue,
        editor,
        forceRender,
        inputController,
        request,
        syncDOMSelectionToEditor,
      })
    },
    [
      domRepairQueue,
      editor,
      forceRender,
      inputController,
      syncDOMSelectionToEditor,
    ]
  )

  return { domRepairQueue, forceRender, requestEditableRepair }
}
