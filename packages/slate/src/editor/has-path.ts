import type { EditorStaticApi } from '../interfaces/editor'
import { Node } from '../interfaces/node'

export const hasPath: EditorStaticApi['hasPath'] = (editor, path) => {
  return Node.has(editor, path)
}
