import { useMemo, useState } from 'react'
import type { Editor } from 'slate'

import {
  createSlateAnnotationStore,
  type SlateAnnotation,
  type SlateAnnotationStore,
} from '../annotation-store'
import { useIsomorphicLayoutEffect } from './use-isomorphic-layout-effect'

export const useSlateAnnotationStore = <
  TData = unknown,
  TProjection extends Record<string, unknown> = Record<string, unknown>,
>(
  editor: Editor,
  annotations: readonly SlateAnnotation<TData, TProjection>[]
): SlateAnnotationStore<TData, TProjection> => {
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
