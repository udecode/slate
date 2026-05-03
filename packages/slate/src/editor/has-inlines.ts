import { Editor, type EditorStaticApi } from '../interfaces/editor'
import { Node } from '../interfaces/node'

export const hasInlines: EditorStaticApi['hasInlines'] = (editor, element) => {
  return element.children.some(
    (n) => Node.isText(n) || Editor.isInline(editor, n)
  )
}
