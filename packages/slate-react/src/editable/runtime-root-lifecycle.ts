import { useIsomorphicLayoutEffect } from '../hooks/use-isomorphic-layout-effect'
import { ReactEditor, type ReactRuntimeEditor } from '../plugin/react-editor'
import type { EditableInputControllerState } from './input-controller'
import { attachEditableGlobalDragLifecycleListeners } from './input-router'
import { attachEditableSelectionChangeListener } from './selection-reconciler'

export const useEditableRootGlobalLifecycle = ({
  editor,
  scheduleOnDOMSelectionChange,
  state,
}: {
  editor: ReactRuntimeEditor
  scheduleOnDOMSelectionChange: () => void
  state: EditableInputControllerState
}) => {
  useIsomorphicLayoutEffect(() => {
    const window = ReactEditor.getWindow(editor)
    const detachSelectionChangeListener = attachEditableSelectionChangeListener(
      {
        scheduleOnDOMSelectionChange,
        targetDocument: window.document,
      }
    )
    const detachGlobalDragLifecycleListeners =
      attachEditableGlobalDragLifecycleListeners({
        state,
        targetDocument: window.document,
      })

    return () => {
      detachSelectionChangeListener()
      detachGlobalDragLifecycleListeners()
    }
  }, [editor, scheduleOnDOMSelectionChange, state])
}
