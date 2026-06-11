import type { Descendant, Path } from 'slate'
import * as Y from 'yjs'

import {
  getSlateYjsElementType,
  getYjsAttributes,
  hasYjsAttributes,
  SLATE_TYPE_ATTRIBUTE,
  setYjsAttribute,
  setYjsAttributes,
  type YjsAttributeRecord,
  type YjsNode,
} from './attributes'
import {
  getYjsTextDeltaPartText,
  isNonEmptyYjsTextDeltaPart,
} from './text-delta'

const HIDDEN_ATTRIBUTE = 'slate:yjs-hidden'
const NODE_ID_ATTRIBUTE = 'slate:yjs-id'
export const SPLIT_UNDO_TEXT_ATTRIBUTE = 'slate:yjs-split-undo-text'
const VIRTUAL_CHILD_ID_ATTRIBUTE = 'slate:yjs-virtual-child-id'
const VIRTUAL_PLACEHOLDER_ATTRIBUTE = 'slate:yjs-virtual-placeholder'
const VIRTUAL_YJS_CHILD_RAW_INDEX = -1
const INTERNAL_YJS_ATTRIBUTES = [
  HIDDEN_ATTRIBUTE,
  NODE_ID_ATTRIBUTE,
  SPLIT_UNDO_TEXT_ATTRIBUTE,
  VIRTUAL_CHILD_ID_ATTRIBUTE,
  VIRTUAL_PLACEHOLDER_ATTRIBUTE,
] as const

let nextNodeId = 0
const nodeIdScope = Math.random().toString(36).slice(2)

export const getYjsLength = (node: YjsNode): number => node.length

export const getYjsTextContent = (node: Y.XmlText): string =>
  node.toDelta().map(getYjsTextDeltaPartText).join('')

const isYjsContentNode = (value: unknown): value is YjsNode =>
  value instanceof Y.XmlElement || value instanceof Y.XmlText

const getRawYjsChildren = (node: Y.XmlElement): YjsNode[] =>
  node.toArray().filter((child): child is YjsNode => isYjsContentNode(child))

const isHiddenYjsNode = (node: YjsNode): boolean =>
  getYjsAttributes(node)[HIDDEN_ATTRIBUTE] === true

const isEmptyAttributeFreeYjsText = (node: YjsNode): boolean =>
  node instanceof Y.XmlText &&
  getYjsTextContent(node).length === 0 &&
  !hasYjsAttributes(node)

type YjsVisibleChildSlot = {
  readonly node: YjsNode
  readonly rawIndex: number
}

type YjsChildRemovalMode = 'hidden' | 'hidden-parent' | 'visible'

const isVirtualYjsPlaceholder = (node: YjsNode): boolean =>
  node instanceof Y.XmlElement &&
  getYjsAttributes(node)[VIRTUAL_PLACEHOLDER_ATTRIBUTE] === true

const hasRawYjsChildSlot = (slot: YjsVisibleChildSlot): boolean =>
  slot.rawIndex !== VIRTUAL_YJS_CHILD_RAW_INDEX

const getVirtualYjsChild = (
  root: Y.XmlElement,
  node: Y.XmlElement,
  visited = new Set<Y.XmlElement>()
): YjsNode | null => {
  if (visited.has(node)) {
    return null
  }

  visited.add(node)

  const virtualChildId = node.getAttribute(VIRTUAL_CHILD_ID_ATTRIBUTE)

  if (typeof virtualChildId === 'string') {
    const virtualChild = findYjsNodeById(root, virtualChildId)

    if (
      virtualChild instanceof Y.XmlElement &&
      isVirtualYjsPlaceholder(virtualChild)
    ) {
      return getVirtualYjsChild(root, virtualChild, visited)
    }

    return virtualChild
  }

  return null
}

const getYjsVisibleChildSlots = (
  root: Y.XmlElement,
  node: Y.XmlElement
): YjsVisibleChildSlot[] => {
  const rawSlots = getRawYjsChildren(node).flatMap((child, rawIndex) => {
    if (isHiddenYjsNode(child)) {
      return []
    }

    if (child instanceof Y.XmlElement && isVirtualYjsPlaceholder(child)) {
      const virtualChild = getVirtualYjsChild(root, child)

      return virtualChild === null ? [] : [{ node: virtualChild, rawIndex }]
    }

    return [{ node: child, rawIndex }]
  })

  if (!isVirtualYjsPlaceholder(node)) {
    const virtualChild = getVirtualYjsChild(root, node)

    if (virtualChild !== null) {
      return [
        { node: virtualChild, rawIndex: VIRTUAL_YJS_CHILD_RAW_INDEX },
        ...rawSlots,
      ]
    }
  }

  return rawSlots
}

export const getYjsChildren = (node: Y.XmlElement): YjsNode[] =>
  getRawYjsChildren(node).filter((child) => !isHiddenYjsNode(child))

export const getYjsVisibleChildren = (
  root: Y.XmlElement,
  node: Y.XmlElement
): YjsNode[] => getYjsVisibleChildSlots(root, node).map((slot) => slot.node)

export const getYjsVisiblePath = (
  root: Y.XmlElement,
  target: YjsNode
): Path | null => {
  const visit = (
    node: YjsNode,
    path: Path,
    visited: Set<YjsNode>
  ): Path | null => {
    if (node === target) {
      return path
    }
    if (!(node instanceof Y.XmlElement) || visited.has(node)) {
      return null
    }

    visited.add(node)

    const children = getYjsVisibleChildren(root, node)

    for (const [index, child] of children.entries()) {
      const childPath = visit(child, [...path, index], visited)

      if (childPath !== null) {
        return childPath
      }
    }

    return null
  }

  return visit(root, [], new Set())
}

export const createYjsText = (
  text: string,
  attributes: YjsAttributeRecord
): Y.XmlText => {
  const yjsText = new Y.XmlText()

  setYjsAttributes(yjsText, attributes)

  if (text.length > 0) {
    yjsText.insert(0, text, attributes)
  }

  return yjsText
}

export const createYjsNode = (node: Descendant): YjsNode => {
  if ('text' in node) {
    const { text: value, ...attributes } = node
    const stringValue = String(value)

    return createYjsText(stringValue, attributes)
  }

  const { children, type, ...attributes } = node
  const elementType = String(type ?? 'element')
  const element = new Y.XmlElement(elementType)

  setYjsAttribute(element, SLATE_TYPE_ATTRIBUTE, elementType)
  setYjsAttributes(element, attributes)

  if (children.length > 0) {
    element.insert(0, createYjsNodes(children))
  }

  return element
}

export const createYjsNodes = (nodes: readonly Descendant[]): YjsNode[] =>
  nodes.map(createYjsNode)

export const replaceYjsChildren = (
  parent: Y.XmlElement,
  children: readonly Descendant[]
): void => {
  const length = getYjsLength(parent)

  if (length > 0) {
    parent.delete(0, length)
  }

  if (children.length > 0) {
    parent.insert(0, createYjsNodes(children))
  }
}

export const readSlateValueFromYjs = (root: Y.XmlElement): Descendant[] => {
  const children = getYjsVisibleChildren(root, root).map((node) =>
    readSlateNodeFromYjs(root, node)
  )

  return children.length > 0
    ? children
    : [{ children: [{ text: '' }], type: 'paragraph' }]
}

export const removeRedundantEmptyYjsTextNodes = (root: Y.XmlElement): void => {
  const visit = (parent: Y.XmlElement): void => {
    for (const child of getRawYjsChildren(parent)) {
      if (child instanceof Y.XmlElement) {
        visit(child)
      }
    }

    const visibleSlots = getYjsVisibleChildSlots(root, parent)

    if (visibleSlots.length <= 1) {
      return
    }

    for (let index = visibleSlots.length - 1; index >= 0; index--) {
      const slot = visibleSlots[index]

      if (slot === undefined) {
        continue
      }

      const child = slot.node

      if (hasRawYjsChildSlot(slot) && isEmptyAttributeFreeYjsText(child)) {
        parent.delete(slot.rawIndex, 1)
      }
    }
  }

  visit(root)
}

const getUniformTextAttributes = (node: Y.XmlText): YjsAttributeRecord => {
  const delta = node.toDelta()
  let attributes: YjsAttributeRecord | undefined

  for (const part of delta) {
    if (!isNonEmptyYjsTextDeltaPart(part)) {
      continue
    }

    const partAttributes = getPublicAttributes(part.attributes)

    if (attributes === undefined) {
      attributes = partAttributes
      continue
    }

    const keys = new Set([
      ...Object.keys(attributes),
      ...Object.keys(partAttributes),
    ])

    for (const key of keys) {
      if (attributes[key] !== partAttributes[key]) {
        return {}
      }
    }
  }

  return attributes ?? {}
}

const getPublicAttributes = (
  attributes?: Readonly<YjsAttributeRecord>
): YjsAttributeRecord => {
  const publicAttributes = { ...(attributes ?? {}) }

  deleteInternalAttributes(publicAttributes)

  return publicAttributes
}

const getPublicYjsAttributes = (node: YjsNode): YjsAttributeRecord =>
  getPublicAttributes(getYjsAttributes(node))

const getPublicYjsElementAttributes = (
  node: Y.XmlElement
): YjsAttributeRecord => {
  const attributes = getPublicYjsAttributes(node)

  delete attributes[SLATE_TYPE_ATTRIBUTE]

  return attributes
}

const readSlateNodeFromYjs = (
  root: Y.XmlElement,
  node: YjsNode
): Descendant => {
  if (node instanceof Y.XmlText) {
    const attributes = getPublicYjsAttributes(node)

    return {
      ...attributes,
      ...getUniformTextAttributes(node),
      text: getYjsTextContent(node),
    }
  }

  const attributes = getPublicYjsElementAttributes(node)
  const type = getSlateYjsElementType(node)

  const children: Descendant[] = getYjsVisibleChildren(root, node).map(
    (child) => readSlateNodeFromYjs(root, child)
  )

  return {
    ...attributes,
    type,
    children: children.length > 0 ? children : [{ text: '' }],
  }
}

const cloneYjsNodeWithRoot = (
  node: YjsNode,
  root: Y.XmlElement
): YjsNode | null => {
  if (node instanceof Y.XmlElement && isVirtualYjsPlaceholder(node)) {
    const virtualChild = getVirtualYjsChild(root, node)

    return virtualChild === null
      ? null
      : cloneYjsNodeWithRoot(virtualChild, root)
  }

  const attributes = getPublicYjsAttributes(node)

  if (node instanceof Y.XmlText) {
    const clone = new Y.XmlText()

    setYjsAttributes(clone, attributes)
    clone.applyDelta(node.toDelta(), { sanitize: false })

    return clone
  }

  const clone = new Y.XmlElement(node.nodeName)
  const children = getYjsChildren(node).flatMap((child) => {
    const childClone = cloneYjsNodeWithRoot(child, root)

    return childClone === null ? [] : [childClone]
  })

  setYjsAttributes(clone, attributes)

  if (children.length > 0) {
    clone.insert(0, children)
  }

  return clone
}

export const cloneVisibleYjsNodes = (
  root: Y.XmlElement,
  nodes: readonly YjsNode[]
): YjsNode[] =>
  nodes.flatMap((node) => {
    const clone = cloneYjsNodeWithRoot(node, root)

    return clone === null ? [] : [clone]
  })

export const getYjsNode = (root: Y.XmlElement, path: Path): YjsNode => {
  let current: YjsNode = root

  for (const index of path) {
    if (current instanceof Y.XmlText) {
      throw new Error(`Cannot descend into Y.XmlText at path ${path.join('.')}`)
    }

    const child: YjsNode | undefined = getYjsVisibleChildren(root, current)[
      index
    ]

    if (!isYjsContentNode(child)) {
      throw new Error(`No Yjs node at path ${path.join('.')}`)
    }

    current = child
  }

  return current
}

export const getYjsNodeIf = (
  root: Y.XmlElement,
  path: Path
): YjsNode | null => {
  try {
    return getYjsNode(root, path)
  } catch {
    return null
  }
}

export const setVirtualYjsMove = (
  root: Y.XmlElement,
  target: YjsNode,
  wrapper: Y.XmlElement
): void => {
  const nodeId = ensureYjsNodeId(target)

  hideYjsNode(target)
  setYjsAttribute(wrapper, VIRTUAL_CHILD_ID_ATTRIBUTE, nodeId)
}

export const createVirtualYjsMovePlaceholder = (
  target: YjsNode
): Y.XmlElement => {
  const nodeId = ensureYjsNodeId(target)
  const placeholder = new Y.XmlElement('slate-yjs-virtual-placeholder')

  hideYjsNode(target)
  setYjsAttribute(placeholder, VIRTUAL_CHILD_ID_ATTRIBUTE, nodeId)
  setYjsAttribute(placeholder, VIRTUAL_PLACEHOLDER_ATTRIBUTE, true)

  return placeholder
}

export const hideYjsNode = (node: YjsNode): void => {
  setYjsAttribute(node, HIDDEN_ATTRIBUTE, true)
}

export const insertYjsChild = (
  root: Y.XmlElement,
  parent: Y.XmlElement,
  index: number,
  child: YjsNode
): void => {
  const rawChildren = getRawYjsChildren(parent)
  const visibleSlots = getYjsVisibleChildSlots(root, parent)
  const visibleSlot = visibleSlots[index]
  const rawIndex =
    index >= visibleSlots.length || !visibleSlot
      ? rawChildren.length
      : visibleSlot.rawIndex

  parent.insert(rawIndex, [child])
}

export const setVirtualYjsUnwrapMove = (
  root: Y.XmlElement,
  target: YjsNode,
  wrapper: Y.XmlElement,
  wrapperParent: Y.XmlElement,
  wrapperIndex: number
): void => {
  const nodeId = target.getAttribute(NODE_ID_ATTRIBUTE)

  if (
    typeof nodeId !== 'string' ||
    wrapper.getAttribute(VIRTUAL_CHILD_ID_ATTRIBUTE) !== nodeId
  ) {
    throw new Error('move_node unwrap target is not a virtual wrapper child.')
  }

  target.removeAttribute(HIDDEN_ATTRIBUTE)
  wrapper.removeAttribute(VIRTUAL_CHILD_ID_ATTRIBUTE)

  if (getRawYjsChildren(wrapper).length === 0) {
    hideYjsNode(wrapper)
  } else {
    insertYjsChild(
      root,
      wrapperParent,
      wrapperIndex,
      createVirtualYjsMovePlaceholder(target)
    )
  }
}

export const isVirtualYjsChild = (
  target: YjsNode,
  wrapper: Y.XmlElement
): boolean => {
  const nodeId = target.getAttribute(NODE_ID_ATTRIBUTE)

  return (
    typeof nodeId === 'string' &&
    wrapper.getAttribute(VIRTUAL_CHILD_ID_ATTRIBUTE) === nodeId
  )
}

export const removeYjsVirtualPlaceholderChild = (
  root: Y.XmlElement,
  parent: Y.XmlElement,
  index: number,
  target: YjsNode
): boolean => {
  const visibleSlot = getYjsVisibleChildSlots(root, parent)[index]

  if (
    !visibleSlot ||
    !hasRawYjsChildSlot(visibleSlot) ||
    visibleSlot.node !== target
  ) {
    return false
  }

  const rawChild = getRawYjsChildren(parent)[visibleSlot.rawIndex]

  if (
    !(rawChild instanceof Y.XmlElement) ||
    !isVirtualYjsPlaceholder(rawChild)
  ) {
    return false
  }

  parent.delete(visibleSlot.rawIndex, 1)

  return true
}

export const removeYjsChild = (
  root: Y.XmlElement,
  parent: Y.XmlElement,
  index: number,
  slateNode?: Descendant
): YjsChildRemovalMode => {
  const visibleSlot = getYjsVisibleChildSlots(root, parent)[index]
  const rawChildren = getRawYjsChildren(parent)
  const hiddenIndex = rawChildren.findIndex(
    (child) => isHiddenYjsNode(child) && matchesSlateNode(child, slateNode)
  )

  if (visibleSlot !== undefined) {
    if (!hasRawYjsChildSlot(visibleSlot)) {
      throw new Error('Cannot remove a virtual Yjs child from its parent.')
    }

    if (
      slateNode !== undefined &&
      !matchesSlateNode(visibleSlot.node, slateNode) &&
      hiddenIndex !== -1
    ) {
      parent.delete(hiddenIndex, 1)

      return 'hidden'
    }

    if (
      visibleSlot.node instanceof Y.XmlElement &&
      hasHiddenYjsDescendant(visibleSlot.node)
    ) {
      hideYjsNode(visibleSlot.node)

      return 'hidden-parent'
    }

    parent.delete(visibleSlot.rawIndex, 1)

    return 'visible'
  }

  if (hiddenIndex === -1) {
    throw new Error('No Yjs child to remove at the requested visible path.')
  }

  parent.delete(hiddenIndex, 1)

  return 'hidden'
}

export const getYjsParent = (
  root: Y.XmlElement,
  path: Path
): { readonly index: number; readonly parent: Y.XmlElement } => {
  const index = path.at(-1)

  if (index === undefined) {
    throw new Error('Cannot resolve a parent for the Yjs root.')
  }

  const parentPath = path.slice(0, -1)
  const parent = getYjsNode(root, parentPath)

  if (parent instanceof Y.XmlText) {
    throw new Error(`Yjs parent is text at path ${parentPath.join('.')}`)
  }

  return { index, parent }
}

const deleteInternalAttributes = (attributes: YjsAttributeRecord): void => {
  for (const attribute of INTERNAL_YJS_ATTRIBUTES) {
    delete attributes[attribute]
  }
}

const ensureYjsNodeId = (node: YjsNode): string => {
  const currentId = node.getAttribute(NODE_ID_ATTRIBUTE)

  if (typeof currentId === 'string') {
    return currentId
  }

  const scope = node.doc ? String(node.doc.clientID) : nodeIdScope
  const nextId = `slate-yjs-${scope}-${++nextNodeId}`

  setYjsAttribute(node, NODE_ID_ATTRIBUTE, nextId)

  return nextId
}

const matchesSlateNode = (
  yjsNode: YjsNode,
  slateNode?: Descendant
): boolean => {
  if (slateNode === undefined) {
    return false
  }

  if ('text' in slateNode) {
    return yjsNode instanceof Y.XmlText
  }

  if (!(yjsNode instanceof Y.XmlElement)) {
    return false
  }

  return getSlateYjsElementType(yjsNode) === String(slateNode.type ?? 'element')
}

const hasHiddenYjsDescendant = (node: Y.XmlElement): boolean => {
  const stack = getRawYjsChildren(node)

  for (let child = stack.pop(); child; child = stack.pop()) {
    if (isHiddenYjsNode(child)) {
      return true
    }

    if (child instanceof Y.XmlElement) {
      stack.push(...getRawYjsChildren(child))
    }
  }

  return false
}

const findYjsNodeById = (root: Y.XmlElement, id: string): YjsNode | null => {
  const stack: YjsNode[] = [root]

  for (let node = stack.pop(); node; node = stack.pop()) {
    if (node.getAttribute(NODE_ID_ATTRIBUTE) === id) {
      return node
    }

    if (node instanceof Y.XmlElement) {
      stack.push(...getRawYjsChildren(node))
    }
  }

  return null
}
