import {
  Editor,
  Point,
  type Range,
  type RuntimeId,
  type Editor as SlateEditor,
  type SnapshotChange,
} from 'slate'

import type {
  SlateAnnotationStore,
  SlateResolvedAnnotation,
} from './annotation-store'
import { isSlateSourceDirty } from './projection-store'

export type SlateWidgetAnchor =
  | {
      annotationId: string
      type: 'annotation'
    }
  | {
      type: 'node'
      runtimeId: RuntimeId
    }
  | {
      type: 'selection'
    }

export type SlateWidget<
  T extends Record<string, unknown> = Record<string, never>,
> = {
  anchor: SlateWidgetAnchor
  data?: T
  id: string
}

export type SlateResolvedWidget<
  T extends Record<string, unknown> = Record<string, never>,
  TAnnotation extends Record<string, unknown> = Record<string, never>,
> = SlateWidget<T> & {
  annotation: SlateResolvedAnnotation<TAnnotation> | null
  range: Range | null
  visible: boolean
}

export type SlateWidgetSnapshot<
  T extends Record<string, unknown> = Record<string, never>,
  TAnnotation extends Record<string, unknown> = Record<string, never>,
> = Readonly<{
  allIds: readonly string[]
  byId: ReadonlyMap<string, SlateResolvedWidget<T, TAnnotation>>
}>

export type SlateWidgetStore<
  T extends Record<string, unknown> = Record<string, never>,
  TAnnotation extends Record<string, unknown> = Record<string, never>,
> = {
  destroy: () => void
  getMetrics: () => SlateWidgetStoreMetrics
  getSnapshot: () => SlateWidgetSnapshot<T, TAnnotation>
  refresh: () => void
  subscribe: (listener: () => void) => () => void
}

export type SlateWidgetStoreMetrics = Readonly<{
  recomputeCount: number
}>

const EMPTY_WIDGET_SNAPSHOT = Object.freeze({
  allIds: Object.freeze([]),
  byId: new Map(),
}) as SlateWidgetSnapshot<Record<string, never>, Record<string, never>>

const sameRange = (left: Range | null, right: Range | null) => {
  if (!left && !right) {
    return true
  }

  if (!left || !right) {
    return false
  }

  return (
    Point.equals(left.anchor, right.anchor) &&
    Point.equals(left.focus, right.focus)
  )
}

const isVisibleSelection = (range: Range | null) =>
  !!range && !Point.equals(range.anchor, range.focus)

const shouldRecomputeForEditorChange = <T extends Record<string, unknown>>(
  widgets: readonly SlateWidget<T>[],
  change: SnapshotChange | undefined,
  editor: SlateEditor
) => {
  if (!change) {
    return true
  }

  const snapshot = Editor.getSnapshot(editor)

  return widgets.some((widget) => {
    switch (widget.anchor.type) {
      case 'selection':
        return isSlateSourceDirty('selection', {
          change,
          reason: 'editor',
          snapshot,
        })
      case 'node':
        return isSlateSourceDirty('node', {
          change,
          reason: 'editor',
          snapshot,
        })
      case 'annotation':
        return false
    }

    return false
  })
}

const buildWidgetSnapshot = <
  T extends Record<string, unknown>,
  TAnnotation extends Record<string, unknown>,
>(
  previous: SlateWidgetSnapshot<T, TAnnotation>,
  widgets: readonly SlateWidget<T>[],
  editor: SlateEditor,
  annotationStore?: SlateAnnotationStore<TAnnotation> | null
) => {
  const editorSnapshot = Editor.getSnapshot(editor)
  const annotationSnapshot = annotationStore?.getSnapshot() ?? null
  const allIds = widgets.map((widget) => widget.id)
  const byId = new Map<string, SlateResolvedWidget<T, TAnnotation>>()

  widgets.forEach((widget) => {
    let annotation: SlateResolvedAnnotation<TAnnotation> | null = null
    let range: Range | null = null
    let visible = false

    switch (widget.anchor.type) {
      case 'annotation': {
        annotation =
          annotationSnapshot?.byId.get(widget.anchor.annotationId) ?? null
        range = annotation?.range ?? null
        visible = !!range
        break
      }

      case 'node': {
        visible = Boolean(
          editorSnapshot.index.idToPath[widget.anchor.runtimeId]
        )
        break
      }

      case 'selection': {
        range = editorSnapshot.selection
        visible = isVisibleSelection(range)
        break
      }
    }

    byId.set(widget.id, {
      ...widget,
      annotation,
      range,
      visible,
    })
  })

  if (
    previous.allIds.length === allIds.length &&
    previous.allIds.every((id, index) => id === allIds[index]) &&
    allIds.every((id: string) => {
      const next = byId.get(id)
      const current = previous.byId.get(id)

      return (
        next &&
        current &&
        next.anchor === current.anchor &&
        Object.is(next.data, current.data) &&
        next.annotation === current.annotation &&
        sameRange(next.range, current.range) &&
        next.visible === current.visible
      )
    })
  ) {
    return previous
  }

  return Object.freeze({
    allIds: Object.freeze(allIds),
    byId,
  }) as SlateWidgetSnapshot<T, TAnnotation>
}

export const createSlateWidgetStore = <
  T extends Record<string, unknown>,
  TAnnotation extends Record<string, unknown>,
>(
  editor: SlateEditor,
  getWidgets: () => readonly SlateWidget<T>[],
  annotationStore?: SlateAnnotationStore<TAnnotation> | null
): SlateWidgetStore<T, TAnnotation> => {
  const listeners = new Set<() => void>()
  let destroyed = false
  let metrics = Object.freeze({
    recomputeCount: 0,
  }) as SlateWidgetStoreMetrics
  let snapshot = EMPTY_WIDGET_SNAPSHOT as unknown as SlateWidgetSnapshot<
    T,
    TAnnotation
  >

  const recomputeSnapshot = () => {
    const widgets = getWidgets()
    const nextSnapshot = buildWidgetSnapshot(
      snapshot,
      widgets,
      editor,
      annotationStore
    )

    if (nextSnapshot === snapshot) {
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

  const unsubscribeEditor = editor.subscribe((snapshotValue, change) => {
    if (destroyed) {
      return
    }

    const widgets = getWidgets()

    if (!shouldRecomputeForEditorChange(widgets, change, editor)) {
      return
    }

    const nextSnapshot = buildWidgetSnapshot(
      snapshot,
      widgets,
      editor,
      annotationStore
    )

    if (nextSnapshot === snapshot) {
      return
    }

    snapshot = nextSnapshot
    metrics = Object.freeze({
      recomputeCount: metrics.recomputeCount + 1,
    })
    listeners.forEach((listener) => {
      listener()
    })
  })

  const unsubscribeAnnotation = annotationStore?.subscribe(() => {
    if (destroyed) {
      return
    }

    recomputeSnapshot()
  })

  recomputeSnapshot()

  return {
    destroy() {
      if (destroyed) {
        return
      }

      destroyed = true
      unsubscribeEditor()
      unsubscribeAnnotation?.()
      listeners.clear()
    },
    getMetrics() {
      return metrics
    },
    getSnapshot() {
      return snapshot
    },
    refresh() {
      if (destroyed) {
        return
      }

      recomputeSnapshot()
    },
    subscribe(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
  }
}
