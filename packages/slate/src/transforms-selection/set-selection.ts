import { Point } from '../interfaces/point'
import type { Range } from '../interfaces/range'
import { NON_SETTABLE_SELECTION_PROPERTIES } from '../interfaces/transforms/general'
import type { SelectionTransforms } from '../interfaces/transforms/selection'

export const setSelection: SelectionTransforms['setSelection'] = (
  editor,
  props
) => {
  const { selection } = editor
  const oldProps: Partial<Range> = {}
  const newProps: Partial<Range> = {}

  if (!selection) {
    return
  }

  for (const key in props) {
    if (NON_SETTABLE_SELECTION_PROPERTIES.includes(key)) {
      continue
    }

    const value = Object.hasOwn(selection, key)
      ? selection[<keyof Range>key]
      : undefined
    const newValue = props[<keyof Range>key]

    if (compareSelectionProps(<keyof Range>key, value, newValue)) {
      oldProps[<keyof Range>key] = selection[<keyof Range>key]
      newProps[<keyof Range>key] = props[<keyof Range>key]
    }
  }

  if (Object.keys(oldProps).length === 0) {
    return
  }

  editor.apply({
    type: 'set_selection',
    properties: oldProps,
    newProperties: newProps,
  })
}

const compareSelectionProps = (
  key: keyof Range,
  value: unknown,
  newValue: unknown
) => {
  if (
    (key === 'anchor' || key === 'focus') &&
    Point.isPoint(value) &&
    Point.isPoint(newValue)
  ) {
    return !Point.equals(value, newValue)
  }

  return value !== newValue
}
