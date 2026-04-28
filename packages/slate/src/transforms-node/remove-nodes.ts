import { applyOperation, withTransaction } from '../core/public-state'
import { type Descendant, Location, Node } from '../interfaces'
import { Editor } from '../interfaces/editor'
import type { NodeMutationMethods } from '../interfaces/transforms/node'
import { matchPath } from '../utils/match-path'

export const removeNodes: NodeMutationMethods['removeNodes'] = (
  editor,
  options = {}
) => {
  withTransaction(editor, (tx) => {
    Editor.withoutNormalizing(editor, () => {
      const { hanging = false, voids = false, mode = 'lowest' } = options
      let { match } = options
      let at = tx.resolveTarget({ at: options.at })

      if (!at) {
        return
      }

      if (match == null) {
        match = Location.isPath(at)
          ? matchPath(editor, at)
          : (n) => Node.isElement(n) && Editor.isBlock(editor, n)
      }

      if (!hanging && Location.isRange(at)) {
        at = Editor.unhangRange(editor, at, { voids })
      }

      const depths = Editor.nodes(editor, { at, match, mode, voids })
      const pathRefs = Array.from(depths, ([, p]) => Editor.pathRef(editor, p))

      for (const pathRef of pathRefs) {
        const path = pathRef.unref()!

        if (path) {
          const [node] = Editor.node(editor, path)
          applyOperation(editor, {
            type: 'remove_node',
            path,
            node: node as Descendant,
          })
        }
      }
    })
  })
}
