import { Editor, type EditorStaticApi } from '../interfaces/editor'
import { Node } from '../interfaces/node'

export const hasBlocks: EditorStaticApi['hasBlocks'] = (editor, element) => {
  return element.children.some(
    (n) => Node.isElement(n) && Editor.isBlock(editor, n)
  )
}
