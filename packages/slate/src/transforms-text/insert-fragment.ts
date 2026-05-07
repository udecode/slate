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
import type { Text } from '../interfaces/text'
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

const getOffsetFragmentEndSelection = (
  fragment: Descendant[],
  startIndex: number
) => {
  const selection = getFragmentEndSelection(fragment)
  const offsetPoint = (point: (typeof selection)['anchor']) => ({
    offset: point.offset,
    path: [point.path[0] + startIndex].concat(point.path.slice(1)),
  })

  return {
    anchor: offsetPoint(selection.anchor),
    focus: offsetPoint(selection.focus),
  }
}

const getBlockChildrenEndSelection = (
  blockPath: Path,
  children: Descendant[]
) => {
  const [lastNode, lastPath] = Node.last({ children } as Ancestor, [])
  const offset = Node.string(lastNode).length
  const path = blockPath.concat(lastPath)

  return {
    anchor: { path, offset },
    focus: { path, offset },
  }
}

const isTextBlockElement = (
  editor: Editor,
  node: Descendant | undefined
): node is Element => {
  if (!node || !Node.isElement(node)) {
    return false
  }

  const schema = getEditorSchema(editor)

  return (
    !schema.isVoid(node) &&
    !schema.isInline(node) &&
    node.children.every(
      (child) =>
        Node.isText(child) || (Node.isElement(child) && schema.isInline(child))
    )
  )
}

const haveSameTextProps = (left: Text, right: Text) => {
  const leftKeys = Object.keys(left).filter((key) => key !== 'text')
  const rightKeys = Object.keys(right).filter((key) => key !== 'text')

  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => left[key] === right[key])
  )
}

const cloneDescendant = <T extends Descendant>(node: T): T =>
  structuredClone(node)

const pushBlockChild = (children: Descendant[], child: Descendant) => {
  if (Node.isText(child)) {
    const previous = children.at(-1)

    if (
      previous &&
      Node.isText(previous) &&
      haveSameTextProps(previous, child)
    ) {
      const offset = previous.text.length + child.text.length
      previous.text += child.text

      return { offset, path: [children.length - 1] }
    }

    children.push({ ...child })

    return { offset: child.text.length, path: [children.length - 1] }
  }

  const nextChild = cloneDescendant(child)
  const index = children.length

  children.push(nextChild)

  const [lastNode, lastPath] = Node.last(nextChild, [])

  return {
    offset: Node.string(lastNode).length,
    path: [index].concat(lastPath),
  }
}

const getSingleEmptyBlockFragmentReplacement = (
  editor: Editor,
  at: Range,
  fragment: Descendant[]
) => {
  if (
    !Range.isCollapsed(at) ||
    !samePoint(at.anchor, { path: [0, 0], offset: 0 })
  ) {
    return null
  }

  const editorChildren = Editor.getChildren(editor)
  const [onlyEditorNode] = editorChildren
  const [onlyFragmentNode] = fragment

  if (
    editorChildren.length !== 1 ||
    !isTextBlockElement(editor, onlyEditorNode) ||
    onlyEditorNode.children.length !== 1 ||
    !Node.isText(onlyEditorNode.children[0]) ||
    onlyEditorNode.children[0].text !== ''
  ) {
    return null
  }

  if (fragment.length === 1 && isTextBlockElement(editor, onlyFragmentNode)) {
    const children = [
      {
        ...onlyEditorNode,
        children: onlyFragmentNode.children,
      },
    ] as Value

    return {
      children,
      previousChildren: editorChildren,
      selection: getBlockChildrenEndSelection([0], onlyFragmentNode.children),
    }
  }

  return {
    children: fragment as Value,
    previousChildren: editorChildren,
    selection: getFragmentEndSelection(fragment),
  }
}

const getTopLevelBlockFragmentReplacement = (
  editor: Editor,
  at: Range,
  fragment: Descendant[]
) => {
  if (Range.isCollapsed(at)) {
    return null
  }

  const [start, end] = Range.edges(at)
  const startIndex = start.path[0]
  const endIndex = end.path[0]

  if (startIndex == null || endIndex == null) {
    return null
  }

  const editorChildren = Editor.getChildren(editor)

  if (startIndex === 0 && endIndex === editorChildren.length - 1) {
    return null
  }

  if (
    !samePoint(start, Editor.point(editor, [startIndex], { edge: 'start' })) ||
    !samePoint(end, Editor.point(editor, [endIndex], { edge: 'end' }))
  ) {
    return null
  }

  const [onlyFragmentNode] = fragment
  const onlyTargetNode =
    startIndex === endIndex ? editorChildren[startIndex] : undefined

  if (
    fragment.length === 1 &&
    isTextBlockElement(editor, onlyTargetNode) &&
    isTextBlockElement(editor, onlyFragmentNode)
  ) {
    return null
  }

  return {
    children: fragment.map(cloneDescendant),
    index: startIndex,
    previousChildren: editorChildren.slice(startIndex, endIndex + 1),
    selection: getOffsetFragmentEndSelection(fragment, startIndex),
  }
}

const getSingleTextBlockFragmentReplacement = (
  editor: Editor,
  at: Range,
  fragment: Descendant[]
) => {
  const [onlyFragmentNode] = fragment

  if (
    !onlyFragmentNode ||
    fragment.length !== 1 ||
    !isTextBlockElement(editor, onlyFragmentNode)
  ) {
    return null
  }

  const [start, end] = Range.edges(at)

  if (
    start.path.length === 0 ||
    end.path.length === 0 ||
    start.path.length !== end.path.length ||
    !start.path.every((segment, index) => segment === end.path[index])
  ) {
    return null
  }

  if (
    Editor.void(editor, { at: start }) ||
    Editor.elementReadOnly(editor, { at: start })
  ) {
    return null
  }

  const blockMatch = Editor.above(editor, {
    at: start,
    match: (node) => Node.isElement(node) && Editor.isBlock(editor, node),
  })

  if (!blockMatch) {
    return null
  }

  const [block, blockPath] = blockMatch

  if (!Node.isElement(block) || !isTextBlockElement(editor, block)) {
    return null
  }

  const textIndex = start.path[blockPath.length]

  if (
    textIndex == null ||
    textIndex !== end.path[blockPath.length] ||
    start.path.length !== blockPath.length + 1
  ) {
    return null
  }

  const targetText = block.children[textIndex]

  if (!Node.isText(targetText)) {
    return null
  }

  const fragmentChildren = onlyFragmentNode.children as Descendant[]
  const before = targetText.text.slice(0, start.offset)
  const after = targetText.text.slice(end.offset)
  const children: Descendant[] = []

  for (const child of block.children.slice(0, textIndex)) {
    pushBlockChild(children, child)
  }

  if (before) {
    pushBlockChild(children, { ...targetText, text: before })
  }

  let insertedEnd:
    | {
        offset: number
        path: Path
      }
    | undefined

  for (const child of fragmentChildren) {
    insertedEnd = pushBlockChild(children, child)
  }

  if (after) {
    pushBlockChild(children, { ...targetText, text: after })
  }

  for (const child of block.children.slice(textIndex + 1)) {
    pushBlockChild(children, child)
  }

  if (children.length === 0) {
    children.push({ ...targetText, text: '' })
  }

  const selectionPoint = insertedEnd ?? { offset: 0, path: [textIndex] }

  return {
    newChildren: children,
    path: blockPath,
    previousChildren: block.children as Descendant[],
    selection: {
      anchor: {
        path: blockPath.concat(selectionPoint.path),
        offset: selectionPoint.offset,
      },
      focus: {
        path: blockPath.concat(selectionPoint.path),
        offset: selectionPoint.offset,
      },
    },
  }
}

const getTopLevelTextBlockFragmentReplacement = (
  editor: Editor,
  at: Range,
  fragment: Descendant[]
) => {
  if (
    fragment.length < 2 ||
    !fragment.every((node) => isTextBlockElement(editor, node))
  ) {
    return null
  }

  const [start, end] = Range.edges(at)

  if (
    start.path.length === 0 ||
    end.path.length === 0 ||
    start.path.length !== end.path.length ||
    !start.path.every((segment, index) => segment === end.path[index])
  ) {
    return null
  }

  if (
    Editor.void(editor, { at: start }) ||
    Editor.elementReadOnly(editor, { at: start })
  ) {
    return null
  }

  const blockMatch = Editor.above(editor, {
    at: start,
    match: (node) => Node.isElement(node) && Editor.isBlock(editor, node),
  })

  if (!blockMatch) {
    return null
  }

  const [block, blockPath] = blockMatch

  if (
    blockPath.length !== 1 ||
    !Node.isElement(block) ||
    !isTextBlockElement(editor, block)
  ) {
    return null
  }

  const textIndex = start.path[blockPath.length]

  if (
    textIndex == null ||
    textIndex !== end.path[blockPath.length] ||
    start.path.length !== blockPath.length + 1
  ) {
    return null
  }

  const targetText = block.children[textIndex]

  if (!Node.isText(targetText)) {
    return null
  }

  const blockIndex = blockPath[0]
  const firstFragmentBlock = fragment[0] as Element
  const lastFragmentBlock = fragment.at(-1) as Element
  const before = targetText.text.slice(0, start.offset)
  const after = targetText.text.slice(end.offset)
  const firstChildren: Descendant[] = []
  const lastChildren: Descendant[] = []

  for (const child of block.children.slice(0, textIndex)) {
    pushBlockChild(firstChildren, child)
  }

  if (before) {
    pushBlockChild(firstChildren, { ...targetText, text: before })
  }

  for (const child of firstFragmentBlock.children) {
    pushBlockChild(firstChildren, child)
  }

  if (firstChildren.length === 0) {
    firstChildren.push({ ...targetText, text: '' })
  }

  let insertedEnd:
    | {
        offset: number
        path: Path
      }
    | undefined

  for (const child of lastFragmentBlock.children) {
    insertedEnd = pushBlockChild(lastChildren, child)
  }

  if (after) {
    pushBlockChild(lastChildren, { ...targetText, text: after })
  }

  for (const child of block.children.slice(textIndex + 1)) {
    pushBlockChild(lastChildren, child)
  }

  if (lastChildren.length === 0) {
    lastChildren.push({ ...targetText, text: '' })
  }

  const firstBlock = {
    ...block,
    children: firstChildren,
  }
  const middleBlocks = fragment.slice(1, -1).map(cloneDescendant)
  const lastBlock = {
    ...block,
    children: lastChildren,
  }
  const selectionPoint = insertedEnd ?? { offset: 0, path: [0] }
  const selection = {
    anchor: {
      path: [blockIndex + fragment.length - 1].concat(selectionPoint.path),
      offset: selectionPoint.offset,
    },
    focus: {
      path: [blockIndex + fragment.length - 1].concat(selectionPoint.path),
      offset: selectionPoint.offset,
    },
  }

  return {
    children: [firstBlock, ...middleBlocks, lastBlock],
    index: blockIndex,
    previousChildren: [block],
    selection,
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
          const editorChildren = Editor.getChildren(editor)
          const [onlyEditorNode] = editorChildren
          const [onlyFragmentNode] = fragment

          if (
            editorChildren.length === 1 &&
            fragment.length === 1 &&
            isTextBlockElement(editor, onlyEditorNode) &&
            isTextBlockElement(editor, onlyFragmentNode)
          ) {
            const children = [
              {
                ...onlyEditorNode,
                children: onlyFragmentNode.children,
              },
            ] as Value
            const selection = getBlockChildrenEndSelection(
              [0],
              onlyFragmentNode.children
            )

            tx.apply({
              children: editorChildren,
              index: 0,
              newChildren: children,
              newSelection: selection,
              path: [],
              selection: tx.getModelSelection(),
              type: 'replace_children',
            })
            return
          }

          tx.apply({
            children: editorChildren,
            index: 0,
            newChildren: fragment as Value,
            newSelection: getFragmentEndSelection(fragment),
            path: [],
            selection: tx.getModelSelection(),
            type: 'replace_children',
          })
          return
        }

        const replacement = getSingleEmptyBlockFragmentReplacement(
          editor,
          at,
          fragment
        )

        if (replacement) {
          tx.apply({
            children: replacement.previousChildren,
            index: 0,
            newChildren: replacement.children,
            newSelection: replacement.selection,
            path: [],
            selection: tx.getModelSelection(),
            type: 'replace_children',
          })
          return
        }

        const textBlockReplacement = getSingleTextBlockFragmentReplacement(
          editor,
          at,
          fragment
        )

        if (textBlockReplacement) {
          tx.apply({
            children: textBlockReplacement.previousChildren,
            index: 0,
            newChildren: textBlockReplacement.newChildren,
            newSelection: textBlockReplacement.selection,
            path: textBlockReplacement.path,
            selection: tx.getModelSelection(),
            type: 'replace_children',
          })
          return
        }

        const topLevelTextBlockReplacement =
          getTopLevelTextBlockFragmentReplacement(editor, at, fragment)

        if (topLevelTextBlockReplacement) {
          tx.apply({
            children: topLevelTextBlockReplacement.previousChildren,
            index: topLevelTextBlockReplacement.index,
            newChildren: topLevelTextBlockReplacement.children,
            newSelection: topLevelTextBlockReplacement.selection,
            path: [],
            selection: tx.getModelSelection(),
            type: 'replace_children',
          })
          return
        }

        const topLevelBlockReplacement = getTopLevelBlockFragmentReplacement(
          editor,
          at,
          fragment
        )

        if (topLevelBlockReplacement) {
          tx.apply({
            children: topLevelBlockReplacement.previousChildren,
            index: topLevelBlockReplacement.index,
            newChildren: topLevelBlockReplacement.children,
            newSelection: topLevelBlockReplacement.selection,
            path: [],
            selection: tx.getModelSelection(),
            type: 'replace_children',
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
      const [onlyFragmentNode] = fragment
      const preserveEmptyTargetBlock =
        isBlockEmpty &&
        fragment.length === 1 &&
        isTextBlockElement(editor, onlyFragmentNode)

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
          if (preserveEmptyTargetBlock && p.length === 1) {
            return false
          }

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
