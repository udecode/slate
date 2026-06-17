import type { EditorStaticApi } from '../interfaces/editor'
import { NodeApi } from '../interfaces/node'

export const hasTexts: EditorStaticApi['hasTexts'] = (editor, element) => {
  return element.children.every((n) => NodeApi.isText(n))
}
