import type { Range } from 'slate'
import { DOMCoverage } from 'slate-dom/internal'

import type { ReactRuntimeEditor } from '../plugin/react-editor'

export const applyDOMCoverageSelectionPolicy = ({
  domSelection,
  editor,
  selection,
}: {
  domSelection: globalThis.Selection
  editor: ReactRuntimeEditor
  selection: Range
}) => {
  const boundaries = DOMCoverage.getBoundariesForRange(editor, selection)

  if (boundaries.length === 0) {
    return false
  }

  for (const boundary of boundaries) {
    if (boundary.selectionPolicy === 'materialize') {
      DOMCoverage.materializeBoundary(
        editor,
        boundary.boundaryId,
        'selection',
        {
          range: selection,
        }
      )
    }
  }

  domSelection.removeAllRanges()
  return true
}
