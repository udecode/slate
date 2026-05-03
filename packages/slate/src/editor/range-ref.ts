import type { EditorStaticApi } from '../interfaces/editor'
import type { Range } from '../interfaces/range'
import type { RangeRef } from '../interfaces/range-ref'
import { ALL_RANGE_REFS, RANGE_REFS } from '../utils/weak-maps'

type InternalRangeRef = RangeRef & {
  __draftCurrent?: Range | null
  __visibility?: 'public' | 'internal'
}

const cloneRange = (range: Range | null) =>
  range
    ? {
        anchor: {
          path: [...range.anchor.path],
          offset: range.anchor.offset,
        },
        focus: {
          path: [...range.focus.path],
          offset: range.focus.offset,
        },
      }
    : null

const getAllRangeRefs = (
  editor: Parameters<EditorStaticApi['rangeRef']>[0]
) => {
  let refs = ALL_RANGE_REFS.get(editor)

  if (!refs) {
    refs = new Set()
    ALL_RANGE_REFS.set(editor, refs)
  }

  return refs
}

const getPublicRangeRefs = (
  editor: Parameters<EditorStaticApi['rangeRef']>[0]
) => {
  let refs = RANGE_REFS.get(editor)

  if (!refs) {
    refs = new Set()
    RANGE_REFS.set(editor, refs)
  }

  return refs
}

const createRangeRef = (
  editor: Parameters<EditorStaticApi['rangeRef']>[0],
  range: Range,
  options: {
    affinity?: RangeRef['affinity']
    visibility?: 'public' | 'internal'
  } = {}
) => {
  const { affinity = 'inward', visibility = 'public' } = options
  const ref: InternalRangeRef = {
    current: cloneRange(range),
    affinity,
    unref() {
      const current = cloneRange(ref.__draftCurrent ?? ref.current)

      getAllRangeRefs(editor).delete(ref)

      if (ref.__visibility === 'public') {
        getPublicRangeRefs(editor).delete(ref)
      }

      ref.__draftCurrent = null
      ref.current = null

      return current
    },
  }

  ref.__visibility = visibility

  getAllRangeRefs(editor).add(ref)

  if (visibility === 'public') {
    getPublicRangeRefs(editor).add(ref)
  }

  return ref
}

export const createInternalRangeRef = (
  editor: Parameters<EditorStaticApi['rangeRef']>[0],
  range: Range,
  options: { affinity?: RangeRef['affinity'] } = {}
) => createRangeRef(editor, range, { ...options, visibility: 'internal' })

export const rangeRef: EditorStaticApi['rangeRef'] = (
  editor,
  range,
  options = {}
) => createRangeRef(editor, range, { ...options, visibility: 'public' })

export const allRangeRefs = (
  editor: Parameters<EditorStaticApi['rangeRef']>[0]
) => getAllRangeRefs(editor)

export const publishRangeRefDrafts = (
  editor: Parameters<EditorStaticApi['rangeRef']>[0]
) => {
  for (const ref of getAllRangeRefs(editor)) {
    const internalRef = ref as InternalRangeRef

    if (internalRef.__visibility !== 'public') {
      continue
    }

    if (internalRef.__draftCurrent !== undefined) {
      internalRef.current = cloneRange(internalRef.__draftCurrent)
      internalRef.__draftCurrent = undefined
    }

    if (internalRef.current == null) {
      getAllRangeRefs(editor).delete(internalRef)
      getPublicRangeRefs(editor).delete(internalRef)
    }
  }
}

export const resetRangeRefDrafts = (
  editor: Parameters<EditorStaticApi['rangeRef']>[0]
) => {
  for (const ref of getAllRangeRefs(editor)) {
    const internalRef = ref as InternalRangeRef

    if (internalRef.__visibility !== 'public') {
      continue
    }

    internalRef.__draftCurrent = undefined
  }
}
