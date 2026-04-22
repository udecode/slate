import { Editor, type EditorInterface } from '../interfaces/editor'
import { Node } from '../interfaces/node'
import type { Point } from '../interfaces/point'

export const after: EditorInterface['after'] = (editor, at, options = {}) => {
  const anchor = Editor.point(editor, at, { edge: 'end' })
  const focus = Editor.end(editor, [])
  const range = { anchor, focus }
  const { distance = 1 } = options
  let d = 0
  let target: Point | undefined

  for (const p of Editor.positions(editor, {
    ...options,
    at: range,
  })) {
    const insideNonSelectable = Editor.above(editor, {
      at: p,
      match: (node) => Node.isElement(node) && !editor.isSelectable(node),
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
