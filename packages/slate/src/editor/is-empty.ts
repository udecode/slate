import { getEditorSchema } from '../core/editor-runtime'
import type { EditorStaticApi } from '../interfaces/editor'
import { Node } from '../interfaces/node'

export const isEmpty: EditorStaticApi['isEmpty'] = (editor, element) => {
  const { children } = element
  const [first] = children
  return (
    children.length === 0 ||
    (children.length === 1 &&
      Node.isText(first) &&
      first.text === '' &&
      !getEditorSchema(editor).isVoid(element))
  )
}
