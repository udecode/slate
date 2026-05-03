import { getEditorSchema } from '../core/editor-runtime'
import { runEditorTransaction } from '../core/public-state'
import { getEditorTransformRegistry } from '../core/transform-registry'
import { nodes as getNodes } from '../editor/nodes'
import { createInternalRangeRef } from '../editor/range-ref'
import { Location, Node, type Point, Range } from '../interfaces'
import { Editor } from '../interfaces/editor'
import { Path } from '../interfaces/path'
import type { NodeMutationMethods } from '../interfaces/transforms/node'
import { matchPath } from '../utils/match-path'
import { insertNodes } from './insert-nodes'
import { moveNodes } from './move-nodes'
import { splitNodes } from './split-nodes'

export const wrapNodes: NodeMutationMethods['wrapNodes'] = (
  editor,
  element,
  options = {}
) => {
  runEditorTransaction(editor, (tx) => {
    Editor.withoutNormalizing(editor, () => {
      const transforms = getEditorTransformRegistry(editor)
      let target = tx.resolveTarget({ at: options.at })
      const mode = options.mode ?? 'lowest'
      const split = options.split ?? false
      const voids = options.voids ?? false
      let { match } = options
      const wrapper = {
        ...element,
        children: [],
      }

      if (!target) {
        return
      }

      if (match == null) {
        if (Location.isPath(target)) {
          match = matchPath(editor, target)
        } else if (getEditorSchema(editor).isInline(element)) {
          match = (node) =>
            (Node.isElement(node) && getEditorSchema(editor).isInline(node)) ||
            Node.isText(node)
        } else {
          match = (node) => Node.isElement(node) && Editor.isBlock(editor, node)
        }
      }

      if (Location.isPath(target) && options.match == null && !split) {
        insertNodes(editor, wrapper, { at: target })
        moveNodes(editor, {
          at: [...target.slice(0, -1), target.at(-1)! + 1],
          to: [...target, 0],
        })
        return
      }

      if (split && Location.isRange(target)) {
        const [start, end] = Range.edges(target)
        const rangeRef = createInternalRangeRef(editor, target, {
          affinity: 'inward',
        })
        const isAtBlockEdge = (point: Point) => {
          const blockAbove = Editor.above(editor, {
            at: point,
            match: (node) =>
              Node.isElement(node) && Editor.isBlock(editor, node),
          })

          return blockAbove && Editor.isEdge(editor, point, blockAbove[1])
        }
        const shouldAlwaysSplit = (point: Point) => !isAtBlockEdge(point)

        splitNodes(editor, {
          at: end,
          match,
          voids,
          always: shouldAlwaysSplit(end),
        })

        splitNodes(editor, {
          at: start,
          match,
          voids,
          always: shouldAlwaysSplit(start),
        })

        target = rangeRef.unref() ?? target

        if (Location.isRange(target)) {
          let [nextStart, nextEnd] = Range.edges(target)
          const [startLeaf] = Editor.leaf(editor, nextStart)
          const [endLeaf] = Editor.leaf(editor, nextEnd)

          if (
            Node.isText(startLeaf) &&
            nextStart.offset === startLeaf.text.length
          ) {
            nextStart =
              Editor.after(editor, nextStart, {
                distance: 1,
                unit: 'offset',
              }) ?? nextStart
          }

          if (Node.isText(endLeaf) && nextEnd.offset === 0) {
            nextEnd =
              Editor.before(editor, nextEnd, {
                distance: 1,
                unit: 'offset',
              }) ?? nextEnd
          }

          target = { anchor: nextStart, focus: nextEnd }
        }

        if (options.at == null) {
          transforms.select(target)
        }
      }

      const roots = Array.from(
        getNodes(editor, {
          at: target,
          match: getEditorSchema(editor).isInline(element)
            ? (node) => Node.isElement(node) && Editor.isBlock(editor, node)
            : (node) => Node.isEditor(node),
          mode: 'lowest',
          voids,
        })
      )
      let nextSelection = Location.isRange(target)
        ? {
            anchor: target.anchor,
            focus: target.focus,
          }
        : null

      for (const [, rootPath] of roots) {
        const scopedTarget = Location.isRange(target)
          ? Range.intersection(target, Editor.range(editor, rootPath))
          : target

        if (!scopedTarget) {
          continue
        }

        const matches = Array.from(
          getNodes(editor, { at: scopedTarget, match, mode, voids })
        )

        if (matches.length === 0) {
          continue
        }

        const [first] = matches
        const last = matches.at(-1)!
        const [, firstPath] = first
        const [, lastPath] = last

        if (firstPath.length === 0 && lastPath.length === 0) {
          continue
        }

        const commonPath = Path.equals(firstPath, lastPath)
          ? Path.parent(firstPath)
          : Path.common(firstPath, lastPath)
        const depth = commonPath.length + 1
        const wrapperPath = Path.next(lastPath.slice(0, depth))
        const firstChildIndex = firstPath[commonPath.length]!
        const lastChildIndex = lastPath[commonPath.length]!
        const movePaths = Array.from(
          { length: lastChildIndex - firstChildIndex + 1 },
          (_, offset) => [...commonPath, firstChildIndex + offset]
        )
        const pathRefs = movePaths.map((path) => Editor.pathRef(editor, path))

        transforms.insertNodes({ ...wrapper }, { at: wrapperPath, voids })
        const wrapperRef = Editor.pathRef(editor, wrapperPath)

        try {
          pathRefs.forEach((pathRef, index) => {
            const path = pathRef.current
            const currentWrapperPath = wrapperRef.current

            if (!path || !currentWrapperPath) {
              return
            }

            moveNodes(editor, {
              at: path,
              to: currentWrapperPath.concat(index),
            })
          })

          if (nextSelection && wrapperRef.current) {
            const mapPoint = (point: Point) => {
              const matchIndex = movePaths.findIndex((path) =>
                Path.equals(path, point.path.slice(0, path.length))
              )

              if (matchIndex < 0) {
                return point
              }

              const basePath = movePaths[matchIndex]!

              return {
                path: [
                  ...wrapperRef.current!,
                  matchIndex,
                  ...point.path.slice(basePath.length),
                ],
                offset: point.offset,
              }
            }

            nextSelection = {
              anchor: mapPoint(nextSelection.anchor),
              focus: mapPoint(nextSelection.focus),
            }
          }
        } finally {
          wrapperRef.unref()
          for (const pathRef of pathRefs) {
            pathRef.unref()
          }
        }
      }

      if (nextSelection) {
        transforms.select(nextSelection)
      }
    })
  })
}
