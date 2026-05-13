import { getEditorSchema } from '../core/editor-runtime'
import { applyOperation, runEditorTransaction } from '../core/public-state'
import { getEditorTransformRegistry } from '../core/transform-registry'
import { node as getNode } from '../editor/node'
import { nodes as getNodes } from '../editor/nodes'
import { LocationApi } from '../interfaces'
import { Editor } from '../interfaces/editor'
import { NodeApi } from '../interfaces/node'
import { type Path, PathApi } from '../interfaces/path'
import type { Point } from '../interfaces/point'
import type { PointRef } from '../interfaces/point-ref'
import { type Range, RangeApi } from '../interfaces/range'
import type { NodeMutationMethods } from '../interfaces/transforms/node'

const deleteRange = (editor: Editor, range: Range): Point | null => {
  if (RangeApi.isCollapsed(range)) {
    return range.anchor
  }

  const [, end] = RangeApi.edges(range)
  const pointRef = Editor.pointRef(editor, end)
  getEditorTransformRegistry(editor).delete({ at: range })
  return pointRef.unref()
}

const getTextEndForwardPoint = (
  editor: Editor,
  point: Point,
  highestPath: Path
): Point | null => {
  if (highestPath.length >= point.path.length) {
    return null
  }

  const [node] = getNode(editor, point.path)

  if (
    !NodeApi.isText(node) ||
    node.text !== '' ||
    point.offset !== node.text.length
  ) {
    return null
  }

  const nextPath = PathApi.next(point.path)

  if (!NodeApi.has(editor, nextPath)) {
    return null
  }

  return Editor.point(editor, nextPath, { edge: 'start' })
}

export const splitNodes: NodeMutationMethods['splitNodes'] = (
  editor,
  options = {}
) => {
  runEditorTransaction(editor, (tx) => {
    Editor.withoutNormalizing(editor, () => {
      const transforms = getEditorTransformRegistry(editor)
      const { mode = 'lowest', voids = false } = options
      let { match, height = 0, always = false } = options
      let at = tx.resolveTarget({ at: options.at })

      if (!at) {
        return
      }

      if (match == null) {
        match = (n) => NodeApi.isElement(n) && Editor.isBlock(editor, n)
      }

      if (LocationApi.isRange(at)) {
        at = deleteRange(editor, at)
        if (!at) {
          return
        }
      }

      if (LocationApi.isPath(at)) {
        if (at.length === 0) {
          throw new Error('Cannot split the editor root.')
        }

        if (options.position != null) {
          const path = at
          const [node] = getNode(editor, path)

          applyOperation(editor, {
            type: 'split_node',
            path,
            position: options.position,
            properties: NodeApi.extractProps(node),
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

      if (!LocationApi.isPoint(at)) {
        return
      }

      const beforeRef = Editor.pointRef(editor, at, {
        affinity: 'backward',
      })
      let afterRef: PointRef | undefined

      try {
        const [highest] = getNodes(editor, { at, match, mode, voids })

        if (!highest) {
          return
        }

        const voidMatch = Editor.void(editor, { at, mode: 'highest' })

        if (!voids && voidMatch) {
          const [voidNode, voidPath] = voidMatch

          if (getEditorSchema(editor).isInline(voidNode)) {
            let after = Editor.after(editor, voidPath)

            if (!after) {
              const text = { text: '' }
              const afterPath = PathApi.next(voidPath)
              transforms.insertNodes(text, { at: afterPath, voids })
              after = Editor.point(editor, afterPath)!
            }

            at = after
            always = true
          }

          const siblingHeight = at.path.length - voidPath.length
          height = siblingHeight + 1
          always = true
        }

        const depth = at.path.length - height
        const [, highestPath] = highest
        const textEndForwardPoint = always
          ? getTextEndForwardPoint(editor, at, highestPath)
          : null
        afterRef = Editor.pointRef(editor, textEndForwardPoint ?? at, {
          affinity: 'forward',
        })
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
            (!voids && NodeApi.isElement(node) && Editor.isVoid(editor, node))
          ) {
            break
          }

          const point = beforeRef.current!
          const isEnd = Editor.isEnd(editor, point, path)

          if (textEndForwardPoint && PathApi.equals(path, at.path)) {
            split = false
          } else if (always || !Editor.isEdge(editor, point, path)) {
            split = true
            applyOperation(editor, {
              type: 'split_node',
              path,
              position,
              properties: NodeApi.extractProps(node),
            })
          }

          position = path.at(-1)! + (split || isEnd ? 1 : 0)
        }

        if (options.at == null) {
          const point =
            afterRef.current || Editor.point(editor, [], { edge: 'end' })
          transforms.select(point)
        }
      } finally {
        beforeRef.unref()
        afterRef?.unref()
      }
    })
  })
}
