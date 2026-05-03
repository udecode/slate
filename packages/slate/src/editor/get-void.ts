import { Editor, type EditorStaticApi } from '../interfaces/editor'
import { Node } from '../interfaces/node'

export const getVoid: EditorStaticApi['void'] = (editor, options = {}) => {
  return Editor.above(editor, {
    ...options,
    match: (n) => Node.isElement(n) && Editor.isVoid(editor, n),
  })
}
