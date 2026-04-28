import {
  Editor,
  type EditorSnapshot,
  type Range,
  type RuntimeId,
  type SnapshotChange,
} from 'slate'

export type SlateRangeProjection<T = unknown> = {
  data?: T
  key: string
  range: Range
}

export type SlateProjection<T = unknown> = SlateRangeProjection<T>

export type SlateProjectionSlice<T = unknown> = {
  data?: T
  end: number
  key: string
  start: number
}

export type SlateProjectionEntry<T = unknown> = SlateProjectionSlice<T>

export type SlateProjectionSource<T = unknown> = (
  snapshot: EditorSnapshot
) => readonly SlateProjection<T>[]

export type SlateSourceDirtinessClass =
  | 'always'
  | 'selection'
  | 'text'
  | 'mark'
  | 'node'
  | 'annotation'
  | 'external'

export type SlateSourceDirtinessContext = {
  change?: SnapshotChange
  forceInvalidate?: boolean
  reason: 'annotation' | 'editor' | 'external' | 'refresh'
  snapshot: EditorSnapshot
  sourceId?: string
}

export type SlateCustomSourceDirtiness = (
  context: SlateSourceDirtinessContext
) => boolean

export type SlateProjectionRuntimeScope =
  | readonly RuntimeId[]
  | ((context: SlateSourceDirtinessContext) => readonly RuntimeId[] | null)

export type SlateSourceDirtiness =
  | SlateSourceDirtinessClass
  | readonly SlateSourceDirtinessClass[]
  | SlateCustomSourceDirtiness

export type SlateProjectionStoreOptions = {
  dirtiness?: SlateSourceDirtiness
  runtimeScope?: SlateProjectionRuntimeScope
  sourceId?: string
}

export type SlateProjectionStoreRefreshOptions = {
  change?: SnapshotChange
  forceInvalidate?: boolean
  reason?: SlateSourceDirtinessContext['reason']
  sourceId?: string
}

export type SlateProjectionStoreSnapshot<T = unknown> = Readonly<
  Record<RuntimeId, readonly SlateProjectionSlice<T>[]>
>

export type SlateProjectionStoreMetrics = Readonly<{
  recomputeCount: number
}>

export type SlateProjectionStore<T = unknown> = {
  destroy: () => void
  getMetrics: () => SlateProjectionStoreMetrics
  getRuntimeSnapshot: (
    runtimeId: RuntimeId
  ) => readonly SlateProjectionSlice<T>[]
  getSnapshot: () => SlateProjectionStoreSnapshot<T>
  refresh: (options?: SlateProjectionStoreRefreshOptions) => void
  subscribe: (listener: () => void) => () => void
  subscribeRuntimeId: (runtimeId: RuntimeId, listener: () => void) => () => void
  subscribeSourceId: (sourceId: string, listener: () => void) => () => void
}

const EMPTY_SNAPSHOT = Object.freeze(
  Object.create(null)
) as SlateProjectionStoreSnapshot<unknown>

const EMPTY_METRICS = Object.freeze({
  recomputeCount: 0,
}) as SlateProjectionStoreMetrics

const EMPTY_RUNTIME_SNAPSHOT = Object.freeze(
  []
) as readonly SlateProjectionSlice<unknown>[]

const INVALID_PROJECTION_RANGE_ERROR =
  /Cannot project a range outside the committed snapshot|Point offset .* is outside text bounds/

const isSlateSourceDirtinessList = (
  value: SlateSourceDirtiness
): value is readonly SlateSourceDirtinessClass[] => Array.isArray(value)

const areDataEqual = (left: unknown, right: unknown) =>
  JSON.stringify(left ?? null) === JSON.stringify(right ?? null)

const areSlicesEqual = <T>(
  left: readonly SlateProjectionSlice<T>[],
  right: readonly SlateProjectionSlice<T>[]
) =>
  left.length === right.length &&
  left.every((slice, index) => {
    const other = right[index]

    return Boolean(
      other &&
        slice.key === other.key &&
        slice.start === other.start &&
        slice.end === other.end &&
        areDataEqual(slice.data, other.data)
    )
  })

const getChangedRuntimeIds = (
  left: SlateProjectionStoreSnapshot,
  right: SlateProjectionStoreSnapshot
) => {
  const runtimeIds = new Set([...Object.keys(left), ...Object.keys(right)])
  const changedRuntimeIds: RuntimeId[] = []

  for (const runtimeId of runtimeIds) {
    if (!areSlicesEqual(left[runtimeId] ?? [], right[runtimeId] ?? [])) {
      changedRuntimeIds.push(runtimeId)
    }
  }

  return changedRuntimeIds
}

const matchesDirtinessClass = (
  dirtiness: SlateSourceDirtinessClass,
  context: SlateSourceDirtinessContext
) => {
  if (dirtiness === 'always') return true
  if (!context.change) return true

  switch (dirtiness) {
    case 'selection':
      return context.change.selectionChanged
    case 'text':
      return context.change.classes.includes('text')
    case 'mark':
      return context.change.classes.includes('mark')
    case 'node':
      return context.change.childrenChanged
    case 'annotation':
      return context.reason === 'annotation'
    case 'external':
      return context.reason === 'external' || context.reason === 'refresh'
    default:
      return true
  }
}

export const isSlateSourceDirty = (
  dirtiness: SlateSourceDirtiness | undefined,
  context: SlateSourceDirtinessContext
) => {
  if (!dirtiness) return true
  if (typeof dirtiness === 'function') {
    return dirtiness(context)
  }
  if (isSlateSourceDirtinessList(dirtiness)) {
    return dirtiness.some((entry) => matchesDirtinessClass(entry, context))
  }
  return matchesDirtinessClass(dirtiness, context)
}

const getRuntimeScope = (
  runtimeScope: SlateProjectionRuntimeScope | undefined,
  context: SlateSourceDirtinessContext
) => {
  if (!runtimeScope) {
    return null
  }

  return typeof runtimeScope === 'function'
    ? runtimeScope(context)
    : runtimeScope
}

const isRuntimeScopeDirty = (
  runtimeScope: SlateProjectionRuntimeScope | undefined,
  context: SlateSourceDirtinessContext
) => {
  const decorationImpactRuntimeIds = context.change?.decorationImpactRuntimeIds

  if (!decorationImpactRuntimeIds) {
    return true
  }

  const scopedRuntimeIds = getRuntimeScope(runtimeScope, context)

  if (!scopedRuntimeIds) {
    return true
  }

  const impactedRuntimeIds = new Set(decorationImpactRuntimeIds)

  return scopedRuntimeIds.some((runtimeId) => impactedRuntimeIds.has(runtimeId))
}

const buildProjectionSnapshot = <T>(
  editor: Editor,
  projections: readonly SlateProjection<T>[]
): SlateProjectionStoreSnapshot<T> => {
  if (projections.length === 0) {
    return EMPTY_SNAPSHOT as SlateProjectionStoreSnapshot<T>
  }

  const projectionByRuntimeId: Record<string, SlateProjectionSlice<T>[]> =
    Object.create(null)

  projections.forEach((projection) => {
    try {
      const segments = Editor.projectRange(editor, projection.range)

      segments.forEach((segment) => {
        const entries = projectionByRuntimeId[segment.runtimeId] ?? []
        entries.push({
          data: projection.data,
          end: segment.end,
          key: projection.key,
          start: segment.start,
        })
        projectionByRuntimeId[segment.runtimeId] = entries
      })
    } catch (error) {
      if (
        error instanceof Error &&
        INVALID_PROJECTION_RANGE_ERROR.test(error.message)
      ) {
        return
      }

      throw error
    }
  })

  Object.keys(projectionByRuntimeId).forEach((runtimeId) => {
    projectionByRuntimeId[runtimeId] = Object.freeze(
      projectionByRuntimeId[runtimeId]!
    ) as SlateProjectionSlice<T>[]
  })

  return Object.freeze(projectionByRuntimeId) as SlateProjectionStoreSnapshot<T>
}

export const createSlateProjectionStore = <T>(
  editor: Editor,
  source: SlateProjectionSource<T>,
  options: SlateProjectionStoreOptions = {}
): SlateProjectionStore<T> => {
  const listeners = new Set<() => void>()
  const runtimeListeners = new Map<RuntimeId, Set<() => void>>()
  const sourceListeners = new Map<string, Set<() => void>>()
  let destroyed = false
  let metrics = EMPTY_METRICS
  let snapshot = buildProjectionSnapshot(
    editor,
    source(Editor.getSnapshot(editor))
  )

  const recompute = (context: SlateSourceDirtinessContext) => {
    if (!isSlateSourceDirty(options.dirtiness, context)) {
      return
    }

    if (
      !context.forceInvalidate &&
      !isRuntimeScopeDirty(options.runtimeScope, context)
    ) {
      return
    }

    const nextSnapshot = buildProjectionSnapshot(
      editor,
      source(context.snapshot)
    )

    const changedRuntimeIds = context.forceInvalidate
      ? Array.from(
          new Set([
            ...Object.keys(snapshot),
            ...Object.keys(nextSnapshot),
            ...runtimeListeners.keys(),
          ])
        )
      : getChangedRuntimeIds(snapshot, nextSnapshot)

    if (changedRuntimeIds.length === 0) {
      return
    }

    snapshot = nextSnapshot
    metrics = Object.freeze({
      recomputeCount: metrics.recomputeCount + 1,
    })
    listeners.forEach((listener) => {
      listener()
    })
    changedRuntimeIds.forEach((runtimeId) => {
      runtimeListeners.get(runtimeId)?.forEach((listener) => {
        listener()
      })
    })
    if (options.sourceId) {
      sourceListeners.get(options.sourceId)?.forEach((listener) => {
        listener()
      })
    }
  }

  const unsubscribe = editor.subscribe(
    (nextSnapshot: EditorSnapshot, change?: SnapshotChange) => {
      recompute({
        change,
        reason: 'editor',
        snapshot: nextSnapshot,
        sourceId: options.sourceId,
      })
    }
  )

  return {
    destroy() {
      if (destroyed) return
      destroyed = true
      listeners.clear()
      runtimeListeners.clear()
      sourceListeners.clear()
      unsubscribe()
    },
    getMetrics() {
      return metrics
    },
    getRuntimeSnapshot(runtimeId) {
      return (
        (snapshot[runtimeId] as
          | readonly SlateProjectionSlice<T>[]
          | undefined) ??
        (EMPTY_RUNTIME_SNAPSHOT as readonly SlateProjectionSlice<T>[])
      )
    },
    getSnapshot() {
      return snapshot
    },
    refresh(refreshOptions = {}) {
      if (
        refreshOptions.sourceId &&
        refreshOptions.sourceId !== options.sourceId
      ) {
        return
      }

      recompute({
        change: refreshOptions.change,
        forceInvalidate: refreshOptions.forceInvalidate,
        reason: refreshOptions.reason ?? 'refresh',
        snapshot: Editor.getSnapshot(editor),
        sourceId: options.sourceId,
      })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    subscribeRuntimeId(runtimeId, listener) {
      const listenersForRuntimeId = runtimeListeners.get(runtimeId) ?? new Set()
      listenersForRuntimeId.add(listener)
      runtimeListeners.set(runtimeId, listenersForRuntimeId)

      return () => {
        listenersForRuntimeId.delete(listener)
        if (listenersForRuntimeId.size === 0) {
          runtimeListeners.delete(runtimeId)
        }
      }
    },
    subscribeSourceId(sourceId, listener) {
      const listenersForSourceId = sourceListeners.get(sourceId) ?? new Set()
      listenersForSourceId.add(listener)
      sourceListeners.set(sourceId, listenersForSourceId)

      return () => {
        listenersForSourceId.delete(listener)
        if (listenersForSourceId.size === 0) {
          sourceListeners.delete(sourceId)
        }
      }
    },
  }
}
