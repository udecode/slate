import { getCurrentSelection } from '../core/public-state'
import type { SelectionTransforms } from '../interfaces/transforms/selection'

export const deselect: SelectionTransforms['deselect'] = (editor) => {
  const selection = getCurrentSelection(editor)

  if (selection) {
    editor.apply({
      type: 'set_selection',
      properties: selection,
      newProperties: null,
    })
  }
}
