import { useMemo, useState } from 'react'
import type { Editor } from 'slate'

import {
  createSlateAnnotationStore,
  type SlateAnnotation,
  type SlateAnnotationStore,
} from '../annotation-store'
import { useIsomorphicLayoutEffect } from './use-isomorphic-layout-effect'

export type SlateAnnotationStoreProjector<
  TData = unknown,
  TProjection extends Record<string, unknown> = Record<string, unknown>,
> = {
  deps: readonly unknown[]
  project: () => readonly SlateAnnotation<TData, TProjection>[]
}

const isSlateAnnotationStoreProjector = <
  TData,
  TProjection extends Record<string, unknown>,
>(
  value:
    | readonly SlateAnnotation<TData, TProjection>[]
    | SlateAnnotationStoreProjector<TData, TProjection>
): value is SlateAnnotationStoreProjector<TData, TProjection> =>
  !Array.isArray(value)

export function useSlateAnnotationStore<
  TData = unknown,
  TProjection extends Record<string, unknown> = Record<string, unknown>,
>(
  editor: Editor,
  annotationsOrOptions:
    | readonly SlateAnnotation<TData, TProjection>[]
    | SlateAnnotationStoreProjector<TData, TProjection>
): SlateAnnotationStore<TData, TProjection> {
  const annotationDeps = isSlateAnnotationStoreProjector(annotationsOrOptions)
    ? annotationsOrOptions.deps
    : [annotationsOrOptions]
  const annotations = useMemo(
    () =>
      isSlateAnnotationStoreProjector(annotationsOrOptions)
        ? annotationsOrOptions.project()
        : annotationsOrOptions,
    // `deps` intentionally owns projector closure freshness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    annotationDeps
  )
  const [annotationsCell] = useState(() => ({ current: annotations }))

  const store = useMemo(
    () => createSlateAnnotationStore(editor, () => annotationsCell.current),
    [annotationsCell, editor]
  )

  useIsomorphicLayoutEffect(() => {
    annotationsCell.current = annotations
    store.refresh()
  }, [annotations, annotationsCell, store])

  useIsomorphicLayoutEffect(() => {
    return () => {
      store.destroy()
    }
  }, [store])

  return store
}
