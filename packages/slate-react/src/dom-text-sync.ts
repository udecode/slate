import type { SlateProjectionSlice } from './projection-store'

export type DOMTextSyncOptOutReason =
  | 'empty-text'
  | 'projection'
  | 'custom-leaf'
  | 'custom-segment'
  | 'custom-text'

export type DOMTextSyncCapability =
  | {
      enabled: true
      reason: null
    }
  | {
      enabled: false
      reason: DOMTextSyncOptOutReason
    }

export type DOMTextSyncOptions = {
  /**
   * Allows direct DOM text sync through a custom `renderLeaf` only when the
   * renderer's DOM shape and attributes do not depend on `leaf.text`.
   */
  renderLeaf?: 'text-invariant'
}

export const getDOMTextSyncCapability = ({
  hasText,
  projections,
  renderLeaf,
  renderSegment,
  renderText,
  textSync,
}: {
  hasText: boolean
  projections: readonly SlateProjectionSlice<unknown>[]
  renderLeaf?: unknown
  renderSegment?: unknown
  renderText?: unknown
  textSync?: DOMTextSyncOptions | null
}): DOMTextSyncCapability => {
  if (!hasText) {
    return { enabled: false, reason: 'empty-text' }
  }

  if (projections.length > 0) {
    return { enabled: false, reason: 'projection' }
  }

  if (renderLeaf && textSync?.renderLeaf !== 'text-invariant') {
    return { enabled: false, reason: 'custom-leaf' }
  }

  if (renderSegment) {
    return { enabled: false, reason: 'custom-segment' }
  }

  if (renderText) {
    return { enabled: false, reason: 'custom-text' }
  }

  return { enabled: true, reason: null }
}
