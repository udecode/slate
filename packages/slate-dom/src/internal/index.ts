export {
  getDOMClipboardFormatKey,
  setDOMClipboardFormatKey,
} from '../plugin/dom-clipboard-runtime'
export type {
  DOMCoverageBoundary,
  DOMCoverageBoundaryAnchor,
  DOMCoverageBoundaryEdge,
  DOMCoverageBoundaryState,
  DOMCoverageCopyPolicy,
  DOMCoverageDOMPointResult,
  DOMCoverageDOMRangeResult,
  DOMCoverageFindPolicy,
  DOMCoverageMaterializeHandler,
  DOMCoverageMaterializeReason,
  DOMCoverageMaterializeResult,
  DOMCoveragePathRange,
  DOMCoverageReason,
  DOMCoverageRuntimeRange,
  DOMCoverageSelectionPolicy,
  DOMCoverageSlatePointResult,
} from '../plugin/dom-coverage'
export { DOMCoverage } from '../plugin/dom-coverage'
export type { DOMEditorInterface } from '../plugin/dom-editor'
export { createDOMEditorCapability, DOMEditor } from '../plugin/dom-editor'
export { installDOM } from '../plugin/with-dom'
export { EDITOR_TO_ROOT_VIEW_EDITORS } from '../utils/weak-maps'
