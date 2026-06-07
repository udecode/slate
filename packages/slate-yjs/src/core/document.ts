import type { Descendant, Path } from 'slate'
import * as Y from 'yjs'

const SLATE_TYPE_ATTRIBUTE = 'slate:type'
const HIDDEN_ATTRIBUTE = 'slate:yjs-hidden'
const NODE_ID_ATTRIBUTE = 'slate:yjs-id'
export const SPLIT_UNDO_TEXT_ATTRIBUTE = 'slate:yjs-split-undo-text'
const VIRTUAL_CHILD_ID_ATTRIBUTE = 'slate:yjs-virtual-child-id'
const VIRTUAL_PLACEHOLDER_ATTRIBUTE = 'slate:yjs-virtual-placeholder'

let nextNodeId = 0

export const getYjsLength = (node: Y.XmlElement | Y.XmlText) =>
  (node as unknown as { length: number }).length

export const getYjsTextContent = (node: Y.XmlText) =>
  node
    .toDelta()
    .map((part: { insert: unknown }) =>
      typeof part.insert === 'string' ? part.insert : ''
    )
    .join('')

const getAttributes = (node: Y.XmlElement | Y.XmlText) =>
  (
    node as unknown as { getAttributes(): Record<string, unknown> }
  ).getAttributes()

const setAttributes = (
  node: Y.XmlElement | Y.XmlText,
  attributes: Record<string, unknown>
) => {
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, value as never)
  }
}

const getRawYjsChildren = (node: Y.XmlElement) =>
  node
    .toArray()
    .filter(
      (child): child is Y.XmlElement | Y.XmlText =>
        child instanceof Y.XmlElement || child instanceof Y.XmlText
    )

const isHiddenYjsNode = (node: Y.XmlElement | Y.XmlText) =>
  getAttributes(node)[HIDDEN_ATTRIBUTE] === true

const removeAttribute = (node: Y.XmlElement | Y.XmlText, attribute: string) => {
  node.removeAttribute(attribute)
}

export const isVirtualYjsPlaceholder = (
  node: Y.XmlElement | Y.XmlText
): node is Y.XmlElement =>
  node instanceof Y.XmlElement &&
  getAttributes(node)[VIRTUAL_PLACEHOLDER_ATTRIBUTE] === true

export const getVirtualYjsChild = (
  root: Y.XmlElement,
  node: Y.XmlElement,
  visited = new Set<Y.XmlElement>()
): Y.XmlElement | Y.XmlText | null => {
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

const getYjsVisibleChildSlots = (root: Y.XmlElement, node: Y.XmlElement) => {
  const rawSlots = getRawYjsChildren(node).flatMap((child, rawIndex) => {
    if (isHiddenYjsNode(child)) {
      return []
    }

    if (isVirtualYjsPlaceholder(child)) {
      const virtualChild = getVirtualYjsChild(root, child)

      return virtualChild ? [{ node: virtualChild, rawIndex }] : []
    }

    return [{ node: child, rawIndex }]
  })

  if (!isVirtualYjsPlaceholder(node)) {
    const virtualChild = getVirtualYjsChild(root, node)

    if (virtualChild) {
      return [{ node: virtualChild, rawIndex: -1 }, ...rawSlots]
    }
  }

  return rawSlots
}

export const getYjsChildren = (node: Y.XmlElement) =>
  getRawYjsChildren(node).filter((child) => !isHiddenYjsNode(child))

export const getYjsVisibleChildren = (root: Y.XmlElement, node: Y.XmlElement) =>
  getYjsVisibleChildSlots(root, node).map((slot) => slot.node)

export const getYjsVisiblePath = (
  root: Y.XmlElement,
  target: Y.XmlElement | Y.XmlText
): Path | null => {
  const visit = (
    node: Y.XmlElement | Y.XmlText,
    path: Path,
    visited: Set<Y.XmlElement | Y.XmlText>
  ): Path | null => {
    if (node === target) {
      return path
    }
    if (!(node instanceof Y.XmlElement) || visited.has(node)) {
      return null
    }

    visited.add(node)

    const children = getYjsVisibleChildren(root, node)

    for (let index = 0; index < children.length; index++) {
      const childPath = visit(children[index]!, [...path, index], visited)

      if (childPath) {
        return childPath
      }
    }

    return null
  }

  return visit(root, [], new Set())
}

export const createYjsNode = (node: Descendant): Y.XmlElement | Y.XmlText => {
  if ('text' in node) {
    const text = new Y.XmlText()
    const { text: value, ...attributes } = node
    const stringValue = String(value)
    const textAttributes = attributes as Record<string, unknown>

    setAttributes(text, textAttributes)

    if (stringValue.length > 0) {
      text.insert(0, stringValue, textAttributes)
    }

    return text
  }

  const element = new Y.XmlElement(String(node.type ?? 'element'))
  const { children, type, ...attributes } = node

  element.setAttribute(SLATE_TYPE_ATTRIBUTE, String(type))
  setAttributes(element, attributes)

  if (children.length > 0) {
    element.insert(0, children.map(createYjsNode))
  }

  return element
}

export const replaceYjsChildren = (
  parent: Y.XmlElement,
  children: readonly Descendant[]
) => {
  const length = getYjsLength(parent)

  if (length > 0) {
    parent.delete(0, length)
  }

  if (children.length > 0) {
    parent.insert(0, children.map(createYjsNode))
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

const getUniformTextAttributes = (node: Y.XmlText) => {
  const delta = node.toDelta()
  let attributes: Record<string, unknown> | undefined

  for (const part of delta) {
    if (typeof part.insert !== 'string' || part.insert.length === 0) {
      continue
    }

    const partAttributes = { ...(part.attributes ?? {}) }

    deleteInternalAttributes(partAttributes)

    if (!attributes) {
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

const readSlateNodeFromYjs = (
  root: Y.XmlElement,
  node: Y.XmlElement | Y.XmlText
): Descendant => {
  const attributes = { ...getAttributes(node) }

  if (node instanceof Y.XmlText) {
    deleteInternalAttributes(attributes)

    return {
      ...attributes,
      ...getUniformTextAttributes(node),
      text: getYjsTextContent(node),
    }
  }

  const type = attributes[SLATE_TYPE_ATTRIBUTE] ?? node.nodeName

  delete attributes[SLATE_TYPE_ATTRIBUTE]
  deleteInternalAttributes(attributes)

  const children = getYjsVisibleChildren(root, node).map((child) =>
    readSlateNodeFromYjs(root, child)
  )

  return {
    ...attributes,
    type,
    children: children.length > 0 ? children : [{ text: '' }],
  } as Descendant
}

const cloneYjsNodeWithRoot = (
  node: Y.XmlElement | Y.XmlText,
  root: Y.XmlElement | null
): Y.XmlElement | Y.XmlText | null => {
  if (root && node instanceof Y.XmlElement && isVirtualYjsPlaceholder(node)) {
    const virtualChild = getVirtualYjsChild(root, node)

    return virtualChild ? cloneYjsNodeWithRoot(virtualChild, root) : null
  }

  const attributes = { ...getAttributes(node) }

  deleteInternalAttributes(attributes)

  if (node instanceof Y.XmlText) {
    const clone = new Y.XmlText()

    setAttributes(clone, attributes)
    clone.applyDelta(node.toDelta(), { sanitize: false })

    return clone
  }

  const clone = new Y.XmlElement(node.nodeName)
  const children = getYjsChildren(node).flatMap((child) => {
    if (
      !root &&
      child instanceof Y.XmlElement &&
      isVirtualYjsPlaceholder(child)
    ) {
      return []
    }

    const childClone = cloneYjsNodeWithRoot(child, root)

    return childClone ? [childClone] : []
  })

  setAttributes(clone, attributes)

  if (children.length > 0) {
    clone.insert(0, children)
  }

  return clone
}

export const cloneYjsNode = (
  node: Y.XmlElement | Y.XmlText
): Y.XmlElement | Y.XmlText => {
  const clone = cloneYjsNodeWithRoot(node, null)

  if (!clone) {
    throw new Error('Cannot clone a missing Yjs node.')
  }

  return clone
}

export const cloneVisibleYjsNode = (
  root: Y.XmlElement,
  node: Y.XmlElement | Y.XmlText
): Y.XmlElement | Y.XmlText | null => cloneYjsNodeWithRoot(node, root)

export const getYjsNode = (
  root: Y.XmlElement,
  path: Path
): Y.XmlElement | Y.XmlText => {
  let current: Y.XmlElement | Y.XmlText = root

  for (const index of path) {
    if (current instanceof Y.XmlText) {
      throw new Error(`Cannot descend into Y.XmlText at path ${path.join('.')}`)
    }

    const child: Y.XmlElement | Y.XmlText | undefined = getYjsVisibleChildren(
      root,
      current
    )[index]

    if (!(child instanceof Y.XmlElement) && !(child instanceof Y.XmlText)) {
      throw new Error(`No Yjs node at path ${path.join('.')}`)
    }

    current = child
  }

  return current
}

export const setVirtualYjsMove = (
  root: Y.XmlElement,
  target: Y.XmlElement | Y.XmlText,
  wrapper: Y.XmlElement
) => {
  const nodeId = ensureYjsNodeId(target)

  target.setAttribute(HIDDEN_ATTRIBUTE, true)
  wrapper.setAttribute(VIRTUAL_CHILD_ID_ATTRIBUTE, nodeId)
}

export const createVirtualYjsMovePlaceholder = (
  target: Y.XmlElement | Y.XmlText
) => {
  const nodeId = ensureYjsNodeId(target)
  const placeholder = new Y.XmlElement('slate-yjs-virtual-placeholder')

  target.setAttribute(HIDDEN_ATTRIBUTE, true)
  placeholder.setAttribute(VIRTUAL_CHILD_ID_ATTRIBUTE, nodeId)
  placeholder.setAttribute(VIRTUAL_PLACEHOLDER_ATTRIBUTE, true as never)

  return placeholder
}

export const hideYjsNode = (node: Y.XmlElement | Y.XmlText) => {
  node.setAttribute(HIDDEN_ATTRIBUTE, true as never)
}

export const insertYjsChild = (
  root: Y.XmlElement,
  parent: Y.XmlElement,
  index: number,
  child: Y.XmlElement | Y.XmlText
) => {
  const rawChildren = getRawYjsChildren(parent)
  const visibleSlots = getYjsVisibleChildSlots(root, parent)
  const rawIndex =
    index >= visibleSlots.length
      ? rawChildren.length
      : visibleSlots[index]!.rawIndex

  parent.insert(rawIndex, [child])
}

export const setVirtualYjsUnwrapMove = (
  target: Y.XmlElement | Y.XmlText,
  wrapper: Y.XmlElement
) => {
  const nodeId = target.getAttribute(NODE_ID_ATTRIBUTE)

  if (
    typeof nodeId !== 'string' ||
    wrapper.getAttribute(VIRTUAL_CHILD_ID_ATTRIBUTE) !== nodeId
  ) {
    throw new Error('move_node unwrap target is not a virtual wrapper child.')
  }

  removeAttribute(target, HIDDEN_ATTRIBUTE)
  removeAttribute(wrapper, VIRTUAL_CHILD_ID_ATTRIBUTE)
  wrapper.setAttribute(HIDDEN_ATTRIBUTE, true as never)
}

export const isVirtualYjsChild = (
  target: Y.XmlElement | Y.XmlText,
  wrapper: Y.XmlElement
) => {
  const nodeId = target.getAttribute(NODE_ID_ATTRIBUTE)

  return (
    typeof nodeId === 'string' &&
    wrapper.getAttribute(VIRTUAL_CHILD_ID_ATTRIBUTE) === nodeId
  )
}

export const removeYjsChild = (
  root: Y.XmlElement,
  parent: Y.XmlElement,
  index: number,
  slateNode?: Descendant
): 'hidden' | 'hidden-parent' | 'visible' => {
  const visibleSlot = getYjsVisibleChildSlots(root, parent)[index]
  const rawChildren = getRawYjsChildren(parent)

  if (visibleSlot) {
    if (visibleSlot.rawIndex === -1) {
      throw new Error('Cannot remove a virtual Yjs child from its parent.')
    }

    if (
      visibleSlot.node instanceof Y.XmlElement &&
      hasHiddenYjsDescendant(visibleSlot.node)
    ) {
      visibleSlot.node.setAttribute(HIDDEN_ATTRIBUTE, true as never)

      return 'hidden-parent'
    }

    parent.delete(visibleSlot.rawIndex, 1)

    return 'visible'
  }

  const hiddenIndex = rawChildren.findIndex(
    (child) => isHiddenYjsNode(child) && matchesSlateNode(child, slateNode)
  )

  if (hiddenIndex === -1) {
    throw new Error('No Yjs child to remove at the requested visible path.')
  }

  parent.delete(hiddenIndex, 1)

  return 'hidden'
}

export const getYjsParent = (
  root: Y.XmlElement,
  path: Path
): { index: number; parent: Y.XmlElement } => {
  const index = path.at(-1)

  if (index === undefined) {
    throw new Error('Cannot resolve a parent for the Yjs root.')
  }

  const parentPath = path.slice(0, -1)
  const parent = parentPath.length === 0 ? root : getYjsNode(root, parentPath)

  if (parent instanceof Y.XmlText) {
    throw new Error(`Yjs parent is text at path ${parentPath.join('.')}`)
  }

  return { index, parent }
}

const deleteInternalAttributes = (attributes: Record<string, unknown>) => {
  delete attributes[HIDDEN_ATTRIBUTE]
  delete attributes[NODE_ID_ATTRIBUTE]
  delete attributes[SPLIT_UNDO_TEXT_ATTRIBUTE]
  delete attributes[VIRTUAL_CHILD_ID_ATTRIBUTE]
  delete attributes[VIRTUAL_PLACEHOLDER_ATTRIBUTE]
}

const ensureYjsNodeId = (node: Y.XmlElement | Y.XmlText) => {
  const currentId = node.getAttribute(NODE_ID_ATTRIBUTE)

  if (typeof currentId === 'string') {
    return currentId
  }

  const nextId = `slate-yjs-${++nextNodeId}`

  node.setAttribute(NODE_ID_ATTRIBUTE, nextId)

  return nextId
}

const matchesSlateNode = (
  yjsNode: Y.XmlElement | Y.XmlText,
  slateNode?: Descendant
) => {
  if (!slateNode) {
    return false
  }

  if ('text' in slateNode) {
    return yjsNode instanceof Y.XmlText
  }

  if (!(yjsNode instanceof Y.XmlElement)) {
    return false
  }

  return (
    (yjsNode.getAttribute(SLATE_TYPE_ATTRIBUTE) ?? yjsNode.nodeName) ===
    String(slateNode.type ?? 'element')
  )
}

const hasHiddenYjsDescendant = (node: Y.XmlElement) => {
  const stack = getRawYjsChildren(node)

  while (stack.length > 0) {
    const child = stack.pop()!

    if (isHiddenYjsNode(child)) {
      return true
    }

    if (child instanceof Y.XmlElement) {
      stack.push(...getRawYjsChildren(child))
    }
  }

  return false
}

const findYjsNodeById = (
  root: Y.XmlElement,
  id: string
): Y.XmlElement | Y.XmlText | null => {
  const stack: Array<Y.XmlElement | Y.XmlText> = [root]

  while (stack.length > 0) {
    const node = stack.pop()!

    if (node.getAttribute(NODE_ID_ATTRIBUTE) === id) {
      return node
    }

    if (node instanceof Y.XmlElement) {
      stack.push(...getRawYjsChildren(node))
    }
  }

  return null
}
