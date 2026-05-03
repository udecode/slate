import { getEditorSchema } from '../core/editor-runtime'
import { Editor, type EditorStaticApi } from '../interfaces/editor'
import { Node } from '../interfaces/node'
import type { Point } from '../interfaces/point'

export const before: EditorStaticApi['before'] = (editor, at, options = {}) => {
  const anchor = Editor.point(editor, [], { edge: 'start' })
  const focus = Editor.point(editor, at, { edge: 'start' })
  const range = { anchor, focus }
  const { distance = 1 } = options
  let d = 0
  let target: Point | undefined

  for (const p of Editor.positions(editor, {
    ...options,
    at: range,
    reverse: true,
  })) {
    const insideNonSelectable = Editor.above(editor, {
      at: p,
      match: (node) =>
        Node.isElement(node) && !getEditorSchema(editor).isSelectable(node),
      mode: 'highest',
      voids: true,
    })

    if (insideNonSelectable) {
      continue
    }

    if (d > distance) {
      break
    }

    if (d !== 0) {
      target = p
    }

    d++
  }

  return target
}
