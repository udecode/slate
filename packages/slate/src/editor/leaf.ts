import { Editor, type EditorStaticApi } from '../interfaces/editor'
import { Node } from '../interfaces/node'

export const leaf: EditorStaticApi['leaf'] = (editor, at, options = {}) => {
  const path = Editor.path(editor, at, options)
  const node = Node.leaf(editor, path)
  return [node, path]
}
