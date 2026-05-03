import { Node } from '../interfaces'
import { Editor, type EditorStaticApi } from '../interfaces/editor'
import { Path } from '../interfaces/path'
import { Range } from '../interfaces/range'
import { nodes } from './nodes'

export const string: EditorStaticApi['string'] = (editor, at, options = {}) => {
  const { voids = false } = options
  const range = Editor.range(editor, at)
  const [start, end] = Range.edges(range)
  let text = ''

  for (const [node, path] of nodes(editor, {
    at: range,
    match: Node.isText,
    voids,
  })) {
    let t = node.text

    if (Path.equals(path, end.path)) {
      t = t.slice(0, end.offset)
    }

    if (Path.equals(path, start.path)) {
      t = t.slice(start.offset)
    }

    text += t
  }

  return text
}
