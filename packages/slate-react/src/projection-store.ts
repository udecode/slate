import {
  type DecoratedRange,
  type Descendant,
  Editor,
  type EditorSnapshot,
  type NodeEntry,
  type Path,
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

export type SlateDecorateCompatData = Record<string, unknown>

export type SlateDecorateCompat = (entry: NodeEntry) => DecoratedRange[]

export type SlateDecorateCompatSourceOptions = {
  editor?: Editor
}

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
  reason: 'annotation' | 'editor' | 'external' | 'refresh'
  snapshot: EditorSnapshot
  sourceId?: string
}

export type SlateCustomSourceDirtiness = (
  context: SlateSourceDirtinessContext
) => boolean

export type SlateSourceDirtiness =
  | SlateSourceDirtinessClass
  | readonly SlateSourceDirtinessClass[]
  | SlateCustomSourceDirtiness

export type SlateProjectionStoreOptions = {
  dirtiness?: SlateSourceDirtiness
  sourceId?: string
}

export type SlateProjectionStoreRefreshOptions = {
  change?: SnapshotChange
  forceInvalidate?: boolean
  reason?: SlateSourceDirtinessContext['reason']
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
  getSnapshot: () => SlateProjectionStoreSnapshot<T>
  refresh: (options?: SlateProjectionStoreRefreshOptions) => void
  subscribe: (listener: () => void) => () => void
}

const EMPTY_SNAPSHOT = Object.freeze(
  Object.create(null)
) as SlateProjectionStoreSnapshot<unknown>

const EMPTY_METRICS = Object.freeze({
  recomputeCount: 0,
}) as SlateProjectionStoreMetrics

const INVALID_PROJECTION_RANGE_ERROR =
  /Cannot project a range outside the committed snapshot|Point offset .* is outside text bounds/

const pathKey = (path: Path) => path.join('.')

const isElementLike = (
  value: Descendant
): value is Exclude<Descendant, { text: string }> =>
  'children' in value && Array.isArray(value.children)

const toDecorateCompatData = (
  decoration: DecoratedRange & Record<string, unknown>
): SlateDecorateCompatData => {
  const { anchor: _anchor, focus: _focus, merge: _merge, ...data } = decoration

  return data
}

export const createSlateDecorateCompatSource =
  (
    decorate: SlateDecorateCompat,
    options: SlateDecorateCompatSourceOptions = {}
  ): SlateProjectionSource<SlateDecorateCompatData> =>
  (snapshot) => {
    const projections: SlateProjection<SlateDecorateCompatData>[] = []
    const rootNode =
      options.editor ?? ({ children: snapshot.children } as Descendant)
    const children = options.editor
      ? Editor.getChildren(options.editor)
      : snapshot.children

    decorate([rootNode, []] as NodeEntry).forEach(
      (decoration, decorationIndex) => {
        projections.push({
          data: toDecorateCompatData(
            decoration as DecoratedRange & Record<string, unknown>
          ),
          key: `decorate::${decorationIndex}`,
          range: {
            anchor: decoration.anchor,
            focus: decoration.focus,
          },
        })
      }
    )

    const visit = (nodes: readonly Descendant[], parentPath: Path) => {
      nodes.forEach((node, index) => {
        const path = [...parentPath, index] as Path
        const decorations = decorate([node, path] as NodeEntry)

        decorations.forEach((decoration, decorationIndex) => {
          projections.push({
            data: toDecorateCompatData(
              decoration as DecoratedRange & Record<string, unknown>
            ),
            key: `decorate:${pathKey(path)}:${decorationIndex}`,
            range: {
              anchor: decoration.anchor,
              focus: decoration.focus,
            },
          })
        })

        if (isElementLike(node)) {
          visit(node.children, path)
        }
      })
    }

    visit(children, [])

    return projections
  }

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

const areSnapshotsEqual = (
  left: SlateProjectionStoreSnapshot,
  right: SlateProjectionStoreSnapshot
) => {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)

  if (leftKeys.length !== rightKeys.length) return false

  for (const runtimeId of leftKeys) {
    if (!right[runtimeId]) {
      return false
    }

    if (!areSlicesEqual(left[runtimeId] ?? [], right[runtimeId] ?? [])) {
      return false
    }
  }

  return true
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

    const nextSnapshot = buildProjectionSnapshot(
      editor,
      source(context.snapshot)
    )

    if (areSnapshotsEqual(snapshot, nextSnapshot)) {
      return
    }

    snapshot = nextSnapshot
    metrics = Object.freeze({
      recomputeCount: metrics.recomputeCount + 1,
    })
    listeners.forEach((listener) => {
      listener()
    })
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
      unsubscribe()
    },
    getMetrics() {
      return metrics
    },
    getSnapshot() {
      return snapshot
    },
    refresh(refreshOptions = {}) {
      recompute({
        change: refreshOptions.change,
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
  }
}
