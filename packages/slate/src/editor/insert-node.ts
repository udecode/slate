import type { EditorInterface } from '../interfaces/editor'

export const insertNode: EditorInterface['insertNode'] = (
  editor,
  node,
  options
) => {
  editor.insertNodes(node, options)
}
