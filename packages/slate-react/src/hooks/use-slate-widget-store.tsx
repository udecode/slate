import { useRef } from 'react'
import type { Editor } from 'slate'

import type { SlateAnnotationStore } from '../annotation-store'
import {
  createSlateWidgetStore,
  type SlateWidget,
  type SlateWidgetStore,
} from '../widget-store'
import { useIsomorphicLayoutEffect } from './use-isomorphic-layout-effect'

export const useSlateWidgetStore = <
  T extends Record<string, unknown>,
  TAnnotation extends Record<string, unknown>,
>(
  editor: Editor,
  widgets: readonly SlateWidget<T>[],
  annotationStore?: SlateAnnotationStore<TAnnotation> | null
): SlateWidgetStore<T, TAnnotation> => {
  const widgetsRef = useRef(widgets)
  widgetsRef.current = widgets

  const storeRef = useRef<{
    annotationStore?: SlateAnnotationStore<TAnnotation> | null
    editor: Editor
    store: SlateWidgetStore<T, TAnnotation>
  } | null>(null)

  if (
    !storeRef.current ||
    storeRef.current.editor !== editor ||
    storeRef.current.annotationStore !== annotationStore
  ) {
    storeRef.current?.store.destroy()
    storeRef.current = {
      annotationStore,
      editor,
      store: createSlateWidgetStore(
        editor,
        () => widgetsRef.current,
        annotationStore
      ),
    }
  }

  useIsomorphicLayoutEffect(() => {
    storeRef.current?.store.refresh()
  }, [widgets])

  useIsomorphicLayoutEffect(() => {
    const entry = storeRef.current

    return () => {
      if (
        entry?.editor === editor &&
        entry.annotationStore === annotationStore
      ) {
        entry.store.destroy()

        if (storeRef.current === entry) {
          storeRef.current = null
        }
      }
    }
  }, [annotationStore, editor])

  return storeRef.current.store
}
