import { getCurrentSelection } from '../core/public-state'
import { getEditorTransformRegistry } from '../core/transform-registry'
import { Location } from '../interfaces'
import { Editor } from '../interfaces/editor'
import { Scrubber } from '../interfaces/scrubber'
import type { SelectionMutationMethods } from '../interfaces/transforms/selection'
import { executeSetSelectionCommand } from './set-selection'

export const select: SelectionMutationMethods['select'] = (editor, target) => {
  const selection = getCurrentSelection(editor)
  const range = Editor.range(editor, target)

  if (selection) {
    getEditorTransformRegistry(editor).setSelection(range)
    return
  }

  if (!Location.isRange(range)) {
    throw new Error(
      `When setting the selection and the current selection is \`null\` you must provide at least an \`anchor\` and \`focus\`, but you passed: ${Scrubber.stringify(
        range
      )}`
    )
  }

  executeSetSelectionCommand(editor, {
    type: 'set_selection',
    properties: selection,
    newProperties: range,
  })
}
