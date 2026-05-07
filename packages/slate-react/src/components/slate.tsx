import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import {
  type EditorCommit,
  type EditorSnapshot,
  isEditor,
  type Operation,
  type Value,
} from 'slate'
import type { SlateAnnotationStore } from '../annotation-store'
import {
  composeDecorationSources,
  composeProjectionSources,
  type SlateDecorationSource,
} from '../decoration-source'
import { EditorContext } from '../hooks/use-editor'
import { FocusedContext } from '../hooks/use-editor-focused'
import {
  EditorSelectorContext,
  useEditorSelectorContext,
} from '../hooks/use-editor-selector'
import { useIsomorphicLayoutEffect } from '../hooks/use-isomorphic-layout-effect'
import { SlateAnnotationStoreContext } from '../hooks/use-slate-annotations'
import { syncTextOperationsToDOM } from '../hooks/use-slate-node-ref'
import { ReactEditor } from '../plugin/react-editor'
import { ProjectionContext } from '../projection-context'
import { recordSlateReactRender } from '../render-profiler'
import { REACT_MAJOR_VERSION } from '../utils/environment'

const now = () => globalThis.performance?.now?.() ?? Date.now()

const profileRuntimeDuration = <T,>(id: string, callback: () => T): T => {
  if (!globalThis.__SLATE_REACT_RENDER_PROFILER__) {
    return callback()
  }

  const start = now()

  try {
    return callback()
  } finally {
    recordSlateReactRender({
      duration: now() - start,
      id,
      kind: 'runtime-time',
    })
  }
}

export type SlateChange<V extends Value = Value> = {
  commit: EditorCommit<V>
  marksChanged: boolean
  operations: EditorCommit<V>['operations']
  selection: EditorSnapshot<V>['selection']
  selectionChanged: boolean
  snapshot: EditorSnapshot<V>
  tags: EditorCommit<V>['tags']
  value: V
  valueChanged: boolean
}

export type SlateProps<V extends Value = Value> = {
  editor: ReactEditor<V>
  annotationStore?: SlateAnnotationStore<any, any> | null
  children: React.ReactNode
  decorationSources?: readonly SlateDecorationSource<any>[] | null
  onChange?: (value: V, change: SlateChange<V>) => void
  onSelectionChange?: (
    selection: EditorSnapshot<V>['selection'],
    change: SlateChange<V>
  ) => void
  onValueChange?: (value: V, change: SlateChange<V>) => void
}

/**
 * A wrapper around the provider to publish committed editor snapshots, because
 * the editor is a mutable singleton.
 */

export const Slate = <V extends Value = Value>(props: SlateProps<V>) => {
  const {
    annotationStore = null,
    decorationSources = null,
    editor,
    children,
    onChange,
    onSelectionChange,
    onValueChange,
  } = props

  if (!isEditor(editor)) {
    throw new Error('[Slate] editor is invalid!')
  }

  const { selectorContext, onChange: handleSelectorChange } =
    useEditorSelectorContext()
  const lastOperationCountRef = useRef(
    editor.read((state) => state.value.operations().length)
  )

  useEffect(() => {
    const maybeBatchUpdates =
      REACT_MAJOR_VERSION < 18
        ? ReactDOM.unstable_batchedUpdates
        : (callback: () => void) => callback()

    const onContextChange: Parameters<typeof editor.subscribe>[0] = (
      snapshot,
      commit
    ) => {
      let currentOperations: readonly Operation[] = []
      const nextOperations = commit
        ? [...commit.operations]
        : editor.read((state) => {
            currentOperations = state.value.operations()
            return currentOperations.slice(lastOperationCountRef.current)
          })
      lastOperationCountRef.current = commit
        ? editor.read((state) => state.value.operations().length)
        : currentOperations.length

      maybeBatchUpdates(() => {
        profileRuntimeDuration('focused-state', () => {
          setIsFocused(ReactEditor.isFocused(editor))
        })
        const textSync = profileRuntimeDuration('dom-text-sync', () =>
          syncTextOperationsToDOM(editor, nextOperations)
        )
        const hasUnsyncedTextOperation =
          textSync.textOperationCount > textSync.syncedTextOperationCount

        profileRuntimeDuration('change-callbacks', () => {
          if (!commit) {
            return
          }

          const value = snapshot.children as V
          const change: SlateChange<V> = {
            commit: commit as EditorCommit<V>,
            marksChanged: commit.marksChanged,
            operations: commit.operations as EditorCommit<V>['operations'],
            selection: snapshot.selection,
            selectionChanged: commit.selectionChanged,
            snapshot: snapshot as EditorSnapshot<V>,
            tags: commit.tags,
            value,
            valueChanged: commit.childrenChanged,
          }

          onChange?.(value, change)

          if (commit.childrenChanged) {
            onValueChange?.(value, change)
          }

          if (commit.selectionChanged) {
            onSelectionChange?.(snapshot.selection, change)
          }
        })

        profileRuntimeDuration('selector-dispatch', () =>
          handleSelectorChange(
            hasUnsyncedTextOperation ? undefined : nextOperations,
            commit
          )
        )
      })
    }

    return editor.subscribe(onContextChange)
  }, [editor, handleSelectorChange, onChange, onSelectionChange, onValueChange])

  const [isFocused, setIsFocused] = useState(ReactEditor.isFocused(editor))
  const projectionContextValue = useMemo(() => {
    if (!annotationStore) {
      return composeDecorationSources(decorationSources)
    }

    return composeProjectionSources([
      ...(decorationSources ?? []),
      annotationStore.projectionStore,
    ])
  }, [annotationStore, decorationSources])

  useEffect(() => {
    setIsFocused(ReactEditor.isFocused(editor))
  }, [editor])

  useIsomorphicLayoutEffect(() => {
    const fn = () => {
      setIsFocused(ReactEditor.isFocused(editor))
      queueMicrotask(() => {
        setIsFocused(ReactEditor.isFocused(editor))
      })
    }
    if (REACT_MAJOR_VERSION >= 17) {
      // In React >= 17 onFocus and onBlur listen to the focusin and focusout events during the bubbling phase.
      // Therefore in order for <Editable />'s handlers to run first, which is necessary for ReactEditor.isFocused(editor)
      // to return the correct value, we have to listen to the focusin and focusout events without useCapture here.
      document.addEventListener('focusin', fn)
      document.addEventListener('focusout', fn)
      return () => {
        document.removeEventListener('focusin', fn)
        document.removeEventListener('focusout', fn)
      }
    }
    document.addEventListener('focus', fn, true)
    document.addEventListener('blur', fn, true)
    return () => {
      document.removeEventListener('focus', fn, true)
      document.removeEventListener('blur', fn, true)
    }
  }, [editor])

  return (
    <EditorSelectorContext.Provider value={selectorContext}>
      <ProjectionContext.Provider value={projectionContextValue}>
        <SlateAnnotationStoreContext.Provider value={annotationStore}>
          <EditorContext.Provider value={editor}>
            <FocusedContext.Provider value={isFocused}>
              {children}
            </FocusedContext.Provider>
          </EditorContext.Provider>
        </SlateAnnotationStoreContext.Provider>
      </ProjectionContext.Provider>
    </EditorSelectorContext.Provider>
  )
}
