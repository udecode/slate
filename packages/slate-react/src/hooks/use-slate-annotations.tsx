import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { Editor } from 'slate'
import {
  createSlateAnnotationStore,
  type SlateAnnotation,
  type SlateAnnotationSnapshot,
  type SlateAnnotationStore,
} from '../annotation-store'

export function useSlateAnnotationStore<T = unknown>(
  editor: Editor,
  annotations: readonly SlateAnnotation<T>[]
): SlateAnnotationStore<T> {
  const annotationsRef = useRef(annotations)
  annotationsRef.current = annotations

  const store = useMemo(
    () => createSlateAnnotationStore(editor, () => annotationsRef.current),
    [editor]
  )

  useEffect(() => {
    store.refresh()
  }, [annotations, store])

  useEffect(() => {
    return () => {
      store.destroy()
    }
  }, [store])

  return store
}

const EMPTY_SNAPSHOT = Object.freeze({
  allIds: Object.freeze([]),
  byId: new Map(),
}) as SlateAnnotationSnapshot<any>

export function useSlateAnnotations<T = unknown>(
  store: SlateAnnotationStore<T>
): SlateAnnotationSnapshot<T> {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => EMPTY_SNAPSHOT
  )
}
