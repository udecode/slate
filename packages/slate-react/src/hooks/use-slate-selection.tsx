import { type BaseSelection, Range } from 'slate'

import { readRuntimeSelection } from '../editable/runtime-selection-state'
import { useSlateSelector } from './use-slate-selector'

/**
 * Get the current slate selection.
 * Only triggers a rerender when the selection actually changes
 */
export const useSlateSelection = () => {
  return useSlateSelector(
    (editor) => readRuntimeSelection(editor),
    isSelectionEqual
  )
}

const isSelectionEqual = (a: BaseSelection, b: BaseSelection) => {
  if (!a && !b) return true
  if (!a || !b) return false
  return Range.equals(a, b)
}
