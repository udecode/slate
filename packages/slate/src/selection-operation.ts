import type { SetSelectionOperation } from './interfaces/operation'
import type { Range } from './interfaces/range'

const clonePoint = (point: Range['anchor']) => ({
  path: [...point.path],
  offset: point.offset,
})

const cloneRange = (range: Range | null): Range | null =>
  range
    ? {
        anchor: clonePoint(range.anchor),
        focus: clonePoint(range.focus),
      }
    : null

export const createSetSelectionOperation = (
  previous: Range | null,
  next: Range | null
): SetSelectionOperation => {
  if (previous == null) {
    return {
      type: 'set_selection',
      properties: null,
      newProperties: cloneRange(next)!,
    }
  }

  if (next == null) {
    return {
      type: 'set_selection',
      properties: cloneRange(previous)!,
      newProperties: null,
    }
  }

  return {
    type: 'set_selection',
    properties: cloneRange(previous)!,
    newProperties: cloneRange(next)!,
  }
}
