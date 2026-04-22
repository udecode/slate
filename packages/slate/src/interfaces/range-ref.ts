import { type Operation, Range } from '..'

/**
 * `RangeRef` objects keep a specific range in a document synced over time as new
 * operations are applied to the editor. You can access their `current` property
 * at any time for the up-to-date range value.
 */

export interface RangeRef {
  current: Range | null
  affinity: 'forward' | 'backward' | 'outward' | 'inward' | null
  unref(): Range | null
}

export interface RangeRefInterface {
  /**
   * Transform the range ref's current value by an operation.
   */
  transform: (ref: RangeRef, op: Operation) => void
}

// eslint-disable-next-line no-redeclare
export const RangeRef: RangeRefInterface = {
  transform(ref: RangeRef, op: Operation): void {
    const internalRef = ref as RangeRef & {
      __draftCurrent?: Range | null
      __visibility?: 'public' | 'internal'
    }
    const current = internalRef.__draftCurrent ?? ref.current
    const { affinity } = ref

    if (current == null) {
      return
    }

    const next = Range.transform(current, op, { affinity })

    if (internalRef.__visibility === 'public') {
      internalRef.__draftCurrent = next
    } else {
      ref.current = next
    }

    if (next == null) {
      ref.unref()
    }
  },
}
