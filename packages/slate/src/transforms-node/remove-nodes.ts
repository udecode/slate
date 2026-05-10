import { applyOperation, runEditorTransaction } from '../core/public-state'
import { node as getNode } from '../editor/node'
import { nodes as getNodes } from '../editor/nodes'
import { type Descendant, Location, Node } from '../interfaces'
import { Editor } from '../interfaces/editor'
import type { NodeMutationMethods } from '../interfaces/transforms/node'
import { matchPath } from '../utils/match-path'

export const removeNodes: NodeMutationMethods['removeNodes'] = (
  editor,
  options = {}
) => {
  runEditorTransaction(editor, (tx) => {
    Editor.withoutNormalizing(editor, () => {
      const { hanging = false, voids = false, mode = 'lowest' } = options
      let { match } = options
      let at = tx.resolveTarget({ at: options.at })

      if (!at) {
        return
      }

      if (Location.isPath(at) && at.length === 0) {
        throw new Error('Cannot remove the editor root.')
      }

      if (match == null) {
        match = Location.isPath(at)
          ? matchPath(editor, at)
          : (n) => Node.isElement(n) && Editor.isBlock(editor, n)
      }

      if (!hanging && Location.isRange(at)) {
        at = Editor.unhangRange(editor, at, { voids })
      }

      const depths = getNodes(editor, { at, match, mode, voids })
      const pathRefs = Array.from(depths, ([, p]) => Editor.pathRef(editor, p))

      for (const pathRef of pathRefs) {
        const path = pathRef.unref()!

        if (path) {
          const [node] = getNode(editor, path)
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
