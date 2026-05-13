import { executeCommand } from '../core/command-registry'
import { applyOperation, getCurrentSelection } from '../core/public-state'
import type { Operation } from '../interfaces/operation'
import { PointApi } from '../interfaces/point'
import type { Range } from '../interfaces/range'
import { NON_SETTABLE_SELECTION_PROPERTIES } from '../interfaces/transforms/general'
import type { SelectionMutationMethods } from '../interfaces/transforms/selection'

export type SetSelectionCommand = Extract<Operation, { type: 'set_selection' }>

export const applySetSelectionCommand = (
  editor: Parameters<SelectionMutationMethods['setSelection']>[0],
  command: SetSelectionCommand
) => {
  applyOperation(editor, command)
}

export const executeSetSelectionCommand = (
  editor: Parameters<SelectionMutationMethods['setSelection']>[0],
  command: SetSelectionCommand
) =>
  executeCommand<SetSelectionCommand>(editor, command, (nextCommand) => {
    applySetSelectionCommand(editor, nextCommand)
    return { handled: true }
  })

export const setSelection: SelectionMutationMethods['setSelection'] = (
  editor,
  props
) => {
  const selection = getCurrentSelection(editor)
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

  executeSetSelectionCommand(editor, {
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
    PointApi.isPoint(value) &&
    PointApi.isPoint(newValue)
  ) {
    return !PointApi.equals(value, newValue)
  }

  return value !== newValue
}
