import { hasInternalEditorState } from '../core/public-state'
import type { Editor, EditorStaticApi } from '../interfaces/editor'
export const isEditor: EditorStaticApi['isEditor'] = (
  value: any,
  { deep = false } = {}
): value is Editor => {
  return deep ? hasInternalEditorState(value) : hasInternalEditorState(value)
}
