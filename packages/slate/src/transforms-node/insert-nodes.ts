import { batchDirtyPaths } from '../core/batch-dirty-paths'
import { applyOperation, withTransaction } from '../core/public-state'
import { updateDirtyPaths } from '../core/update-dirty-paths'
import {
  type BaseInsertNodeOperation,
  type Descendant,
  Editor,
  Location,
  Node,
  Path,
  Range,
} from '../interfaces'
import type { NodeMutationMethods } from '../interfaces/transforms/node'
import { getDefaultInsertLocation } from '../utils'

export const insertNodes: NodeMutationMethods<any>['insertNodes'] = (
  editor,
  nodes,
  options = {}
) => {
  withTransaction(editor, (tx) => {
    Editor.withoutNormalizing(editor, () => {
      const {
        hanging = false,
        voids = false,
        mode = 'lowest',
        batchDirty = true,
      } = options
      let at: Location | undefined = options.at
      let { match, select } = options

      const nextNodes = (Node.isNode(nodes) ? [nodes] : nodes) as Node[]

      if (nextNodes.length === 0) {
        return
      }

      const [node] = nextNodes

      if (!at) {
        const target = tx.resolveTarget()
        if (target) {
          at = target
        }
        if (!at && tx.getModelSelection() == null) {
          at = getDefaultInsertLocation(editor)
        }
        if (!at) {
          return
        }
        if (select !== false) {
          select = true
        }
      }

      if (select == null) {
        select = false
      }

      if (Location.isRange(at)) {
        if (!hanging) {
          at = Editor.unhangRange(editor, at, { voids })
        }

        if (Range.isCollapsed(at)) {
          at = at.anchor
        } else {
          const [, end] = Range.edges(at)
          const pointRef = Editor.pointRef(editor, end)
          editor.delete({ at })
          at = pointRef.unref()!
        }
      }

      if (Location.isPoint(at)) {
        if (match == null) {
          if (Node.isText(node)) {
            match = (n) => Node.isText(n)
          } else if (Node.isElement(node) && editor.isInline(node)) {
            match = (n) =>
              Node.isText(n) ||
              (Node.isElement(n) && Editor.isInline(editor, n))
          } else {
            match = (n) => Node.isElement(n) && Editor.isBlock(editor, n)
          }
        }

        const [entry] = Editor.nodes(editor, {
          at: at.path,
          match,
          mode,
          voids,
        })

        if (!entry) {
          return
        }

        const [, matchPath] = entry
        const pathRef = Editor.pathRef(editor, matchPath)
        const isAtEnd = Editor.isEnd(editor, at, matchPath)
        editor.splitNodes({ at, match, mode, voids })
        const path = pathRef.unref()!
        at = isAtEnd ? Path.next(path) : path
      }

      const parentPath = Path.parent(at)
      let index = at.at(-1)!

      if (!voids && Editor.void(editor, { at: parentPath })) {
        return
      }

      if (batchDirty) {
        const batchedOps: BaseInsertNodeOperation[] = []
        const newDirtyPaths: Path[] = Path.levels(parentPath)

        batchDirtyPaths(
          editor,
          () => {
            for (const child of nextNodes as Node[]) {
              const path = parentPath.concat(index)
              index++

              const op: BaseInsertNodeOperation = {
                type: 'insert_node',
                path,
                node: child as Descendant,
              }

              applyOperation(editor, op)
              at = Path.next(at as Path)
              batchedOps.push(op)

              if (Node.isText(child)) {
                newDirtyPaths.push(path)
              } else {
                newDirtyPaths.push(
                  ...Array.from(Node.nodes(child), ([, childPath]) =>
                    path.concat(childPath)
                  )
                )
              }
            }
          },
          () => {
            updateDirtyPaths(editor, newDirtyPaths, (path) => {
              let nextPath: Path | null = path

              for (const op of batchedOps) {
                nextPath = Path.transform(nextPath, op)

                if (!nextPath) {
                  return null
                }
              }

              return nextPath
            })
          }
        )
      } else {
        for (const child of nextNodes as Node[]) {
          const path = parentPath.concat(index)
          index++

          applyOperation(editor, {
            type: 'insert_node',
            path,
            node: child as Descendant,
          })
          at = Path.next(at as Path)
        }
      }

      at = Path.previous(at)

      if (select) {
        const point = Editor.end(editor, at)

        if (point) {
          editor.select(point)
        }
      }
    })
  })
}
