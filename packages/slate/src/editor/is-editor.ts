import { hasEditorRuntime } from '../core/editor-runtime'
import type { Editor, EditorStaticApi } from '../interfaces/editor'

export const isEditor: EditorStaticApi['isEditor'] = (
  value: any,
  _options = {}
): value is Editor => {
  return hasEditorRuntime(value)
}
