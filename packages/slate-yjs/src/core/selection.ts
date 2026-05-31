import type { Point, Range } from 'slate'
import * as Y from 'yjs'

import { getYjsLength, getYjsNode, getYjsVisiblePath } from './document'

export type YjsRelativeRange = {
  anchor: Y.RelativePosition
  focus: Y.RelativePosition
}

export const slatePointToYjsRelativePosition = (
  root: Y.XmlElement,
  point: Point
) => {
  const target = getYjsNode(root, point.path)

  if (!(target instanceof Y.XmlText)) {
    throw new Error('Slate point does not target a Y.XmlText.')
  }

  const offset = Math.max(0, Math.min(point.offset, getYjsLength(target)))

  return Y.createRelativePositionFromTypeIndex(
    target,
    offset,
    offset === getYjsLength(target) ? -1 : 0
  )
}

export const yjsRelativePositionToSlatePoint = (
  root: Y.XmlElement,
  position: Y.RelativePosition
): Point | null => {
  if (!root.doc) {
    throw new Error('Yjs root must be attached to a Y.Doc.')
  }

  const absolute = Y.createAbsolutePositionFromRelativePosition(
    position,
    root.doc
  )

  if (!absolute || !(absolute.type instanceof Y.XmlText)) {
    return null
  }

  const path = getYjsVisiblePath(root, absolute.type)

  if (!path) {
    return null
  }

  return {
    path,
    offset: Math.max(0, Math.min(absolute.index, getYjsLength(absolute.type))),
  }
}

export const slateRangeToYjsRelativeRange = (
  root: Y.XmlElement,
  range: Range
): YjsRelativeRange => ({
  anchor: slatePointToYjsRelativePosition(root, range.anchor),
  focus: slatePointToYjsRelativePosition(root, range.focus),
})

export const yjsRelativeRangeToSlateRange = (
  root: Y.XmlElement,
  range: YjsRelativeRange
): Range | null => {
  const anchor = yjsRelativePositionToSlatePoint(root, range.anchor)
  const focus = yjsRelativePositionToSlatePoint(root, range.focus)

  if (!anchor || !focus) {
    return null
  }

  return { anchor, focus }
}
