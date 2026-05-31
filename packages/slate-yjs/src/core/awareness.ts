import type { Range } from 'slate'
import * as Y from 'yjs'

import {
  slateRangeToYjsRelativeRange,
  yjsRelativeRangeToSlateRange,
} from './selection'
import type { YjsAwarenessSelection } from './types'

export const createYjsAwarenessSelection = (
  root: Y.XmlElement,
  range: Range
): YjsAwarenessSelection => {
  const relative = slateRangeToYjsRelativeRange(root, range)

  return {
    anchor: Y.relativePositionToJSON(relative.anchor),
    focus: Y.relativePositionToJSON(relative.focus),
  }
}

export const readYjsAwarenessSelection = (
  root: Y.XmlElement,
  value: unknown
): Range | null => {
  if (!isYjsAwarenessSelection(value)) {
    return null
  }

  try {
    return yjsRelativeRangeToSlateRange(root, {
      anchor: Y.createRelativePositionFromJSON(value.anchor),
      focus: Y.createRelativePositionFromJSON(value.focus),
    })
  } catch {
    return null
  }
}

export const yjsAwarenessSelectionsEqual = (
  a: unknown,
  b: YjsAwarenessSelection | null
) => {
  if (a === b) {
    return true
  }
  if (a === null || b === null) {
    return a === b
  }
  if (!isYjsAwarenessSelection(a)) {
    return false
  }

  try {
    return (
      Y.compareRelativePositions(
        Y.createRelativePositionFromJSON(a.anchor),
        Y.createRelativePositionFromJSON(b.anchor)
      ) &&
      Y.compareRelativePositions(
        Y.createRelativePositionFromJSON(a.focus),
        Y.createRelativePositionFromJSON(b.focus)
      )
    )
  } catch {
    return false
  }
}

const isYjsAwarenessSelection = (
  value: unknown
): value is YjsAwarenessSelection =>
  typeof value === 'object' &&
  value !== null &&
  'anchor' in value &&
  'focus' in value
