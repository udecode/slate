import type { Descendant, Operation } from 'slate'
import * as Y from 'yjs'

import {
  cloneVisibleYjsNode,
  createVirtualYjsMovePlaceholder,
  createYjsNode,
  getYjsChildren,
  getYjsLength,
  getYjsNode,
  getYjsParent,
  getYjsTextContent,
  getYjsVisibleChildren,
  hideYjsNode,
  insertYjsChild,
  isVirtualYjsChild,
  removeYjsChild,
  setVirtualYjsMove,
  setVirtualYjsUnwrapMove,
} from './document'
import type { YjsTraceEntry } from './types'

const SLATE_TYPE_ATTRIBUTE = 'slate:type'

type SlateElementLike = {
  children: readonly Descendant[]
} & Record<string, unknown>

const areJsonEqual = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right)

export const isNoopSlateOperationForYjs = (operation: Operation) => {
  switch (operation.type) {
    case 'replace_children':
    case 'replace_fragment':
      return areJsonEqual(operation.children, operation.newChildren)
    default:
      return false
  }
}

const isSlateText = (
  node: unknown
): node is { text: string } & Record<string, unknown> =>
  typeof node === 'object' &&
  node !== null &&
  'text' in node &&
  typeof (node as { text?: unknown }).text === 'string'

const isSlateElement = (node: unknown): node is SlateElementLike =>
  typeof node === 'object' &&
  node !== null &&
  'children' in node &&
  Array.isArray((node as { children?: unknown }).children)

const getTextAttributes = ({ text: _text, ...attributes }: { text: string }) =>
  attributes as Record<string, unknown>

const getElementAttributes = ({
  children: _children,
  ...attributes
}: SlateElementLike) => attributes

const createYjsText = (text: string, attributes: Record<string, unknown>) => {
  const yjsText = new Y.XmlText()

  for (const [key, value] of Object.entries(attributes)) {
    yjsText.setAttribute(key, value as never)
  }

  if (text.length > 0) {
    yjsText.insert(0, text, attributes)
  }

  return yjsText
}

const setElementAttributes = (
  element: Y.XmlElement,
  attributes: Record<string, unknown>
) => {
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'type') {
      element.setAttribute(SLATE_TYPE_ATTRIBUTE, String(value))
      continue
    }

    element.setAttribute(key, value as never)
  }
}

const setYjsAttribute = (
  node: Y.XmlElement | Y.XmlText,
  key: string,
  value: unknown
) => {
  if (key === 'type' && node instanceof Y.XmlElement) {
    node.setAttribute(SLATE_TYPE_ATTRIBUTE, String(value))
    return
  }

  node.setAttribute(key, value as never)
}

const removeYjsAttribute = (node: Y.XmlElement | Y.XmlText, key: string) => {
  if (key === 'type' && node instanceof Y.XmlElement) {
    node.removeAttribute(SLATE_TYPE_ATTRIBUTE)
    return
  }

  node.removeAttribute(key)
}

const applyTextFormatPatch = (
  text: Y.XmlText,
  patch: Record<string, unknown>
) => {
  const length = getYjsLength(text)

  if (length === 0) {
    return
  }

  text.format(0, length, patch as Record<string, never>)
}

const setYjsNodeAttributes = (
  node: Y.XmlElement | Y.XmlText,
  properties: Record<string, unknown>,
  newProperties: Record<string, unknown>
) => {
  const textPatch: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(newProperties)) {
    if (key === 'children' || key === 'text') {
      throw new Error(`Cannot set the "${key}" property on a Yjs node.`)
    }

    if (value == null) {
      removeYjsAttribute(node, key)
      textPatch[key] = null
      continue
    }

    setYjsAttribute(node, key, value)

    if (node instanceof Y.XmlText) {
      textPatch[key] = value
    }
  }

  for (const key of Object.keys(properties)) {
    if (Object.hasOwn(newProperties, key)) {
      continue
    }
    if (key === 'children' || key === 'text') {
      throw new Error(`Cannot set the "${key}" property on a Yjs node.`)
    }

    removeYjsAttribute(node, key)

    if (node instanceof Y.XmlText) {
      textPatch[key] = null
    }
  }

  if (node instanceof Y.XmlText && Object.keys(textPatch).length > 0) {
    applyTextFormatPatch(node, textPatch)
  }
}

const createSplitElement = (
  original: Y.XmlElement,
  properties: Record<string, unknown>,
  children: Array<Y.XmlElement | Y.XmlText>
) => {
  const type =
    typeof properties.type === 'string'
      ? properties.type
      : (original.getAttribute(SLATE_TYPE_ATTRIBUTE) ?? original.nodeName)
  const element = new Y.XmlElement(String(type))

  element.setAttribute(SLATE_TYPE_ATTRIBUTE, String(type))
  setElementAttributes(element, properties)

  if (children.length > 0) {
    element.insert(0, children)
  }

  return element
}

const getSharedPrefixLength = (left: string, right: string) => {
  let index = 0

  while (
    index < left.length &&
    index < right.length &&
    left[index] === right[index]
  ) {
    index++
  }

  return index
}

const getSharedSuffixLength = (
  left: string,
  right: string,
  prefixLength: number
) => {
  let length = 0

  while (
    length < left.length - prefixLength &&
    length < right.length - prefixLength &&
    left.at(-1 - length) === right.at(-1 - length)
  ) {
    length++
  }

  return length
}

const replaceYjsText = (
  text: Y.XmlText,
  previous: string,
  next: string,
  attributes: Record<string, unknown>
) => {
  const prefixLength = getSharedPrefixLength(previous, next)
  const suffixLength = getSharedSuffixLength(previous, next, prefixLength)
  const removeLength = previous.length - prefixLength - suffixLength
  const insertText = next.slice(prefixLength, next.length - suffixLength)

  if (removeLength > 0) {
    text.delete(prefixLength, removeLength)
  }

  if (insertText.length > 0) {
    text.insert(prefixLength, insertText, attributes)
  }
}

const canReplaceCompatibleYjsChildren = (
  children: Array<Y.XmlElement | Y.XmlText>,
  oldChildren: readonly Descendant[],
  newChildren: readonly Descendant[]
): boolean => {
  if (
    children.length !== oldChildren.length ||
    children.length !== newChildren.length
  ) {
    return false
  }

  return children.every((child, index) => {
    const oldChild = oldChildren[index]
    const newChild = newChildren[index]

    if (child instanceof Y.XmlText) {
      return isSlateText(oldChild) && isSlateText(newChild)
    }

    if (
      child instanceof Y.XmlElement &&
      isSlateElement(oldChild) &&
      isSlateElement(newChild)
    ) {
      return canReplaceCompatibleYjsChildren(
        getYjsChildren(child),
        oldChild.children,
        newChild.children
      )
    }

    return false
  })
}

const replaceCompatibleYjsChildren = (
  children: Array<Y.XmlElement | Y.XmlText>,
  oldChildren: readonly Descendant[],
  newChildren: readonly Descendant[]
): boolean => {
  if (!canReplaceCompatibleYjsChildren(children, oldChildren, newChildren)) {
    return false
  }

  children.forEach((child, index) => {
    const oldChild = oldChildren[index]!
    const newChild = newChildren[index]!

    if (child instanceof Y.XmlText) {
      if (!isSlateText(oldChild) || !isSlateText(newChild)) {
        return
      }

      const attributes = getTextAttributes(newChild)

      setYjsNodeAttributes(child, getTextAttributes(oldChild), attributes)
      replaceYjsText(child, oldChild.text, newChild.text, attributes)

      return
    }

    if (
      child instanceof Y.XmlElement &&
      isSlateElement(oldChild) &&
      isSlateElement(newChild)
    ) {
      setYjsNodeAttributes(
        child,
        getElementAttributes(oldChild),
        getElementAttributes(newChild)
      )
      replaceCompatibleYjsChildren(
        getYjsChildren(child),
        oldChild.children,
        newChild.children
      )
    }
  })

  return true
}

const pathsEqual = (left: readonly number[], right: readonly number[]) =>
  left.length === right.length &&
  left.every((part, index) => part === right[index])

const getYjsNodeIf = (root: Y.XmlElement, path: number[]) => {
  try {
    return getYjsNode(root, path)
  } catch {
    return null
  }
}

const isEmptyYjsText = (node: Y.XmlElement | Y.XmlText) =>
  node instanceof Y.XmlText && getYjsTextContent(node).length === 0

const getYjsElementType = (element: Y.XmlElement) =>
  String(element.getAttribute(SLATE_TYPE_ATTRIBUTE) ?? element.nodeName)

type YjsElementChildKind = 'element' | 'empty' | 'mixed' | 'text'

const getYjsElementChildKind = (
  root: Y.XmlElement,
  element: Y.XmlElement
): YjsElementChildKind => {
  let kind: YjsElementChildKind = 'empty'

  for (const child of getYjsVisibleChildren(root, element)) {
    const childKind = child instanceof Y.XmlText ? 'text' : 'element'

    if (kind === 'empty') {
      kind = childKind
      continue
    }

    if (kind !== childKind) {
      return 'mixed'
    }
  }

  return kind
}

const canMergeYjsElements = (
  root: Y.XmlElement,
  previous: Y.XmlElement,
  target: Y.XmlElement
) => {
  if (getYjsElementType(previous) !== getYjsElementType(target)) {
    return false
  }

  const previousKind = getYjsElementChildKind(root, previous)
  const targetKind = getYjsElementChildKind(root, target)

  if (previousKind === 'mixed' || targetKind === 'mixed') {
    return false
  }

  return (
    previousKind === 'empty' ||
    targetKind === 'empty' ||
    previousKind === targetKind
  )
}

const unsupportedYjsOperation = (operation: never): never => {
  const operationType = (operation as { type?: unknown }).type

  throw new Error(
    `Unsupported Yjs operation: ${
      typeof operationType === 'string' ? operationType : 'unknown'
    }`
  )
}

export const applySlateOperationToYjs = (
  root: Y.XmlElement,
  operation: Operation
): YjsTraceEntry | null => {
  if (isNoopSlateOperationForYjs(operation)) {
    return null
  }

  switch (operation.type) {
    case 'insert_text': {
      const text = getYjsNode(root, operation.path)

      if (!(text instanceof Y.XmlText)) {
        throw new Error('insert_text target is not a Y.XmlText.')
      }

      text.insert(operation.offset, operation.text)

      return { mode: 'operation', operationType: operation.type }
    }
    case 'remove_text': {
      const text = getYjsNode(root, operation.path)

      if (!(text instanceof Y.XmlText)) {
        throw new Error('remove_text target is not a Y.XmlText.')
      }

      text.delete(operation.offset, operation.text.length)

      return { mode: 'operation', operationType: operation.type }
    }
    case 'insert_node': {
      const { index, parent } = getYjsParent(root, operation.path)

      insertYjsChild(root, parent, index, createYjsNode(operation.node))

      return { mode: 'operation', operationType: operation.type }
    }
    case 'remove_node': {
      const { index, parent } = getYjsParent(root, operation.path)
      const removalMode = removeYjsChild(root, parent, index, operation.node)

      if (removalMode === 'hidden') {
        return {
          fallback: 'virtual-unwrap-wrapper-remove',
          mode: 'traceable-fallback',
          operationType: operation.type,
        }
      }
      if (removalMode === 'hidden-parent') {
        return {
          fallback: 'virtual-move-parent-remove',
          mode: 'traceable-fallback',
          operationType: operation.type,
        }
      }

      return { mode: 'operation', operationType: operation.type }
    }
    case 'split_node': {
      const target = getYjsNode(root, operation.path)
      const { index, parent } = getYjsParent(root, operation.path)

      if (target instanceof Y.XmlText) {
        const rightText = getYjsTextContent(target).slice(operation.position)

        if (rightText.length > 0) {
          target.delete(operation.position, rightText.length)
        }

        insertYjsChild(
          root,
          parent,
          index + 1,
          createYjsText(
            rightText,
            operation.properties as Record<string, unknown>
          )
        )

        return { mode: 'operation', operationType: operation.type }
      }

      const children = getYjsChildren(target)
      const rightChildren = children
        .slice(operation.position)
        .flatMap((child) => {
          const clone = cloneVisibleYjsNode(root, child)

          return clone ? [clone] : []
        })
      const deleteCount = getYjsLength(target) - operation.position

      if (deleteCount > 0) {
        target.delete(operation.position, deleteCount)
      }

      insertYjsChild(
        root,
        parent,
        index + 1,
        createSplitElement(
          target,
          operation.properties as Record<string, unknown>,
          rightChildren
        )
      )

      return { mode: 'operation', operationType: operation.type }
    }
    case 'merge_node': {
      const { index, parent } = getYjsParent(root, operation.path)

      if (index === 0) {
        throw new Error('Cannot merge the first Yjs child.')
      }

      const children = getYjsVisibleChildren(root, parent)
      const previous = children[index - 1]
      const target = children[index]

      if (previous instanceof Y.XmlText && !target) {
        return {
          fallback: 'empty-text-merge-elided',
          mode: 'traceable-fallback',
          operationType: operation.type,
        }
      }

      if (!previous || !target) {
        throw new Error('Cannot merge a missing Yjs node.')
      }

      if (previous instanceof Y.XmlText && target instanceof Y.XmlText) {
        return {
          fallback: 'text-merge-preserve-yjs-boundary',
          mode: 'traceable-fallback',
          operationType: operation.type,
        }
      }

      if (previous instanceof Y.XmlElement && target instanceof Y.XmlElement) {
        if (!canMergeYjsElements(root, previous, target)) {
          return {
            fallback: 'incompatible-structural-merge-elided',
            mode: 'traceable-fallback',
            operationType: operation.type,
          }
        }

        const previousHasChildren =
          getYjsVisibleChildren(root, previous).length > 0

        for (const moveTarget of getYjsVisibleChildren(root, target)) {
          if (previousHasChildren && isEmptyYjsText(moveTarget)) {
            continue
          }

          insertYjsChild(
            root,
            previous,
            getYjsLength(previous),
            createVirtualYjsMovePlaceholder(moveTarget)
          )
        }

        hideYjsNode(target)

        return {
          fallback: 'virtual-merge-ref',
          mode: 'traceable-fallback',
          operationType: operation.type,
        }
      }

      throw new Error('Cannot merge Yjs nodes of different kinds.')
    }
    case 'replace_fragment': {
      const target =
        operation.path.length === 0 ? root : getYjsNode(root, operation.path)

      if (!(target instanceof Y.XmlElement)) {
        throw new Error('replace_fragment target is not a Y.XmlElement.')
      }

      const children = getYjsChildren(target)
      if (
        replaceCompatibleYjsChildren(
          children,
          operation.children,
          operation.newChildren
        )
      ) {
        return { mode: 'operation', operationType: operation.type }
      }

      if (getYjsLength(target) > 0) {
        target.delete(0, getYjsLength(target))
      }

      if (operation.newChildren.length > 0) {
        target.insert(0, operation.newChildren.map(createYjsNode))
      }

      return {
        fallback: 'replace-fragment-scoped-replace-identity-risk',
        mode: 'traceable-fallback',
        operationType: operation.type,
      }
    }
    case 'set_selection':
      return null
    case 'set_node': {
      const node = getYjsNode(root, operation.path)

      setYjsNodeAttributes(
        node,
        operation.properties as Record<string, unknown>,
        operation.newProperties as Record<string, unknown>
      )

      return { mode: 'operation', operationType: operation.type }
    }
    case 'replace_children': {
      const target =
        operation.path.length === 0 ? root : getYjsNode(root, operation.path)

      if (!(target instanceof Y.XmlElement)) {
        throw new Error('replace_children target is not a Y.XmlElement.')
      }

      const existingChildren = getYjsVisibleChildren(root, target).slice(
        operation.index,
        operation.index + operation.children.length
      )

      if (
        replaceCompatibleYjsChildren(
          existingChildren,
          operation.children,
          operation.newChildren
        )
      ) {
        return { mode: 'operation', operationType: operation.type }
      }

      const removalModes = operation.children.map((child) =>
        removeYjsChild(root, target, operation.index, child)
      )

      operation.newChildren.forEach((child, offset) => {
        insertYjsChild(
          root,
          target,
          operation.index + offset,
          createYjsNode(child)
        )
      })

      if (removalModes.some((mode) => mode !== 'visible')) {
        return {
          fallback: 'replace-children-virtual-removal',
          mode: 'traceable-fallback',
          operationType: operation.type,
        }
      }

      return { mode: 'operation', operationType: operation.type }
    }
    case 'move_node': {
      const target = getYjsNodeIf(root, operation.path)

      if (!target) {
        return {
          fallback: 'missing-move-source-elided',
          mode: 'traceable-fallback',
          operationType: operation.type,
        }
      }

      const sourceParentPath = operation.path.slice(0, -1)
      const sourceParent =
        sourceParentPath.length === 0
          ? root
          : getYjsNodeIf(root, sourceParentPath)
      const newParentPath = operation.newPath.slice(0, -1)
      const newIndex = operation.newPath.at(-1)
      const newParent =
        newParentPath.length === 0 ? root : getYjsNodeIf(root, newParentPath)

      if (
        sourceParent instanceof Y.XmlElement &&
        isVirtualYjsChild(target, sourceParent) &&
        pathsEqual(operation.newPath, sourceParentPath)
      ) {
        setVirtualYjsUnwrapMove(target, sourceParent)

        return {
          fallback: 'virtual-unwrap-ref',
          mode: 'traceable-fallback',
          operationType: operation.type,
        }
      }

      if (!(newParent instanceof Y.XmlElement)) {
        return {
          fallback: 'missing-move-destination-elided',
          mode: 'traceable-fallback',
          operationType: operation.type,
        }
      }
      if (newIndex === undefined) {
        throw new Error('move_node destination is missing an index.')
      }

      if (newIndex === 0 && getYjsLength(newParent) === 0) {
        setVirtualYjsMove(root, target, newParent)

        return {
          fallback: 'virtual-move-ref',
          mode: 'traceable-fallback',
          operationType: operation.type,
        }
      }

      insertYjsChild(
        root,
        newParent,
        newIndex,
        createVirtualYjsMovePlaceholder(target)
      )

      return {
        fallback: 'virtual-move-placeholder',
        mode: 'traceable-fallback',
        operationType: operation.type,
      }
    }
  }

  return unsupportedYjsOperation(operation)
}
