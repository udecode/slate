import { getEditorTransformRegistry } from '../core/transform-registry'
import type { EditorStaticApi } from '../interfaces/editor'

export const insertSoftBreak: EditorStaticApi['insertSoftBreak'] = (editor) => {
  getEditorTransformRegistry(editor).splitNodes({ always: true })
}
