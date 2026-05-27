import type { Point, Range } from 'slate'
import { createSlateViewBoundarySelectionTarget } from '../view-boundary-graph'
import type { SlateViewSelection } from '../view-selection'
import type { Editor as RuntimeEditor } from './runtime-editor-api'

export const createProjectedSelectionTarget = (
  editor: RuntimeEditor,
  viewSelection: SlateViewSelection
): { ranges: Range[]; start: Point } | null => {
  const roots = editor.read((state) => state.value.get().roots)

  return createSlateViewBoundarySelectionTarget(roots, viewSelection)
}
