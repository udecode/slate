import { Editor, type EditorInterface } from '../interfaces/editor'
import { Node } from '../interfaces/node'
import { Range } from '../interfaces/range'

export const fragment: EditorInterface['fragment'] = (editor, at) => {
  const range = Editor.range(editor, at)

  if (Range.isCollapsed(range)) {
    return []
  }

  return Node.fragment(editor, range)
}
