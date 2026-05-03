import { useRef } from 'react'
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
  const annotationsRef = useRef(annotations)
  annotationsRef.current = annotations

  const storeRef = useRef<{
    editor: Editor
    store: SlateAnnotationStore<TData, TProjection>
  } | null>(null)

  if (!storeRef.current || storeRef.current.editor !== editor) {
    storeRef.current?.store.destroy()
    storeRef.current = {
      editor,
      store: createSlateAnnotationStore(editor, () => annotationsRef.current),
    }
  }

  useIsomorphicLayoutEffect(() => {
    storeRef.current?.store.refresh()
  }, [annotations])

  useIsomorphicLayoutEffect(() => {
    const entry = storeRef.current

    return () => {
      if (entry?.editor === editor) {
        entry.store.destroy()

        if (storeRef.current === entry) {
          storeRef.current = null
        }
      }
    }
  }, [editor])

  return storeRef.current.store
}
