import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react'
import type { Editor } from 'slate'
import {
  createSlateAnnotationStore,
  type SlateAnnotation,
  type SlateAnnotationSnapshot,
  type SlateAnnotationStore,
  type SlateResolvedAnnotation,
} from '../annotation-store'

export function useSlateAnnotationStore<
  TData = unknown,
  TProjection extends Record<string, unknown> = Record<string, unknown>,
>(
  editor: Editor,
  annotations: readonly SlateAnnotation<TData, TProjection>[]
): SlateAnnotationStore<TData, TProjection> {
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
}) as SlateAnnotationSnapshot<any, any>

const getEmptyAnnotation = () => null

export function useSlateAnnotation<
  TData = unknown,
  TProjection extends Record<string, unknown> = Record<string, unknown>,
>(
  store: SlateAnnotationStore<TData, TProjection>,
  id: string
): SlateResolvedAnnotation<TData, TProjection> | null {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribeAnnotation(id, listener),
    [id, store]
  )
  const getSnapshot = useCallback(() => store.getAnnotation(id), [id, store])

  return useSyncExternalStore(subscribe, getSnapshot, getEmptyAnnotation)
}

export function useSlateAnnotations<
  TData = unknown,
  TProjection extends Record<string, unknown> = Record<string, unknown>,
>(
  store: SlateAnnotationStore<TData, TProjection>
): SlateAnnotationSnapshot<TData, TProjection> {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => EMPTY_SNAPSHOT as SlateAnnotationSnapshot<TData, TProjection>
  )
}
