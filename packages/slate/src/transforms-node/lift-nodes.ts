import { runEditorTransaction } from '../core/public-state'
import { getEditorTransformRegistry } from '../core/transform-registry'
import { node as getNode } from '../editor/node'
import { nodes as getNodes } from '../editor/nodes'
import {
  type Ancestor,
  Location,
  Node,
  type Operation,
  Range,
} from '../interfaces'
import { Editor } from '../interfaces/editor'
import { Path } from '../interfaces/path'
import type { NodeMutationMethods } from '../interfaces/transforms/node'
import { matchPath } from '../utils/match-path'

const getChildren = (editor: Editor, node: Ancestor) =>
  Node.isEditor(node) ? Editor.getChildren(editor) : node.children

export const liftNodes: NodeMutationMethods['liftNodes'] = (
  editor,
  options = {}
) => {
  const liftNodeAtPath = (
    path: Path,
    tx: { apply: (operation: Operation) => void }
  ) => {
    const transforms = getEditorTransformRegistry(editor)
    const [node] = getNode(editor, path)

    if (Node.isText(node)) {
      throw new Error('liftNodes currently supports only element nodes')
    }

    if (path.length < 2) {
      throw new Error('liftNodes requires a path with depth of at least 2')
    }

    const parentPath = path.slice(0, -1)
    const [parent] = getNode(editor, parentPath)

    if (Node.isText(parent)) {
      throw new Error('liftNodes requires an element parent')
    }

    const index = path.at(-1)!
    const childCount = getChildren(editor, parent).length

    if (childCount === 1) {
      transforms.moveNodes({
        at: path,
        to: [...parentPath.slice(0, -1), parentPath.at(-1)! + 1],
      })
      transforms.removeNodes({ at: parentPath })
      return
    }

    if (index === 0) {
      transforms.moveNodes({
        at: path,
        to: parentPath,
      })
      return
    }

    if (index === childCount - 1) {
      transforms.moveNodes({
        at: path,
        to: [...parentPath.slice(0, -1), parentPath.at(-1)! + 1],
      })
      return
    }

    tx.apply({
      type: 'split_node',
      path: parentPath,
      position: index + 1,
      properties:
        Path.equals(parentPath, []) || Node.isEditor(parent)
          ? {}
          : Node.extractProps(parent),
    })

    transforms.moveNodes({
      at: path,
      to: [...parentPath.slice(0, -1), parentPath.at(-1)! + 1],
    })
  }

  runEditorTransaction(editor, (tx) => {
    const target = tx.resolveTarget({ at: options.at })
    const selectionBefore = tx.getModelSelection()
    const mode = options.mode ?? 'lowest'
    const voids = options.voids ?? false
    let { match } = options

    if (!target) {
      return
    }

    if (match != null || !Location.isRange(target)) {
      if (match == null) {
        match = Location.isPath(target)
          ? matchPath(editor, target)
          : (node) => Node.isElement(node) && Editor.isBlock(editor, node)
      }

      if (Location.isPath(target) && options.match == null) {
        liftNodeAtPath(target, tx)

        if (selectionBefore == null) {
          getEditorTransformRegistry(editor).deselect()
        }

        return
      }

      const pathRefs = Array.from(
        getNodes(editor, { at: target, match, mode, voids }),
        ([, path]) => Editor.pathRef(editor, path)
      )

      for (const pathRef of pathRefs) {
        const path = pathRef.unref()

        if (path) {
          liftNodeAtPath(path, tx)
        }
      }

      return
    }

    const [start, end] = Range.edges(target)
    const startChildPath = start.path.slice(0, -1)
    const endChildPath = end.path.slice(0, -1)
    const startParentPath = startChildPath.slice(0, -1)
    const endParentPath = endChildPath.slice(0, -1)

    if (
      startParentPath.length !== 1 ||
      endParentPath.length !== 1 ||
      Path.compare(startParentPath, endParentPath) !== 0
    ) {
      throw new Error(
        'liftNodes currently supports only top-level wrapper-child ranges'
      )
    }

    const startIndex = startChildPath.at(-1)
    const endIndex = endChildPath.at(-1)

    if (startIndex == null || endIndex == null) {
      throw new Error(
        'liftNodes currently supports only top-level wrapper-child ranges'
      )
    }

    const wrapperIndex = startParentPath[0]!
    const selectedBaseIndex = wrapperIndex + (startIndex > 0 ? 1 : 0)

    for (let childIndex = endIndex; childIndex >= startIndex; childIndex -= 1) {
      liftNodeAtPath([...startParentPath, childIndex], tx)
    }

    const mapPoint = (point: typeof start) => ({
      path: [
        selectedBaseIndex + (point.path[1]! - startIndex),
        ...point.path.slice(2),
      ],
      offset: point.offset,
    })

    getEditorTransformRegistry(editor).select({
      anchor: mapPoint(start),
      focus: mapPoint(end),
    })
  })
}
