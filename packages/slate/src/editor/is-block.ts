import { getEditorSchema } from '../core/editor-runtime'
import type { EditorStaticApi } from '../interfaces/editor'

export const isBlock: EditorStaticApi['isBlock'] = (editor, value) => {
  return !getEditorSchema(editor).isInline(value)
}
