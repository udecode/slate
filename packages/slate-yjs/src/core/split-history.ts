import type { Path } from 'slate'
import * as Y from 'yjs'

import {
  getYjsLength,
  getYjsNode,
  getYjsTextContent,
  getYjsVisibleChildren,
  SPLIT_UNDO_TEXT_ATTRIBUTE,
} from './document'

export type SplitHistory = {
  absorbedRemoteSplit?: boolean
  elementPath: Path
  elementPosition: number
  elementProperties: Record<string, unknown>
  rightText: string
  textPath: Path
  textProperties: Record<string, unknown>
  undoneWhileDisconnected?: boolean
}

export type PendingTextSplitHistory = Omit<
  SplitHistory,
  'elementPosition' | 'elementProperties'
>

export const SPLIT_HISTORY_META = 'slate-yjs:split-history'

const appendTextContent = (
  target: Y.XmlText,
  source: Y.XmlText,
  extraAttributes: Record<string, unknown> = {}
) => {
  let offset = getYjsLength(target)
  let insertedText = ''

  for (const delta of source.toDelta()) {
    if (typeof delta.insert !== 'string' || delta.insert.length === 0) {
      continue
    }

    target.insert(offset, delta.insert, {
      ...(delta.attributes ?? {}),
      ...extraAttributes,
    })
    offset += delta.insert.length
    insertedText += delta.insert
  }

  return insertedText
}

export const appendElementText = (
  root: Y.XmlElement,
  target: Y.XmlText,
  element: Y.XmlElement,
  extraAttributes: Record<string, unknown> = {}
) => {
  let insertedText = ''

  for (const child of getYjsVisibleChildren(root, element)) {
    if (child instanceof Y.XmlText) {
      insertedText += appendTextContent(target, child, extraAttributes)
    } else {
      insertedText += appendElementText(root, target, child, extraAttributes)
    }
  }

  return insertedText
}

const findLastVisibleText = (
  root: Y.XmlElement,
  node: Y.XmlElement | Y.XmlText
): Y.XmlText | null => {
  if (node instanceof Y.XmlText) {
    return node
  }

  const children = getYjsVisibleChildren(root, node)

  for (let index = children.length - 1; index >= 0; index--) {
    const child = children[index]
    const text = child ? findLastVisibleText(root, child) : null

    if (text) {
      return text
    }
  }

  return null
}

export const getTrailingSplitUndoText = (text: Y.XmlText) => {
  let offset = getYjsLength(text)
  let value = ''

  for (const delta of [...text.toDelta()].reverse()) {
    if (typeof delta.insert !== 'string' || delta.insert.length === 0) {
      return value ? { length: value.length, offset, value } : null
    }

    if (delta.attributes?.[SPLIT_UNDO_TEXT_ATTRIBUTE] === true) {
      offset -= delta.insert.length
      value = delta.insert + value
      continue
    }

    break
  }

  return value ? { length: value.length, offset, value } : null
}

export const clearSplitUndoTextAttribute = (
  text: Y.XmlText,
  offset: number,
  length: number
) => {
  text.format(offset, length, {
    [SPLIT_UNDO_TEXT_ATTRIBUTE]: null,
  } as unknown as Record<string, never>)
}

export const getVisibleText = (
  root: Y.XmlElement,
  node: Y.XmlElement | Y.XmlText
): string => {
  if (node instanceof Y.XmlText) {
    return getYjsTextContent(node)
  }

  return getYjsVisibleChildren(root, node)
    .map((child) => getVisibleText(root, child))
    .join('')
}

export const findSplitUndoTextRepairs = (root: Y.XmlElement) => {
  const repairs: Array<{
    hasRemoteSplitBoundary: boolean
    length: number
    offset: number
    text: Y.XmlText
  }> = []

  const visit = (parent: Y.XmlElement) => {
    const children = getYjsVisibleChildren(root, parent)

    for (let index = 0; index < children.length; index++) {
      const left = children[index]

      if (!(left instanceof Y.XmlElement)) {
        continue
      }

      const leftText = findLastVisibleText(root, left)
      const right = children[index + 1]
      const trailing = leftText ? getTrailingSplitUndoText(leftText) : null

      if (leftText && trailing) {
        repairs.push({
          hasRemoteSplitBoundary: right
            ? getVisibleText(root, right).startsWith(trailing.value)
            : false,
          length: trailing.length,
          offset: trailing.offset,
          text: leftText,
        })
      }
    }

    for (const child of children) {
      if (child instanceof Y.XmlElement) {
        visit(child)
      }
    }
  }

  visit(root)

  return repairs
}

export const isSplitHistory = (value: unknown): value is SplitHistory =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as SplitHistory).elementPath) &&
  Array.isArray((value as SplitHistory).textPath) &&
  typeof (value as SplitHistory).rightText === 'string' &&
  typeof (value as SplitHistory).elementPosition === 'number'

export const nextPath = (path: Path) => {
  const index = path.at(-1)

  if (index === undefined) {
    throw new Error('Cannot get a next path for the root.')
  }

  return [...path.slice(0, -1), index + 1]
}

export const getYjsNodeIf = (root: Y.XmlElement, path: Path) => {
  try {
    return getYjsNode(root, path)
  } catch {
    return null
  }
}

export const pathsEqual = (a: Path, b: Path) =>
  a.length === b.length && a.every((part, index) => part === b[index])
