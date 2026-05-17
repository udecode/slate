import type { Range } from 'slate'
import { useRequiredEditorSelectorContext } from '../hooks/use-editor-selector'
import { useIsomorphicLayoutEffect } from '../hooks/use-isomorphic-layout-effect'
import type { ReactRuntimeEditor } from '../plugin/react-editor'
import type { EditableInputController } from './input-controller'
import { readRuntimeSelection } from './runtime-selection-state'
import { subscribeSelectionOnlyDOMExport } from './selection-runtime'

export const useEditableRootSelectionExport = ({
  editor,
  inputController,
  isShellBackedSelection,
  syncDOMSelectionToEditor,
}: {
  editor: ReactRuntimeEditor
  inputController: EditableInputController
  isShellBackedSelection: (selection: Range | null) => boolean
  syncDOMSelectionToEditor: () => void
}) => {
  const { addEventListener: addSelectorEventListener } =
    useRequiredEditorSelectorContext()

  useIsomorphicLayoutEffect(() => {
    return subscribeSelectionOnlyDOMExport({
      addSelectorEventListener,
      getModelSelection: () => readRuntimeSelection(editor),
      inputController,
      shouldSkipDOMExport: (modelSelection) =>
        isShellBackedSelection(modelSelection),
      syncDOMSelectionToEditor,
    })
  }, [
    addSelectorEventListener,
    editor,
    inputController,
    isShellBackedSelection,
    syncDOMSelectionToEditor,
  ])
}
