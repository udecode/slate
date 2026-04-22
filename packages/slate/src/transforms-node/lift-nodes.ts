import { getCurrentSelection, withTransaction } from '../core/public-state'
import { Location, Node, Range } from '../interfaces'
import { Editor } from '../interfaces/editor'
import { Path } from '../interfaces/path'
import { Transforms } from '../interfaces/transforms'
import type { NodeTransforms } from '../interfaces/transforms/node'
import { matchPath } from '../utils/match-path'

export const liftNodes: NodeTransforms['liftNodes'] = (
  editor,
  options = {}
) => {
  const liftNodeAtPath = (path: Path) => {
    const [node] = Editor.node(editor, path)

    if (Node.isText(node)) {
      throw new Error('liftNodes currently supports only element nodes')
    }

    if (path.length < 2) {
      throw new Error('liftNodes requires a path with depth of at least 2')
    }

    const parentPath = path.slice(0, -1)
    const [parent] = Editor.node(editor, parentPath)

    if (Node.isText(parent)) {
      throw new Error('liftNodes requires an element parent')
    }

    const index = path.at(-1)!
    const childCount = parent.children.length

    if (childCount === 1) {
      Transforms.moveNodes(editor, {
        at: path,
        to: [...parentPath.slice(0, -1), parentPath.at(-1)! + 1],
      })
      Transforms.removeNodes(editor, { at: parentPath })
      return
    }

    if (index === 0) {
      Transforms.moveNodes(editor, {
        at: path,
        to: parentPath,
      })
      return
    }

    if (index === childCount - 1) {
      Transforms.moveNodes(editor, {
        at: path,
        to: [...parentPath.slice(0, -1), parentPath.at(-1)! + 1],
      })
      return
    }

    editor.apply({
      type: 'split_node',
      path: parentPath,
      position: index + 1,
      properties: Path.equals(parentPath, []) ? {} : Node.extractProps(parent),
    })

    Transforms.moveNodes(editor, {
      at: path,
      to: [...parentPath.slice(0, -1), parentPath.at(-1)! + 1],
    })
  }

  withTransaction(editor, () => {
    const target = options.at ?? getCurrentSelection(editor)
    const selectionBefore = getCurrentSelection(editor)
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
          : (node) => !Node.isText(node) && Editor.isBlock(editor, node)
      }

      if (Location.isPath(target) && options.match == null) {
        liftNodeAtPath(target)

        if (selectionBefore == null) {
          editor.deselect()
        }

        return
      }

      const pathRefs = Array.from(
        Editor.nodes(editor, { at: target, match, mode, voids }),
        ([, path]) => Editor.pathRef(editor, path)
      )

      for (const pathRef of pathRefs) {
        const path = pathRef.unref()

        if (path) {
          liftNodeAtPath(path)
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
      liftNodeAtPath([...startParentPath, childIndex])
    }

    const mapPoint = (point: typeof start) => ({
      path: [
        selectedBaseIndex + (point.path[1]! - startIndex),
        ...point.path.slice(2),
      ],
      offset: point.offset,
    })

    editor.select({
      anchor: mapPoint(start),
      focus: mapPoint(end),
    })
  })
}
