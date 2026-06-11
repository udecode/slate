import type { Path } from 'slate'
import * as Y from 'yjs'

import {
  formatYjsTextAttributes,
  type YjsAttributeRecord,
  type YjsNode,
} from './attributes'
import {
  getYjsLength,
  getYjsTextContent,
  getYjsVisibleChildren,
  SPLIT_UNDO_TEXT_ATTRIBUTE,
} from './document'
import { isRecord } from './record'
import { isNonEmptyYjsTextDeltaPart } from './text-delta'

export type SplitHistory = {
  absorbedRemoteSplit?: boolean
  readonly elementPath: Path
  readonly elementPosition: number
  readonly elementProperties: YjsAttributeRecord
  rightText: string
  readonly textPath: Path
  readonly textProperties: YjsAttributeRecord
  undoneWhileDisconnected?: boolean
}

export type PendingTextSplitHistory = Omit<
  SplitHistory,
  'elementPosition' | 'elementProperties'
>

export const SPLIT_HISTORY_META = 'slate-yjs:split-history'

export type SplitUndoTextRepair = {
  readonly hasRemoteSplitBoundary: boolean
  readonly length: number
  readonly offset: number
  readonly text: Y.XmlText
}

type TrailingSplitUndoText = {
  readonly length: number
  readonly offset: number
  readonly value: string
}

const isSlateIndex = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

const isSlatePath = (value: unknown): value is Path =>
  Array.isArray(value) && value.every(isSlateIndex)

const isOptionalBoolean = (value: unknown): value is boolean | undefined =>
  value === undefined || typeof value === 'boolean'

const createTrailingSplitUndoText = (
  value: string,
  offset: number
): TrailingSplitUndoText | null =>
  value.length > 0 ? { length: value.length, offset, value } : null

const appendTextContent = (
  target: Y.XmlText,
  source: Y.XmlText,
  extraAttributes: YjsAttributeRecord = {}
): string => {
  let offset = getYjsLength(target)
  let insertedText = ''

  for (const delta of source.toDelta()) {
    if (!isNonEmptyYjsTextDeltaPart(delta)) {
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
  extraAttributes: YjsAttributeRecord = {}
): string => {
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
  node: YjsNode
): Y.XmlText | null => {
  if (node instanceof Y.XmlText) {
    return node
  }

  const children = getYjsVisibleChildren(root, node)

  for (let index = children.length - 1; index >= 0; index--) {
    const child = children[index]

    if (child === undefined) {
      continue
    }

    const text = findLastVisibleText(root, child)

    if (text !== null) {
      return text
    }
  }

  return null
}

export const getTrailingSplitUndoText = (
  text: Y.XmlText
): TrailingSplitUndoText | null => {
  let offset = getYjsLength(text)
  let value = ''

  for (const delta of [...text.toDelta()].reverse()) {
    if (!isNonEmptyYjsTextDeltaPart(delta)) {
      return createTrailingSplitUndoText(value, offset)
    }

    if (delta.attributes?.[SPLIT_UNDO_TEXT_ATTRIBUTE] === true) {
      offset -= delta.insert.length
      value = delta.insert + value
      continue
    }

    break
  }

  return createTrailingSplitUndoText(value, offset)
}

export const clearSplitUndoTextAttribute = (
  text: Y.XmlText,
  offset: number,
  length: number
): void => {
  formatYjsTextAttributes(text, offset, length, {
    [SPLIT_UNDO_TEXT_ATTRIBUTE]: null,
  })
}

export const getVisibleText = (root: Y.XmlElement, node: YjsNode): string => {
  if (node instanceof Y.XmlText) {
    return getYjsTextContent(node)
  }

  return getYjsVisibleChildren(root, node)
    .map((child) => getVisibleText(root, child))
    .join('')
}

export const findSplitUndoTextRepairs = (
  root: Y.XmlElement
): SplitUndoTextRepair[] => {
  const repairs: SplitUndoTextRepair[] = []

  const visit = (parent: Y.XmlElement): void => {
    const children = getYjsVisibleChildren(root, parent)

    for (let index = 0; index < children.length; index++) {
      const left = children[index]

      if (!(left instanceof Y.XmlElement)) {
        continue
      }

      const leftText = findLastVisibleText(root, left)
      const right = children[index + 1]
      const trailing =
        leftText === null ? null : getTrailingSplitUndoText(leftText)

      if (leftText !== null && trailing !== null) {
        repairs.push({
          hasRemoteSplitBoundary:
            right === undefined
              ? false
              : getVisibleText(root, right).startsWith(trailing.value),
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

export const isSplitHistory = (value: unknown): value is SplitHistory => {
  if (!isRecord(value)) {
    return false
  }

  return (
    isSlatePath(value.elementPath) &&
    isSlatePath(value.textPath) &&
    typeof value.rightText === 'string' &&
    isSlateIndex(value.elementPosition) &&
    isRecord(value.elementProperties) &&
    isRecord(value.textProperties) &&
    isOptionalBoolean(value.absorbedRemoteSplit) &&
    isOptionalBoolean(value.undoneWhileDisconnected)
  )
}
