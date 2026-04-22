import { getCurrentSelection, withTransaction } from '../core/public-state'
import { Location, Node } from '../interfaces'
import { Editor } from '../interfaces/editor'
import { Path } from '../interfaces/path'
import type { NodeTransforms } from '../interfaces/transforms/node'

export const moveNodes: NodeTransforms['moveNodes'] = (editor, options) => {
  withTransaction(editor, () => {
    const {
      to,
      at = getCurrentSelection(editor),
      mode = 'lowest',
      voids = false,
    } = options
    let { match } = options

    if (!at) {
      return
    }

    if (match == null) {
      if (Location.isPath(at)) {
        if (at.length !== 0) {
          const sameParentForwardMove =
            at.length === to.length &&
            at.at(-1) != null &&
            to.at(-1) != null &&
            Path.equals(at.slice(0, -1), to.slice(0, -1)) &&
            at.at(-1)! < to.at(-1)!

          const effectiveTo = sameParentForwardMove
            ? [
                ...to.slice(0, -1),
                Math.min(
                  to.at(-1)!,
                  (
                    Editor.node(editor, at.slice(0, -1) as Path)[0] as {
                      children: unknown[]
                    }
                  ).children.length - 1
                ),
              ]
            : to

          editor.apply({
            type: 'move_node',
            path: at,
            newPath: effectiveTo,
          })
        }

        return
      }

      match = (n) => Node.isElement(n) && Editor.isBlock(editor, n)
    }

    const toRef = Editor.pathRef(editor, to)
    const pathRefs = Array.from(
      Editor.nodes(editor, { at, match, mode, voids }),
      ([, path]) => Editor.pathRef(editor, path)
    )

    for (const pathRef of pathRefs) {
      const path = pathRef.unref()
      const newPath = toRef.current

      if (!path || !newPath || path.length === 0) {
        continue
      }

      editor.apply({
        type: 'move_node',
        path,
        newPath,
      })

      if (
        toRef.current &&
        Path.isSibling(newPath, path) &&
        Path.isAfter(newPath, path)
      ) {
        toRef.current = Path.next(toRef.current)
      }
    }

    toRef.unref()
  })
}
