import { type BaseSelection, Range } from 'slate'

import { readRuntimeSelection } from '../editable/runtime-selection-state'
import { useEditorSelector } from './use-editor-selector'

/**
 * Get the current editor selection.
 * Only triggers a rerender when the selection actually changes
 */
export const useEditorSelection = () => {
  return useEditorSelector(
    (editor) => readRuntimeSelection(editor),
    isSelectionEqual,
    { profileId: 'editor-selection' }
  )
}

const isSelectionEqual = (a: BaseSelection, b: BaseSelection) => {
  if (!a && !b) return true
  if (!a || !b) return false
  return Range.equals(a, b)
}
