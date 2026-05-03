import { executeCommand } from '../core/command-registry'
import { getEditorSchema } from '../core/editor-runtime'
import { getOperationCount, runEditorTransaction } from '../core/public-state'
import { getEditorTransformRegistry } from '../core/transform-registry'
import { nodes as getNodes } from '../editor/nodes'
import { Location } from '../interfaces'
import type { Value } from '../interfaces/editor'
import { Editor } from '../interfaces/editor'
import type { Element } from '../interfaces/element'
import {
  type Ancestor,
  type Descendant,
  Node,
  type NodeEntry,
} from '../interfaces/node'
import { Path } from '../interfaces/path'
import { Range } from '../interfaces/range'
import type { TextMutationMethods } from '../interfaces/transforms/text'
import { getDefaultInsertLocation } from '../utils'

type InsertFragmentCommand = {
  fragment: Parameters<TextMutationMethods['insertFragment']>[1]
  options: Parameters<TextMutationMethods['insertFragment']>[2]
  type: 'insert_fragment'
}

const samePoint = (
  left: { offset: number; path: readonly number[] },
  right: { offset: number; path: readonly number[] }
) =>
  left.offset === right.offset &&
  left.path.length === right.path.length &&
  left.path.every((segment, index) => segment === right.path[index])

const isFullDocumentRange = (editor: Editor, range: Range) => {
  if (Range.isCollapsed(range)) {
    return false
  }

  if (Editor.getChildren(editor).length === 0) {
    return false
  }

  const start = Editor.point(editor, [], { edge: 'start' })
  const end = Editor.point(editor, [], { edge: 'end' })

  return (
    (samePoint(range.anchor, start) && samePoint(range.focus, end)) ||
    (samePoint(range.anchor, end) && samePoint(range.focus, start))
  )
}

const getFragmentEndSelection = (fragment: Descendant[]) => {
  const [lastNode, lastPath] = Node.last({ children: fragment } as Ancestor, [])
  const offset = Node.string(lastNode).length

  return {
    anchor: { path: lastPath, offset },
    focus: { path: lastPath, offset },
  }
}

const applyInsertFragment: TextMutationMethods['insertFragment'] = (
  editor,
  fragment,
  options = {}
) => {
  runEditorTransaction(editor, (tx) => {
    const operationCount = getOperationCount(editor)

    Editor.withoutNormalizing(editor, () => {
      const transforms = getEditorTransformRegistry(editor)
      const { hanging = false, voids = false } = options
      const { batchDirty = true } = options
      let at = tx.resolveTarget({ at: options.at })

      if (!fragment.length) {
        return
      }

      if (!at && options.at === undefined && tx.getModelSelection() == null) {
        at = getDefaultInsertLocation(editor)
      }

      if (!at) {
        return
      }

      if (Location.isRange(at)) {
        if (!hanging) {
          at = Editor.unhangRange(editor, at, { voids })
        }

        if (isFullDocumentRange(editor, at)) {
          Editor.replace(editor, {
            children: fragment as Value,
            selection: getFragmentEndSelection(fragment),
          })
          return
        }

        if (Range.isCollapsed(at)) {
          at = at.anchor
        } else {
          const [, end] = Range.edges(at)

          if (!voids && Editor.void(editor, { at: end })) {
            return
          }

          const pointRef = Editor.pointRef(editor, end)
          transforms.delete({ at })
          at = pointRef.unref()!
        }
      } else if (Location.isPath(at)) {
        at = Editor.point(editor, at, { edge: 'start' })
      }

      if (!voids && Editor.void(editor, { at })) {
        return
      }

      // If the insert point is at the edge of an inline node, move it outside
      // instead since it will need to be split otherwise.
      const inlineElementMatch = Editor.above(editor, {
        at,
        match: (n) => Node.isElement(n) && Editor.isInline(editor, n),
        mode: 'highest',
        voids,
      })

      if (inlineElementMatch) {
        const [, inlinePath] = inlineElementMatch

        if (Editor.isEnd(editor, at, inlinePath)) {
          const after = Editor.after(editor, inlinePath)!
          at = after
        } else if (Editor.isStart(editor, at, inlinePath)) {
          const before = Editor.before(editor, inlinePath)!
          at = before
        }
      }

      const blockMatch = Editor.above(editor, {
        match: (n) => Node.isElement(n) && Editor.isBlock(editor, n),
        at,
        voids,
      })!
      const [, blockPath] = blockMatch
      const isBlockStart = Editor.isStart(editor, at, blockPath)
      const isBlockEnd = Editor.isEnd(editor, at, blockPath)
      const isBlockEmpty = isBlockStart && isBlockEnd
      const fragmentRoot = { children: fragment } as Ancestor
      const [, firstLeafPath] = Node.first(fragmentRoot, [])
      const [, lastLeafPath] = Node.last(fragmentRoot, [])

      // For each node in the fragment, determine what level of wrapping should
      // be kept. At minimum, all text nodes will be inserted, but if
      // `shouldInsert` returns true for some ancestor of a particular text node,
      // then the entire ancestor will be inserted rather than inserting the text
      // nodes individually.
      const shouldInsert = ([n, p]: NodeEntry) => {
        const isRoot = p.length === 0
        if (isRoot) {
          return false
        }

        // If the destination block is empty, insert all top-level blocks of the
        // fragment.
        if (isBlockEmpty) {
          return true
        }

        // Unless we're at the start of the destination block, unwrap any
        // non-void blocks that contain the first leaf node in the fragment.
        if (
          !isBlockStart &&
          Path.isAncestor(p, firstLeafPath) &&
          Node.isElement(n) &&
          !getEditorSchema(editor).isVoid(n) &&
          !getEditorSchema(editor).isInline(n)
        ) {
          return false
        }

        // Unless we're at the end of the destination block, unwrap any non-void
        // blocks that contain the last leaf node in the fragment.
        if (
          !isBlockEnd &&
          Path.isAncestor(p, lastLeafPath) &&
          Node.isElement(n) &&
          !getEditorSchema(editor).isVoid(n) &&
          !getEditorSchema(editor).isInline(n)
        ) {
          return false
        }

        // Always insert void nodes, inline elements and text nodes.
        return true
      }

      // Whether the current node is in the first block of the fragment.
      let starting = true

      // Inline nodes in the first block of the fragment, to be merged with the
      // destination block.
      const starts: Descendant[] = []

      // Blocks in the middle of the fragment.
      const middles: Element[] = []

      // Inline nodes in the last block of the fragment, to be merged with the
      // destination block. If the fragment contains only one block, this will be
      // empty.
      const ends: Descendant[] = []

      for (const entry of Node.nodes(fragmentRoot, { pass: shouldInsert })) {
        const [node, path] = entry

        if (Node.isEditor(node)) {
          continue
        }

        // If we encounter a block that does not contain the first leaf, we're no
        // longer in the first block of the fragment.
        if (
          starting &&
          Node.isElement(node) &&
          !getEditorSchema(editor).isInline(node) &&
          !Path.isAncestor(path, firstLeafPath)
        ) {
          starting = false
        }

        if (shouldInsert(entry)) {
          if (Node.isElement(node) && !getEditorSchema(editor).isInline(node)) {
            starting = false
            middles.push(node)
          } else if (starting) {
            starts.push(node)
          } else {
            ends.push(node)
          }
        }
      }

      const [inlineMatch] = getNodes(editor, {
        at,
        match: (n) =>
          Node.isText(n) || (Node.isElement(n) && Editor.isInline(editor, n)),
        mode: 'highest',
        voids,
      })!

      const [, inlinePath] = inlineMatch
      const isInlineStart = Editor.isStart(editor, at, inlinePath)
      const isInlineEnd = Editor.isEnd(editor, at, inlinePath)

      const middleRef = Editor.pathRef(
        editor,
        isBlockEnd && !ends.length ? Path.next(blockPath) : blockPath
      )

      const endRef = Editor.pathRef(
        editor,
        isInlineEnd ? Path.next(inlinePath) : inlinePath
      )

      // If the fragment contains inlines in multiple distinct blocks, split the
      // destination block.
      const splitBlock = ends.length > 0

      transforms.splitNodes({
        at,
        match: (n) =>
          splitBlock
            ? Node.isElement(n) && Editor.isBlock(editor, n)
            : Node.isText(n) ||
              (Node.isElement(n) && Editor.isInline(editor, n)),
        mode: splitBlock ? 'lowest' : 'highest',
        always:
          splitBlock &&
          (!isBlockStart || starts.length > 0) &&
          (!isBlockEnd || ends.length > 0),
        voids,
      })

      const startRef = Editor.pathRef(
        editor,
        !isInlineStart || (isInlineStart && isInlineEnd)
          ? Path.next(inlinePath)
          : inlinePath
      )

      transforms.insertNodes(starts, {
        at: startRef.current!,
        match: (n) =>
          Node.isText(n) || (Node.isElement(n) && Editor.isInline(editor, n)),
        mode: 'highest',
        voids,
        batchDirty,
      })

      if (isBlockEmpty && !starts.length && middles.length && !ends.length) {
        transforms.delete({ at: blockPath, voids })
      }

      transforms.insertNodes(middles, {
        at: middleRef.current!,
        match: (n) => Node.isElement(n) && Editor.isBlock(editor, n),
        mode: 'lowest',
        voids,
        batchDirty,
      })

      transforms.insertNodes(ends, {
        at: endRef.current!,
        match: (n) =>
          Node.isText(n) || (Node.isElement(n) && Editor.isInline(editor, n)),
        mode: 'highest',
        voids,
        batchDirty,
      })

      if (!options.at) {
        let path: Path | undefined

        if (ends.length > 0 && endRef.current) {
          path = Path.previous(endRef.current)
        } else if (middles.length > 0 && middleRef.current) {
          path = Path.previous(middleRef.current)
        } else if (startRef.current) {
          path = Path.previous(startRef.current)
        }

        if (path) {
          const end = Editor.point(editor, path, { edge: 'end' })
          transforms.select(end)
        }
      }

      startRef.unref()
      middleRef.unref()
      endRef.unref()
    })

    if (getOperationCount(editor) > operationCount) {
      Editor.normalize(editor)
    }
  })
}

export const insertFragment: TextMutationMethods['insertFragment'] = (
  editor,
  fragment,
  options = {}
) => {
  executeCommand<InsertFragmentCommand>(
    editor,
    { fragment, options, type: 'insert_fragment' },
    (command) => {
      applyInsertFragment(editor, command.fragment, command.options)
      return { handled: true }
    }
  )
}
