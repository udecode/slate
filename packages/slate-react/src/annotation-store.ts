import {
  type Bookmark,
  Editor,
  type Range,
  type RuntimeId,
  type Editor as SlateEditor,
} from 'slate'
import type {
  SlateProjectionEntry,
  SlateProjectionStore,
} from './hooks/use-slate-projections'

export interface SlateAnnotation<T = unknown> {
  bookmark: Bookmark
  data?: T
  id: string
}

export interface SlateResolvedAnnotation<T = unknown> {
  data?: T
  id: string
  range: Range | null
}

export interface SlateAnnotationSnapshot<T = unknown> {
  allIds: readonly string[]
  byId: ReadonlyMap<string, SlateResolvedAnnotation<T>>
}

export interface SlateAnnotationProjectionData extends Record<string, unknown> {
  annotationId: string
}

export interface SlateAnnotationStore<T = unknown> {
  destroy: () => void
  getSnapshot: () => SlateAnnotationSnapshot<T>
  projectionStore: SlateProjectionStore<SlateAnnotationProjectionData>
  refresh: () => void
  subscribe: (listener: () => void) => () => void
}

const EMPTY_ANNOTATION_IDS: readonly string[] = Object.freeze([])
const EMPTY_ANNOTATION_BY_ID = new Map<string, SlateResolvedAnnotation>()
const EMPTY_ANNOTATION_SNAPSHOT = Object.freeze({
  allIds: EMPTY_ANNOTATION_IDS,
  byId: EMPTY_ANNOTATION_BY_ID,
}) as SlateAnnotationSnapshot<any>
const EMPTY_PROJECTION_SNAPSHOT = Object.freeze({}) as Readonly<
  Record<string, readonly SlateProjectionEntry<SlateAnnotationProjectionData>[]>
>

const areRangesEqual = (left: Range | null, right: Range | null) => {
  if (left === right) return true
  if (!left || !right) return false

  return (
    left.anchor.offset === right.anchor.offset &&
    left.focus.offset === right.focus.offset &&
    left.anchor.path.length === right.anchor.path.length &&
    left.focus.path.length === right.focus.path.length &&
    left.anchor.path.every(
      (segment, index) => segment === right.anchor.path[index]
    ) &&
    left.focus.path.every(
      (segment, index) => segment === right.focus.path[index]
    )
  )
}

const areDataEqual = (left: unknown, right: unknown) =>
  JSON.stringify(left ?? null) === JSON.stringify(right ?? null)

const buildAnnotationSnapshot = <T>(
  annotations: readonly SlateAnnotation<T>[]
): SlateAnnotationSnapshot<T> => {
  if (annotations.length === 0) {
    return EMPTY_ANNOTATION_SNAPSHOT
  }

  const allIds = Object.freeze(annotations.map((annotation) => annotation.id))
  const byId = new Map<string, SlateResolvedAnnotation<T>>()

  annotations.forEach((annotation) => {
    byId.set(annotation.id, {
      data: annotation.data,
      id: annotation.id,
      range: annotation.bookmark.resolve(),
    })
  })

  return Object.freeze({
    allIds,
    byId,
  })
}

const buildProjectionSnapshot = <T>(
  editor: SlateEditor,
  annotationSnapshot: SlateAnnotationSnapshot<T>
): Readonly<
  Record<
    RuntimeId,
    readonly SlateProjectionEntry<SlateAnnotationProjectionData>[]
  >
> => {
  if (annotationSnapshot.allIds.length === 0) {
    return EMPTY_PROJECTION_SNAPSHOT
  }

  const projectionByRuntimeId: Record<
    string,
    readonly SlateProjectionEntry<SlateAnnotationProjectionData>[]
  > = Object.create(null)

  annotationSnapshot.allIds.forEach((annotationId) => {
    const annotation = annotationSnapshot.byId.get(annotationId)

    if (!annotation?.range) {
      return
    }

    const projected = Editor.projectRange(editor, annotation.range)

    projected.forEach((segment) => {
      const entries = [
        ...(projectionByRuntimeId[segment.runtimeId] ?? []),
        {
          data: {
            ...(annotation.data && typeof annotation.data === 'object'
              ? (annotation.data as Record<string, unknown>)
              : {}),
            annotationId,
          } as SlateAnnotationProjectionData,
          end: segment.end,
          key: annotationId,
          start: segment.start,
        },
      ] as const
      projectionByRuntimeId[segment.runtimeId] = entries
    })
  })

  Object.keys(projectionByRuntimeId).forEach((runtimeId) => {
    projectionByRuntimeId[runtimeId] = Object.freeze(
      projectionByRuntimeId[runtimeId]!
    )
  })

  return Object.freeze(projectionByRuntimeId)
}

const areAnnotationSnapshotsEqual = <T>(
  left: SlateAnnotationSnapshot<T>,
  right: SlateAnnotationSnapshot<T>
) => {
  if (left === right) return true
  if (left.allIds.length !== right.allIds.length) return false

  for (let index = 0; index < left.allIds.length; index += 1) {
    if (left.allIds[index] !== right.allIds[index]) {
      return false
    }

    const leftAnnotation = left.byId.get(left.allIds[index]!)
    const rightAnnotation = right.byId.get(right.allIds[index]!)

    if (!leftAnnotation || !rightAnnotation) {
      return false
    }

    if (
      leftAnnotation.id !== rightAnnotation.id ||
      !areRangesEqual(leftAnnotation.range, rightAnnotation.range) ||
      !areDataEqual(leftAnnotation.data, rightAnnotation.data)
    ) {
      return false
    }
  }

  return true
}

const areProjectionSnapshotsEqual = (
  left: Readonly<Record<string, readonly SlateProjectionEntry[]>>,
  right: Readonly<Record<string, readonly SlateProjectionEntry[]>>
) => {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)

  if (leftKeys.length !== rightKeys.length) return false

  for (const runtimeId of leftKeys) {
    if (!right[runtimeId]) {
      return false
    }

    const leftEntries = left[runtimeId]!
    const rightEntries = right[runtimeId]!

    if (leftEntries.length !== rightEntries.length) {
      return false
    }

    for (let index = 0; index < leftEntries.length; index += 1) {
      const leftEntry = leftEntries[index]!
      const rightEntry = rightEntries[index]!

      if (
        leftEntry.key !== rightEntry.key ||
        leftEntry.start !== rightEntry.start ||
        leftEntry.end !== rightEntry.end ||
        !areDataEqual(leftEntry.data, rightEntry.data)
      ) {
        return false
      }
    }
  }

  return true
}

export function createSlateAnnotationStore<T = unknown>(
  editor: SlateEditor,
  source: readonly SlateAnnotation<T>[] | (() => readonly SlateAnnotation<T>[])
): SlateAnnotationStore<T> {
  const getAnnotations = typeof source === 'function' ? source : () => source

  let annotationSnapshot = buildAnnotationSnapshot(getAnnotations())
  let projectionSnapshot = buildProjectionSnapshot(editor, annotationSnapshot)
  const listeners = new Set<() => void>()

  const notify = () => {
    listeners.forEach((listener) => {
      listener()
    })
  }

  const refresh = () => {
    const nextAnnotationSnapshot = buildAnnotationSnapshot(getAnnotations())
    const nextProjectionSnapshot = buildProjectionSnapshot(
      editor,
      nextAnnotationSnapshot
    )

    if (
      areAnnotationSnapshotsEqual(annotationSnapshot, nextAnnotationSnapshot) &&
      areProjectionSnapshotsEqual(projectionSnapshot, nextProjectionSnapshot)
    ) {
      return
    }

    annotationSnapshot = nextAnnotationSnapshot
    projectionSnapshot = nextProjectionSnapshot
    notify()
  }

  const unsubscribeEditor = editor.subscribe(() => {
    refresh()
  })

  return {
    destroy() {
      unsubscribeEditor()
      listeners.clear()
    },
    getSnapshot() {
      return annotationSnapshot
    },
    projectionStore: {
      getSnapshot() {
        return projectionSnapshot
      },
      subscribe(listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    refresh,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
