import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import type { Editor } from 'slate'
import type { SlateAnnotationStore } from '../annotation-store'
import {
  createSlateWidgetStore,
  type SlateResolvedWidget,
  type SlateWidget,
  type SlateWidgetSnapshot,
  type SlateWidgetStore,
} from '../widget-store'

export function useSlateWidgetStore<
  T extends Record<string, unknown>,
  TAnnotation extends Record<string, unknown>,
>(
  editor: Editor,
  widgets: readonly SlateWidget<T>[],
  annotationStore?: SlateAnnotationStore<TAnnotation> | null
): SlateWidgetStore<T, TAnnotation> {
  const [widgetsCell] = useState(() => ({ current: widgets }))

  const store = useMemo(
    () =>
      createSlateWidgetStore(
        editor,
        () => widgetsCell.current,
        annotationStore
      ),
    [annotationStore, editor, widgetsCell]
  )

  useEffect(() => {
    widgetsCell.current = widgets
    store.refresh()
  }, [store, widgets, widgetsCell])

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
}) as SlateWidgetSnapshot<Record<string, never>, Record<string, never>>

const getEmptyWidget = () => null

export function useSlateWidget<
  T extends Record<string, unknown>,
  TAnnotation extends Record<string, unknown>,
>(
  store: SlateWidgetStore<T, TAnnotation>,
  id: string
): SlateResolvedWidget<T, TAnnotation> | null {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribeWidget(id, listener),
    [id, store]
  )
  const getSnapshot = useCallback(() => store.getWidget(id), [id, store])

  return useSyncExternalStore(subscribe, getSnapshot, getEmptyWidget)
}

export function useSlateWidgets<
  T extends Record<string, unknown>,
  TAnnotation extends Record<string, unknown>,
>(
  store: SlateWidgetStore<T, TAnnotation>
): SlateWidgetSnapshot<T, TAnnotation> {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => EMPTY_SNAPSHOT as unknown as SlateWidgetSnapshot<T, TAnnotation>
  )
}
