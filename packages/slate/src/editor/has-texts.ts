import type { EditorStaticApi } from '../interfaces/editor'
import { Node } from '../interfaces/node'

export const hasTexts: EditorStaticApi['hasTexts'] = (editor, element) => {
  return element.children.every((n) => Node.isText(n))
}
