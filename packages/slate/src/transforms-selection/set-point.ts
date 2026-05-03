import { getCurrentSelection } from '../core/public-state'
import { getEditorTransformRegistry } from '../core/transform-registry'
import { Range } from '../interfaces/range'
import type { SelectionMutationMethods } from '../interfaces/transforms/selection'

export const setPoint: SelectionMutationMethods['setPoint'] = (
  editor,
  props,
  options = {}
) => {
  const selection = getCurrentSelection(editor)
  let { edge = 'both' } = options

  if (!selection) {
    return
  }

  if (edge === 'start') {
    edge = Range.isBackward(selection) ? 'focus' : 'anchor'
  }

  if (edge === 'end') {
    edge = Range.isBackward(selection) ? 'anchor' : 'focus'
  }

  const { anchor, focus } = selection
  const point = edge === 'anchor' ? anchor : focus

  getEditorTransformRegistry(editor).setSelection({
    [edge === 'anchor' ? 'anchor' : 'focus']: { ...point, ...props },
  })
}
