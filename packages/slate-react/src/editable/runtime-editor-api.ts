import type { Editor as SlateEditor } from 'slate'
import {
  inheritEditorExtensionRegistry as inheritEditorExtensionRegistryCore,
  getEditorTransformRegistry as readEditorTransformRegistry,
  setEditorTransformRegistry as writeEditorTransformRegistry,
} from 'slate/internal'

export {
  Editor,
  getEditorCurrentMarks,
  getEditorExtensionRegistry,
  getEditorLiveNode,
  getEditorLiveSelection,
  getEditorLiveText,
  getEditorRuntime,
  getEditorTransformRegistry,
  hasEditorTransformMiddleware,
  setEditorMarks,
  setEditorRuntime,
  setEditorSelection,
  setEditorTargetRuntime,
  setEditorTransformRegistry,
  withOperationRootChildren,
} from 'slate/internal'

export const inheritEditorExtensionRegistry = (
  editor: SlateEditor,
  source: SlateEditor
) => {
  inheritEditorExtensionRegistryCore(editor, source)
}

export const inheritEditorTransformRegistry = (
  editor: SlateEditor,
  source: SlateEditor
) => {
  writeEditorTransformRegistry(editor, readEditorTransformRegistry(source))
}
