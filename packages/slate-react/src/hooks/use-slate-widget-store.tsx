import { useMemo, useState } from 'react'
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

  useIsomorphicLayoutEffect(() => {
    widgetsCell.current = widgets
    store.refresh()
  }, [store, widgets, widgetsCell])

  useIsomorphicLayoutEffect(() => {
    return () => {
      store.destroy()
    }
  }, [store])

  return store
}
