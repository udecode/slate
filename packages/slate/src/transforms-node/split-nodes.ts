import { applyOperation, withTransaction } from '../core/public-state'
import { Location } from '../interfaces'
import { Editor } from '../interfaces/editor'
import { Node } from '../interfaces/node'
import { Path } from '../interfaces/path'
import type { Point } from '../interfaces/point'
import type { PointRef } from '../interfaces/point-ref'
import { Range } from '../interfaces/range'
import type { NodeMutationMethods } from '../interfaces/transforms/node'

const deleteRange = (editor: Editor, range: Range): Point | null => {
  if (Range.isCollapsed(range)) {
    return range.anchor
  }

  const [, end] = Range.edges(range)
  const pointRef = Editor.pointRef(editor, end)
  editor.delete({ at: range })
  return pointRef.unref()
}

export const splitNodes: NodeMutationMethods['splitNodes'] = (
  editor,
  options = {}
) => {
  withTransaction(editor, (tx) => {
    Editor.withoutNormalizing(editor, () => {
      const { mode = 'lowest', voids = false } = options
      let { match, height = 0, always = false } = options
      let at = tx.resolveTarget({ at: options.at })

      if (!at) {
        return
      }

      if (match == null) {
        match = (n) => Node.isElement(n) && Editor.isBlock(editor, n)
      }

      if (Location.isRange(at)) {
        at = deleteRange(editor, at)
        if (!at) {
          return
        }
      }

      if (Location.isPath(at)) {
        if (options.position != null) {
          const path = at
          const [node] = Editor.node(editor, path)

          applyOperation(editor, {
            type: 'split_node',
            path,
            position: options.position,
            properties: Node.extractProps(node),
          })

          return
        }

        const path = at
        const point = Editor.point(editor, path)
        const [parent] = Editor.parent(editor, path)

        match = (n) => n === parent
        height = point.path.length - path.length + 1
        at = point
        always = true
      }

      if (!Location.isPoint(at)) {
        return
      }

      const beforeRef = Editor.pointRef(editor, at, {
        affinity: 'backward',
      })
      let afterRef: PointRef | undefined

      try {
        const [highest] = Editor.nodes(editor, { at, match, mode, voids })

        if (!highest) {
          return
        }

        const voidMatch = Editor.void(editor, { at, mode: 'highest' })

        if (!voids && voidMatch) {
          const [voidNode, voidPath] = voidMatch

          if (editor.isInline(voidNode)) {
            let after = Editor.after(editor, voidPath)

            if (!after) {
              const text = { text: '' }
              const afterPath = Path.next(voidPath)
              editor.insertNodes(text, { at: afterPath, voids })
              after = Editor.point(editor, afterPath)!
            }

            at = after
            always = true
          }

          const siblingHeight = at.path.length - voidPath.length
          height = siblingHeight + 1
          always = true
        }

        afterRef = Editor.pointRef(editor, at, { affinity: 'forward' })
        const depth = at.path.length - height
        const [, highestPath] = highest
        const lowestPath = at.path.slice(0, depth)
        let position = height === 0 ? at.offset : at.path[depth]!

        for (const [node, path] of Editor.levels(editor, {
          at: lowestPath,
          reverse: true,
          voids,
        })) {
          let split = false

          if (
            path.length < highestPath.length ||
            path.length === 0 ||
            (!voids && Node.isElement(node) && Editor.isVoid(editor, node))
          ) {
            break
          }

          const point = beforeRef.current!
          const isEnd = Editor.isEnd(editor, point, path)

          if (always || !Editor.isEdge(editor, point, path)) {
            split = true
            applyOperation(editor, {
              type: 'split_node',
              path,
              position,
              properties: Node.extractProps(node),
            })
          }

          position = path.at(-1)! + (split || isEnd ? 1 : 0)
        }

        if (options.at == null) {
          const point = afterRef.current || Editor.end(editor, [])
          editor.select(point)
        }
      } finally {
        beforeRef.unref()
        afterRef?.unref()
      }
    })
  })
}
