import type { Descendant, Operation } from 'slate'
import * as Y from 'yjs'

import {
  formatYjsTextAttributes,
  getSlateYjsElementType,
  removeSlateYjsAttribute,
  setSlateYjsAttribute,
  setSlateYjsAttributes,
  type YjsAttributeRecord,
  type YjsNode,
} from './attributes'
import { getYjsChildren, getYjsLength } from './document'
import { isRecord } from './record'

type SlateElementLike = {
  readonly children: readonly Descendant[]
} & Readonly<Record<string, unknown>>

type SlateTextLike = {
  readonly text: string
} & Readonly<Record<string, unknown>>

const areJsonEqual = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

export const isNoopSlateOperationForYjs = (operation: Operation): boolean => {
  switch (operation.type) {
    case 'replace_children':
    case 'replace_fragment':
      return areJsonEqual(operation.children, operation.newChildren)
    default:
      return false
  }
}

const isSlateText = (node: unknown): node is SlateTextLike =>
  isRecord(node) && typeof node.text === 'string'

const isSlateElement = (node: unknown): node is SlateElementLike =>
  isRecord(node) && Array.isArray(node.children)

const getTextAttributes = ({
  text: _text,
  ...attributes
}: SlateTextLike): YjsAttributeRecord => attributes

const getElementAttributes = ({
  children: _children,
  ...attributes
}: SlateElementLike): YjsAttributeRecord => attributes

const applyTextFormatPatch = (
  text: Y.XmlText,
  patch: YjsAttributeRecord
): void => {
  const length = getYjsLength(text)

  if (length === 0) {
    return
  }

  formatYjsTextAttributes(text, 0, length, patch)
}

const assertYjsAttributeCanBeSet = (key: string): void => {
  if (key === 'children' || key === 'text') {
    throw new Error(`Cannot set the "${key}" property on a Yjs node.`)
  }
}

export const setYjsNodeAttributes = (
  node: YjsNode,
  properties: YjsAttributeRecord,
  newProperties: YjsAttributeRecord
): void => {
  const textPatch: YjsAttributeRecord = {}

  for (const [key, value] of Object.entries(newProperties)) {
    assertYjsAttributeCanBeSet(key)

    if (value === null || value === undefined) {
      removeSlateYjsAttribute(node, key)
      textPatch[key] = null
      continue
    }

    setSlateYjsAttribute(node, key, value)

    if (node instanceof Y.XmlText) {
      textPatch[key] = value
    }
  }

  for (const key of Object.keys(properties)) {
    if (Object.hasOwn(newProperties, key)) {
      continue
    }
    assertYjsAttributeCanBeSet(key)

    removeSlateYjsAttribute(node, key)

    if (node instanceof Y.XmlText) {
      textPatch[key] = null
    }
  }

  if (node instanceof Y.XmlText && Object.keys(textPatch).length > 0) {
    applyTextFormatPatch(node, textPatch)
  }
}

export const createSplitElement = (
  original: Y.XmlElement,
  properties: YjsAttributeRecord,
  children: readonly YjsNode[]
): Y.XmlElement => {
  const { type: _type, ...attributes } = properties
  const elementType =
    typeof properties.type === 'string'
      ? properties.type
      : getSlateYjsElementType(original)
  const element = new Y.XmlElement(elementType)

  setSlateYjsAttribute(element, 'type', elementType)
  setSlateYjsAttributes(element, attributes)

  if (children.length > 0) {
    element.insert(0, [...children])
  }

  return element
}

const getSharedPrefixLength = (left: string, right: string): number => {
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
): number => {
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
  attributes: YjsAttributeRecord
): void => {
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
  children: readonly YjsNode[],
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

export const replaceCompatibleYjsChildren = (
  children: readonly YjsNode[],
  oldChildren: readonly Descendant[],
  newChildren: readonly Descendant[]
): boolean => {
  if (!canReplaceCompatibleYjsChildren(children, oldChildren, newChildren)) {
    return false
  }

  children.forEach((child, index) => {
    const oldChild = oldChildren[index]
    const newChild = newChildren[index]

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
