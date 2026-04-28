import { getCurrentSelection } from '../core/public-state'
import { Range } from '../interfaces/range'
import type { SelectionMutationMethods } from '../interfaces/transforms/selection'

export const collapse: SelectionMutationMethods['collapse'] = (
  editor,
  options = {}
) => {
  const { edge = 'anchor' } = options
  const selection = getCurrentSelection(editor)

  if (!selection) {
    return
  }
  if (edge === 'anchor') {
    editor.select(selection.anchor)
  } else if (edge === 'focus') {
    editor.select(selection.focus)
  } else if (edge === 'start') {
    const [start] = Range.edges(selection)
    editor.select(start)
  } else if (edge === 'end') {
    const [, end] = Range.edges(selection)
    editor.select(end)
  }
}
