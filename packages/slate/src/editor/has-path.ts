import type { EditorStaticApi } from '../interfaces/editor'
import { NodeApi } from '../interfaces/node'

export const hasPath: EditorStaticApi['hasPath'] = (editor, path) => {
  return NodeApi.has(editor, path)
}
