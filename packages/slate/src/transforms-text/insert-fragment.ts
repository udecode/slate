import { executeCommand } from '../core/command-registry'
import { getEditorSchema } from '../core/editor-runtime'
import { getOperationCount, runEditorTransaction } from '../core/public-state'
import { getEditorTransformRegistry } from '../core/transform-registry'
import { nodes as getNodes } from '../editor/nodes'
import { LocationApi } from '../interfaces'
import type { Value } from '../interfaces/editor'
import { Editor } from '../interfaces/editor'
import type { Element } from '../interfaces/element'
import {
  type Ancestor,
  type Descendant,
  NodeApi,
  type NodeEntry,
} from '../interfaces/node'
import { type Path, PathApi } from '../interfaces/path'
import { type Range, RangeApi } from '../interfaces/range'
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
  if (RangeApi.isCollapsed(range)) {
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
  const [lastNode, lastPath] = NodeApi.last(
    { children: fragment } as Ancestor,
    []
  )
  const offset = NodeApi.string(lastNode).length

  return {
    anchor: { path: lastPath, offset },
    focus: { path: lastPath, offset },
  }
}

const getOffsetFragmentEndSelection = (
  fragment: Descendant[],
  startIndex: number,
  pathPrefix: Path = []
) => {
  const selection = getFragmentEndSelection(fragment)
  const offsetPoint = (point: (typeof selection)['anchor']) => ({
    offset: point.offset,
    path: pathPrefix.concat([point.path[0] + startIndex], point.path.slice(1)),
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
  const [lastNode, lastPath] = NodeApi.last({ children } as Ancestor, [])
  const offset = NodeApi.string(lastNode).length
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
  if (!node || !NodeApi.isElement(node)) {
    return false
  }

  const schema = getEditorSchema(editor)

  return (
    !schema.isVoid(node) &&
    !schema.isInline(node) &&
    node.children.every(
      (child) =>
        NodeApi.isText(child) ||
        (NodeApi.isElement(child) && schema.isInline(child))
    )
  )
}

const isBlockElement = (
  editor: Editor,
  node: Descendant | undefined
): node is Element => {
  if (!node || !NodeApi.isElement(node)) {
    return false
  }

  return !getEditorSchema(editor).isInline(node)
}

const isStructuralBlockElement = (
  editor: Editor,
  node: Descendant | undefined
): node is Element =>
  isBlockElement(editor, node) && !isTextBlockElement(editor, node)

const hasSameElementType = (left: Element, right: Element) =>
  (left as Record<string, unknown>).type ===
  (right as Record<string, unknown>).type

const getTextChildrenEndPoint = (children: Descendant[], fallbackIndex = 0) => {
  const root = { children } as Ancestor
  const [lastNode, lastPath] =
    children.length > 0
      ? NodeApi.last(root, [])
      : [{ text: '' } as Text, [fallbackIndex]]

  return {
    offset: NodeApi.string(lastNode).length,
    path: lastPath,
  }
}

const createTextBlock = (block: Element, children: Descendant[]): Element => ({
  ...block,
  children: children.length > 0 ? children : [{ text: '' }],
})

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

const getPointAfterInlineVoid = (
  editor: Editor,
  children: Descendant[],
  point: { offset: number; path: Path }
) => {
  const childIndex = point.path[0]
  const child = childIndex == null ? undefined : children[childIndex]

  if (
    childIndex == null ||
    child == null ||
    !NodeApi.isElement(child) ||
    !getEditorSchema(editor).isInline(child) ||
    !getEditorSchema(editor).isVoid(child)
  ) {
    return point
  }

  const nextIndex = childIndex + 1
  const next = children[nextIndex]

  if (next == null || !NodeApi.isText(next)) {
    children.splice(nextIndex, 0, { text: '' })
  }

  return { offset: 0, path: [nextIndex] }
}

const pushBlockChild = (
  editor: Editor,
  children: Descendant[],
  child: Descendant
) => {
  if (NodeApi.isText(child)) {
    const previous = children.at(-1)

    if (
      previous &&
      NodeApi.isText(previous) &&
      haveSameTextProps(previous, child)
    ) {
      const offset = previous.text.length + child.text.length
      previous.text += child.text

      return { offset, path: [children.length - 1] }
    }

    children.push({ ...child })

    return { offset: child.text.length, path: [children.length - 1] }
  }

  const schema = getEditorSchema(editor)

  if (schema.isInline(child)) {
    const previous = children.at(-1)

    if (!previous || !NodeApi.isText(previous)) {
      children.push({ text: '' })
    }
  }

  const nextChild = cloneDescendant(child)
  const index = children.length

  children.push(nextChild)

  if (schema.isInline(child)) {
    children.push({ text: '' })
  }

  const [lastNode, lastPath] = NodeApi.last(nextChild, [])

  return {
    offset: NodeApi.string(lastNode).length,
    path: [index].concat(lastPath),
  }
}

const getSingleEmptyBlockFragmentReplacement = (
  editor: Editor,
  at: Range,
  fragment: Descendant[]
) => {
  if (
    !RangeApi.isCollapsed(at) ||
    !samePoint(at.anchor, { path: [0, 0], offset: 0 })
  ) {
    return null
  }

  const editorChildren = Editor.getChildren(editor)
  const [onlyEditorNode] = editorChildren

  if (
    editorChildren.length !== 1 ||
    !isTextBlockElement(editor, onlyEditorNode) ||
    onlyEditorNode.children.length !== 1 ||
    !NodeApi.isText(onlyEditorNode.children[0]) ||
    onlyEditorNode.children[0].text !== ''
  ) {
    return null
  }

  if (fragment.every((node) => isTextBlockElement(editor, node))) {
    const [firstFragmentNode, ...tailFragmentNodes] = fragment

    if (!isTextBlockElement(editor, firstFragmentNode)) {
      return null
    }

    if (fragment.length === 1) {
      return null
    }

    const firstBlock = {
      ...onlyEditorNode,
      children: firstFragmentNode.children.map(cloneDescendant),
    }

    return {
      children: [
        firstBlock,
        ...tailFragmentNodes.map(cloneDescendant),
      ] as Value,
      previousChildren: editorChildren,
      selection:
        fragment.length === 1
          ? getBlockChildrenEndSelection([0], firstFragmentNode.children)
          : getFragmentEndSelection(fragment),
    }
  }

  if (fragment.every((node) => isBlockElement(editor, node))) {
    return {
      children: fragment as Value,
      previousChildren: editorChildren,
      selection: getFragmentEndSelection(fragment),
    }
  }

  return null
}

const getTopLevelBlockFragmentReplacement = (
  editor: Editor,
  at: Range,
  fragment: Descendant[]
) => {
  if (RangeApi.isCollapsed(at)) {
    return null
  }

  const [start, end] = RangeApi.edges(at)
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

  const [start, end] = RangeApi.edges(at)

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
    match: (node) => NodeApi.isElement(node) && Editor.isBlock(editor, node),
  })

  if (!blockMatch) {
    return null
  }

  const [block, blockPath] = blockMatch

  if (!NodeApi.isElement(block) || !isTextBlockElement(editor, block)) {
    return null
  }

  const textIndex = start.path[blockPath.length]

  if (
    textIndex == null ||
    textIndex !== end.path[blockPath.length] ||
    start.path.length !== end.path.length ||
    !start.path.every((segment, index) => segment === end.path[index])
  ) {
    return null
  }

  const targetChild = block.children[textIndex]

  if (NodeApi.isText(targetChild)) {
    if (start.path.length !== blockPath.length + 1) {
      return null
    }

    const fragmentChildren = onlyFragmentNode.children as Descendant[]
    const before = targetChild.text.slice(0, start.offset)
    const after = targetChild.text.slice(end.offset)
    const children: Descendant[] = []

    for (const child of block.children.slice(0, textIndex)) {
      pushBlockChild(editor, children, child)
    }

    if (before) {
      pushBlockChild(editor, children, { ...targetChild, text: before })
    }

    let insertedEnd:
      | {
          offset: number
          path: Path
        }
      | undefined

    for (const child of fragmentChildren) {
      insertedEnd = pushBlockChild(editor, children, child)
    }

    if (after) {
      pushBlockChild(editor, children, { ...targetChild, text: after })
    }

    for (const child of block.children.slice(textIndex + 1)) {
      pushBlockChild(editor, children, child)
    }

    if (children.length === 0) {
      children.push({ ...targetChild, text: '' })
    }

    const selectionPoint = insertedEnd
      ? getPointAfterInlineVoid(editor, children, insertedEnd)
      : { offset: 0, path: [textIndex] }

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

  if (
    !NodeApi.isElement(targetChild) ||
    !Editor.isInline(editor, targetChild)
  ) {
    return null
  }

  const targetTextIndex = start.path[blockPath.length + 1]

  if (
    targetTextIndex == null ||
    targetTextIndex !== end.path[blockPath.length + 1] ||
    start.path.length !== blockPath.length + 2
  ) {
    return null
  }

  const targetText = targetChild.children[targetTextIndex]

  if (!NodeApi.isText(targetText)) {
    return null
  }

  const fragmentChildren = onlyFragmentNode.children as Descendant[]
  const before = targetText.text.slice(0, start.offset)
  const after = targetText.text.slice(end.offset)
  const children: Descendant[] = []

  for (const child of block.children.slice(0, textIndex)) {
    pushBlockChild(editor, children, child)
  }

  if (before) {
    pushBlockChild(editor, children, {
      ...targetChild,
      children: [{ ...targetText, text: before }],
    })
  }

  let insertedEnd:
    | {
        offset: number
        path: Path
      }
    | undefined

  for (const child of fragmentChildren) {
    insertedEnd = pushBlockChild(editor, children, child)
  }

  if (after) {
    pushBlockChild(editor, children, {
      ...targetChild,
      children: [{ ...targetText, text: after }],
    })
  }

  for (const child of block.children.slice(textIndex + 1)) {
    pushBlockChild(editor, children, child)
  }

  if (children.length === 0) {
    children.push({ ...targetChild, children: [{ ...targetText, text: '' }] })
  }

  const selectionPoint = insertedEnd
    ? getPointAfterInlineVoid(editor, children, insertedEnd)
    : { offset: 0, path: [textIndex] }

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

const getEmptyTopLevelTextBlockFragmentReplacement = (
  editor: Editor,
  at: Range,
  fragment: Descendant[]
) => {
  if (!RangeApi.isCollapsed(at)) {
    return null
  }

  const [onlyFragmentNode] = fragment

  if (
    fragment.length === 0 ||
    !fragment.every((node) => isTextBlockElement(editor, node)) ||
    !isTextBlockElement(editor, onlyFragmentNode)
  ) {
    return null
  }

  const blockMatch = Editor.above(editor, {
    at,
    match: (node) => NodeApi.isElement(node) && Editor.isBlock(editor, node),
  })

  if (!blockMatch) {
    return null
  }

  const [block, blockPath] = blockMatch

  if (
    blockPath.length !== 1 ||
    !NodeApi.isElement(block) ||
    !isTextBlockElement(editor, block) ||
    block.children.length !== 1 ||
    !NodeApi.isText(block.children[0]) ||
    block.children[0].text !== '' ||
    !samePoint(at.anchor, { path: blockPath.concat(0), offset: 0 })
  ) {
    return null
  }

  if (fragment.length > 1) {
    return {
      children: fragment.map(cloneDescendant),
      index: blockPath[0],
      previousChildren: [block],
      selection: getOffsetFragmentEndSelection(fragment, blockPath[0]),
    }
  }

  const clonedBlock = cloneDescendant(onlyFragmentNode)
  const selectionPoint = getPointAfterInlineVoid(
    editor,
    clonedBlock.children as Descendant[],
    getFragmentEndSelection(clonedBlock.children as Descendant[]).anchor
  )

  return {
    children: [clonedBlock],
    index: blockPath[0],
    previousChildren: [block],
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

  const [start, end] = RangeApi.edges(at)

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
    match: (node) => NodeApi.isElement(node) && Editor.isBlock(editor, node),
  })

  if (!blockMatch) {
    return null
  }

  const [block, blockPath] = blockMatch

  if (
    blockPath.length !== 1 ||
    !NodeApi.isElement(block) ||
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

  if (!NodeApi.isText(targetText)) {
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
    pushBlockChild(editor, firstChildren, child)
  }

  if (before) {
    pushBlockChild(editor, firstChildren, { ...targetText, text: before })
  }

  for (const child of firstFragmentBlock.children) {
    pushBlockChild(editor, firstChildren, child)
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
    insertedEnd = pushBlockChild(editor, lastChildren, child)
  }

  if (after) {
    pushBlockChild(editor, lastChildren, { ...targetText, text: after })
  }

  for (const child of block.children.slice(textIndex + 1)) {
    pushBlockChild(editor, lastChildren, child)
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
  const selectionPoint = insertedEnd
    ? getPointAfterInlineVoid(editor, lastChildren, insertedEnd)
    : { offset: 0, path: [0] }
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

const getTopLevelStructuralBlockFragmentReplacement = (
  editor: Editor,
  at: Range,
  fragment: Descendant[]
) => {
  if (
    fragment.length === 0 ||
    !fragment.every((node) => isBlockElement(editor, node)) ||
    fragment.every((node) => isTextBlockElement(editor, node))
  ) {
    return null
  }

  const [start, end] = RangeApi.edges(at)

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
    match: (node) => NodeApi.isElement(node) && Editor.isBlock(editor, node),
  })

  if (!blockMatch) {
    return null
  }

  const [block, blockPath] = blockMatch

  if (
    blockPath.length !== 1 ||
    !NodeApi.isElement(block) ||
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

  if (!NodeApi.isText(targetText)) {
    return null
  }

  const before = targetText.text.slice(0, start.offset)
  const after = targetText.text.slice(end.offset)
  const blockIndex = blockPath[0]
  const children: Descendant[] = []
  const beforeChildren: Descendant[] = []
  const afterChildren: Descendant[] = []

  for (const child of block.children.slice(0, textIndex)) {
    pushBlockChild(editor, beforeChildren, child)
  }

  if (before) {
    pushBlockChild(editor, beforeChildren, { ...targetText, text: before })
  }

  if (beforeChildren.length > 0) {
    children.push(createTextBlock(block, beforeChildren))
  }

  const fragmentStartIndex = blockIndex + children.length

  for (const child of fragment) {
    children.push(cloneDescendant(child))
  }

  if (after) {
    pushBlockChild(editor, afterChildren, { ...targetText, text: after })
  }

  for (const child of block.children.slice(textIndex + 1)) {
    pushBlockChild(editor, afterChildren, child)
  }

  if (afterChildren.length > 0) {
    children.push(createTextBlock(block, afterChildren))
  }

  return {
    children,
    index: blockIndex,
    previousChildren: [block],
    selection: getOffsetFragmentEndSelection(fragment, fragmentStartIndex),
  }
}

const isCompatibleStructuralContainer = (
  editor: Editor,
  target: Element,
  fragmentNode: Element
) =>
  isStructuralBlockElement(editor, target) &&
  isStructuralBlockElement(editor, fragmentNode) &&
  hasSameElementType(target, fragmentNode)

const getNestedTextBlockFragmentReplacement = (
  editor: Editor,
  at: Range,
  fragment: Descendant[]
) => {
  if (
    fragment.length === 0 ||
    !fragment.every((node) => isBlockElement(editor, node))
  ) {
    return null
  }

  const [start, end] = RangeApi.edges(at)

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
    match: (node) => NodeApi.isElement(node) && Editor.isBlock(editor, node),
  })

  if (!blockMatch) {
    return null
  }

  const [block, blockPath] = blockMatch

  if (
    blockPath.length < 2 ||
    !NodeApi.isElement(block) ||
    !isTextBlockElement(editor, block)
  ) {
    return null
  }

  const parentPath = PathApi.parent(blockPath)
  const parent = NodeApi.get(editor, parentPath)

  if (!NodeApi.isElement(parent) || !isStructuralBlockElement(editor, parent)) {
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

  if (!NodeApi.isText(targetText)) {
    return null
  }

  const parentIndex = parentPath.at(-1)
  const blockIndex = blockPath.at(-1)

  if (parentIndex == null || blockIndex == null) {
    return null
  }

  const beforeText = targetText.text.slice(0, start.offset)
  const afterText = targetText.text.slice(end.offset)
  const beforeTargetChildren: Descendant[] = []
  const headContainerChildren = parent.children
    .slice(0, blockIndex)
    .map(cloneDescendant)
  const middleBlocks: Descendant[] = []
  const tailContainerChildren = parent.children
    .slice(blockIndex + 1)
    .map(cloneDescendant)
  let fragmentIndex = 0
  let selection:
    | {
        anchor: { offset: number; path: Path }
        focus: { offset: number; path: Path }
      }
    | undefined

  for (const child of block.children.slice(0, textIndex)) {
    pushBlockChild(editor, beforeTargetChildren, child)
  }

  if (beforeText) {
    pushBlockChild(editor, beforeTargetChildren, {
      ...targetText,
      text: beforeText,
    })
  }

  const firstFragmentNode = fragment[0]

  if (
    NodeApi.isElement(firstFragmentNode) &&
    isCompatibleStructuralContainer(editor, parent, firstFragmentNode)
  ) {
    const [onlyFragmentChild] = firstFragmentNode.children

    if (
      fragment.length === 1 &&
      firstFragmentNode.children.length === 1 &&
      NodeApi.isElement(onlyFragmentChild) &&
      isTextBlockElement(editor, onlyFragmentChild) &&
      hasSameElementType(block, onlyFragmentChild)
    ) {
      const mergedChildren = [...beforeTargetChildren]
      let insertedEnd:
        | {
            offset: number
            path: Path
          }
        | undefined

      for (const child of onlyFragmentChild.children) {
        insertedEnd = pushBlockChild(editor, mergedChildren, child)
      }

      if (afterText) {
        pushBlockChild(editor, mergedChildren, {
          ...targetText,
          text: afterText,
        })
      }

      for (const child of block.children.slice(textIndex + 1)) {
        pushBlockChild(editor, mergedChildren, child)
      }

      if (mergedChildren.length === 0) {
        mergedChildren.push({ ...targetText, text: '' })
      }

      const mergedBlockIndex = headContainerChildren.length
      const selectionPoint = insertedEnd
        ? getPointAfterInlineVoid(editor, mergedChildren, insertedEnd)
        : getTextChildrenEndPoint(mergedChildren)
      const nextParentChildren = [
        ...headContainerChildren,
        createTextBlock(block, mergedChildren),
        ...tailContainerChildren,
      ]
      const nextSelection = {
        anchor: {
          path: parentPath.concat([mergedBlockIndex, ...selectionPoint.path]),
          offset: selectionPoint.offset,
        },
        focus: {
          path: parentPath.concat([mergedBlockIndex, ...selectionPoint.path]),
          offset: selectionPoint.offset,
        },
      }

      return {
        children: [{ ...parent, children: nextParentChildren }],
        index: parentIndex,
        path: parentPath.slice(0, -1),
        previousChildren: [parent],
        selection: nextSelection,
      }
    }

    if (beforeTargetChildren.length > 0) {
      headContainerChildren.push(createTextBlock(block, beforeTargetChildren))
    }

    const startIndex = headContainerChildren.length

    for (const child of firstFragmentNode.children) {
      headContainerChildren.push(cloneDescendant(child))
    }

    if (fragment.length === 1) {
      const endSelection = getFragmentEndSelection(
        firstFragmentNode.children as Descendant[]
      )
      const offsetPoint = (point: typeof endSelection.anchor) => ({
        offset: point.offset,
        path: parentPath
          .slice(0, -1)
          .concat([
            parentIndex,
            startIndex + point.path[0],
            ...point.path.slice(1),
          ]),
      })

      selection = {
        anchor: offsetPoint(endSelection.anchor),
        focus: offsetPoint(endSelection.focus),
      }
    }

    fragmentIndex = 1
  } else if (isTextBlockElement(editor, firstFragmentNode)) {
    for (const child of firstFragmentNode.children) {
      pushBlockChild(editor, beforeTargetChildren, child)
    }

    const insertedEnd = getTextChildrenEndPoint(beforeTargetChildren)
    headContainerChildren.push(createTextBlock(block, beforeTargetChildren))

    if (fragment.length === 1) {
      selection = {
        anchor: {
          path: parentPath.concat([
            headContainerChildren.length - 1,
            ...insertedEnd.path,
          ]),
          offset: insertedEnd.offset,
        },
        focus: {
          path: parentPath.concat([
            headContainerChildren.length - 1,
            ...insertedEnd.path,
          ]),
          offset: insertedEnd.offset,
        },
      }
    }

    fragmentIndex = 1
  } else if (beforeTargetChildren.length > 0) {
    headContainerChildren.push(createTextBlock(block, beforeTargetChildren))
  }

  const middleStartIndex =
    parentIndex + (headContainerChildren.length > 0 ? 1 : 0)

  for (const fragmentNode of fragment.slice(fragmentIndex)) {
    if (isTextBlockElement(editor, fragmentNode)) {
      const children: Descendant[] = []

      for (const child of fragmentNode.children) {
        pushBlockChild(editor, children, child)
      }

      const insertedEnd = getTextChildrenEndPoint(children)

      if (fragmentNode === fragment.at(-1) && afterText) {
        pushBlockChild(editor, children, { ...targetText, text: afterText })
      }

      middleBlocks.push(createTextBlock(fragmentNode, children))

      const middleBlockIndex = middleStartIndex + middleBlocks.length - 1

      selection = {
        anchor: {
          path: parentPath
            .slice(0, -1)
            .concat([middleBlockIndex, ...insertedEnd.path]),
          offset: insertedEnd.offset,
        },
        focus: {
          path: parentPath
            .slice(0, -1)
            .concat([middleBlockIndex, ...insertedEnd.path]),
          offset: insertedEnd.offset,
        },
      }
    } else {
      middleBlocks.push(cloneDescendant(fragmentNode))
      const middleBlockIndex = middleStartIndex + middleBlocks.length - 1

      selection = getOffsetFragmentEndSelection(
        [fragmentNode],
        middleBlockIndex,
        parentPath.slice(0, -1)
      )
    }
  }

  if (fragmentIndex >= fragment.length) {
    const tailFirstChildren: Descendant[] = []

    if (afterText) {
      pushBlockChild(editor, tailFirstChildren, {
        ...targetText,
        text: afterText,
      })
    }

    for (const child of block.children.slice(textIndex + 1)) {
      pushBlockChild(editor, tailFirstChildren, child)
    }

    if (tailFirstChildren.length > 0) {
      tailContainerChildren.unshift(createTextBlock(block, tailFirstChildren))
    }
  }

  const replacementChildren: Descendant[] = []

  if (headContainerChildren.length > 0) {
    replacementChildren.push({
      ...parent,
      children: headContainerChildren,
    })
  }

  replacementChildren.push(...middleBlocks)

  if (tailContainerChildren.length > 0) {
    replacementChildren.push({
      ...parent,
      children: tailContainerChildren,
    })
  }

  return {
    children: replacementChildren,
    index: parentIndex,
    path: parentPath.slice(0, -1),
    previousChildren: [parent],
    selection:
      selection ?? getOffsetFragmentEndSelection(fragment, parentIndex),
  }
}

const applyInsertFragment: TextMutationMethods['insertFragment'] = (
  editor,
  fragment,
  options = {}
) => {
  runEditorTransaction(editor, (tx) => {
    const operationCount = getOperationCount(editor)
    let usedReplaceChildrenFastPath = false
    const applyReplaceChildren = (
      operation: Parameters<typeof tx.apply>[0]
    ) => {
      usedReplaceChildrenFastPath = true
      tx.apply(operation)
    }

    if (!fragment.length) {
      return
    }

    const { hanging = false, voids = false } = options
    let fastAt = tx.resolveTarget({ at: options.at })

    if (!fastAt && options.at === undefined && tx.getModelSelection() == null) {
      fastAt = getDefaultInsertLocation(editor)
    }

    if (!fastAt) {
      return
    }

    if (LocationApi.isRange(fastAt)) {
      if (!hanging) {
        fastAt = Editor.unhangRange(editor, fastAt, { voids })
      }

      const topLevelStructuralBlockReplacement =
        getTopLevelStructuralBlockFragmentReplacement(editor, fastAt, fragment)

      if (topLevelStructuralBlockReplacement) {
        applyReplaceChildren({
          children: topLevelStructuralBlockReplacement.previousChildren,
          index: topLevelStructuralBlockReplacement.index,
          newChildren: topLevelStructuralBlockReplacement.children,
          newSelection: topLevelStructuralBlockReplacement.selection,
          path: [],
          selection: tx.getModelSelection(),
          type: 'replace_children',
        })
        return
      }
    }

    Editor.withoutNormalizing(editor, () => {
      const transforms = getEditorTransformRegistry(editor)
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

      if (LocationApi.isRange(at)) {
        if (!hanging) {
          at = Editor.unhangRange(editor, at, { voids })
        }

        const topLevelStructuralBlockReplacement =
          getTopLevelStructuralBlockFragmentReplacement(editor, at, fragment)

        if (topLevelStructuralBlockReplacement) {
          applyReplaceChildren({
            children: topLevelStructuralBlockReplacement.previousChildren,
            index: topLevelStructuralBlockReplacement.index,
            newChildren: topLevelStructuralBlockReplacement.children,
            newSelection: topLevelStructuralBlockReplacement.selection,
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
          applyReplaceChildren({
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

        const emptyTextBlockReplacement =
          getEmptyTopLevelTextBlockFragmentReplacement(editor, at, fragment)

        if (emptyTextBlockReplacement) {
          applyReplaceChildren({
            children: emptyTextBlockReplacement.previousChildren,
            index: emptyTextBlockReplacement.index,
            newChildren: emptyTextBlockReplacement.children,
            newSelection: emptyTextBlockReplacement.selection,
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
          applyReplaceChildren({
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

        if (isFullDocumentRange(editor, at)) {
          const editorChildren = Editor.getChildren(editor)

          applyReplaceChildren({
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

        const topLevelTextBlockReplacement =
          getTopLevelTextBlockFragmentReplacement(editor, at, fragment)

        if (topLevelTextBlockReplacement) {
          applyReplaceChildren({
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

        const nestedTextBlockReplacement =
          getNestedTextBlockFragmentReplacement(editor, at, fragment)

        if (nestedTextBlockReplacement) {
          applyReplaceChildren({
            children: nestedTextBlockReplacement.previousChildren,
            index: nestedTextBlockReplacement.index,
            newChildren: nestedTextBlockReplacement.children,
            newSelection: nestedTextBlockReplacement.selection,
            path: nestedTextBlockReplacement.path,
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
          applyReplaceChildren({
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

        if (RangeApi.isCollapsed(at)) {
          at = at.anchor
        } else {
          const [, end] = RangeApi.edges(at)

          if (!voids && Editor.void(editor, { at: end })) {
            return
          }

          const pointRef = Editor.pointRef(editor, end)
          transforms.delete({ at })
          at = pointRef.unref()!
        }
      } else if (LocationApi.isPath(at)) {
        at = Editor.point(editor, at, { edge: 'start' })
      }

      if (!voids && Editor.void(editor, { at })) {
        return
      }

      // If the insert point is at the edge of an inline node, move it outside
      // instead since it will need to be split otherwise.
      const inlineElementMatch = Editor.above(editor, {
        at,
        match: (n) => NodeApi.isElement(n) && Editor.isInline(editor, n),
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
        match: (n) => NodeApi.isElement(n) && Editor.isBlock(editor, n),
        at,
        voids,
      })!
      const [, blockPath] = blockMatch
      const isBlockStart = Editor.isStart(editor, at, blockPath)
      const isBlockEnd = Editor.isEnd(editor, at, blockPath)
      const isBlockEmpty = isBlockStart && isBlockEnd
      const fragmentRoot = { children: fragment } as Ancestor
      const [, firstLeafPath] = NodeApi.first(fragmentRoot, [])
      const [, lastLeafPath] = NodeApi.last(fragmentRoot, [])
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
          PathApi.isAncestor(p, firstLeafPath) &&
          NodeApi.isElement(n) &&
          !getEditorSchema(editor).isVoid(n) &&
          !getEditorSchema(editor).isInline(n)
        ) {
          return false
        }

        // Unless we're at the end of the destination block, unwrap any non-void
        // blocks that contain the last leaf node in the fragment.
        if (
          !isBlockEnd &&
          PathApi.isAncestor(p, lastLeafPath) &&
          NodeApi.isElement(n) &&
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

      for (const entry of NodeApi.nodes(fragmentRoot, { pass: shouldInsert })) {
        const [node, path] = entry

        if (NodeApi.isEditor(node)) {
          continue
        }

        // If we encounter a block that does not contain the first leaf, we're no
        // longer in the first block of the fragment.
        if (
          starting &&
          NodeApi.isElement(node) &&
          !getEditorSchema(editor).isInline(node) &&
          !PathApi.isAncestor(path, firstLeafPath)
        ) {
          starting = false
        }

        if (shouldInsert(entry)) {
          if (
            NodeApi.isElement(node) &&
            !getEditorSchema(editor).isInline(node)
          ) {
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
          NodeApi.isText(n) ||
          (NodeApi.isElement(n) && Editor.isInline(editor, n)),
        mode: 'highest',
        voids,
      })!

      const [, inlinePath] = inlineMatch
      const isInlineStart = Editor.isStart(editor, at, inlinePath)
      const isInlineEnd = Editor.isEnd(editor, at, inlinePath)

      const middleRef = Editor.pathRef(
        editor,
        isBlockEnd && !ends.length ? PathApi.next(blockPath) : blockPath
      )

      const endRef = Editor.pathRef(
        editor,
        isInlineEnd ? PathApi.next(inlinePath) : inlinePath
      )

      // If the fragment contains inlines in multiple distinct blocks, split the
      // destination block.
      const splitBlock = ends.length > 0

      transforms.splitNodes({
        at,
        match: (n) =>
          splitBlock
            ? NodeApi.isElement(n) && Editor.isBlock(editor, n)
            : NodeApi.isText(n) ||
              (NodeApi.isElement(n) && Editor.isInline(editor, n)),
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
          ? PathApi.next(inlinePath)
          : inlinePath
      )

      transforms.insertNodes(starts, {
        at: startRef.current!,
        match: (n) =>
          NodeApi.isText(n) ||
          (NodeApi.isElement(n) && Editor.isInline(editor, n)),
        mode: 'highest',
        voids,
        batchDirty,
      })

      if (isBlockEmpty && !starts.length && middles.length && !ends.length) {
        transforms.delete({ at: blockPath, voids })
      }

      transforms.insertNodes(middles, {
        at: middleRef.current!,
        match: (n) => NodeApi.isElement(n) && Editor.isBlock(editor, n),
        mode: 'lowest',
        voids,
        batchDirty,
      })

      transforms.insertNodes(ends, {
        at: endRef.current!,
        match: (n) =>
          NodeApi.isText(n) ||
          (NodeApi.isElement(n) && Editor.isInline(editor, n)),
        mode: 'highest',
        voids,
        batchDirty,
      })

      if (!options.at) {
        let path: Path | undefined

        if (ends.length > 0 && endRef.current) {
          path = PathApi.previous(endRef.current)
        } else if (middles.length > 0 && middleRef.current) {
          path = PathApi.previous(middleRef.current)
        } else if (startRef.current) {
          path = PathApi.previous(startRef.current)
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

    if (
      !usedReplaceChildrenFastPath &&
      getOperationCount(editor) > operationCount
    ) {
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
      return true
    }
  )
}
