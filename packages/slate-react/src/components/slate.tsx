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
import { Editor } from '../editable/runtime-editor-api'
import { EditorContext } from '../hooks/use-editor'
import { FocusedContext } from '../hooks/use-editor-focused'
import {
  EditorSelectorContext,
  useEditorSelectorContext,
} from '../hooks/use-editor-selector'
import { useIsomorphicLayoutEffect } from '../hooks/use-isomorphic-layout-effect'
import { SlateAnnotationStoreContext } from '../hooks/use-slate-annotations'
import { syncTextOperationsToDOM } from '../hooks/use-slate-node-ref'
import { ReactEditor, type ReactRuntimeEditor } from '../plugin/react-editor'
import type {
  ReactEditorContextValue,
  ReactEditor as ReactEditorType,
} from '../plugin/with-react'
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

export type SlateProps<
  V extends Value = Value,
  TExtensions extends readonly unknown[] = readonly unknown[],
> = {
  editor: ReactEditorType<V, TExtensions>
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

export const Slate = <
  V extends Value = Value,
  const TExtensions extends readonly unknown[] = readonly unknown[],
>(
  props: SlateProps<V, TExtensions>
) => {
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

  const reactEditor = editor as unknown as ReactRuntimeEditor<V>
  const { selectorContext, onChange: handleSelectorChange } =
    useEditorSelectorContext()
  const onChangeRef = useRef(onChange)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const onValueChangeRef = useRef(onValueChange)
  const lastOperationCountRef = useRef(
    editor.read((state) => state.value.operations().length)
  )
  const lastCommitVersionRef = useRef(
    Editor.getLastCommit(editor)?.version ?? 0
  )
  const lastEditorRef = useRef(editor)

  onChangeRef.current = onChange
  onSelectionChangeRef.current = onSelectionChange
  onValueChangeRef.current = onValueChange

  if (lastEditorRef.current !== editor) {
    lastEditorRef.current = editor
    lastOperationCountRef.current = editor.read(
      (state) => state.value.operations().length
    )
    lastCommitVersionRef.current = Editor.getLastCommit(editor)?.version ?? 0
  }

  useIsomorphicLayoutEffect(() => {
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
      lastCommitVersionRef.current = commit
        ? commit.version
        : lastCommitVersionRef.current

      maybeBatchUpdates(() => {
        profileRuntimeDuration('focused-state', () => {
          setIsFocused(ReactEditor.isFocused(reactEditor))
        })
        const textSync = profileRuntimeDuration('dom-text-sync', () =>
          syncTextOperationsToDOM(reactEditor, nextOperations)
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

          onChangeRef.current?.(value, change)

          if (commit.childrenChanged) {
            onValueChangeRef.current?.(value, change)
          }

          if (commit.selectionChanged) {
            onSelectionChangeRef.current?.(snapshot.selection, change)
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

    const unsubscribe = editor.subscribe(onContextChange)
    const latestCommit = Editor.getLastCommit(editor)

    if (latestCommit && latestCommit.version > lastCommitVersionRef.current) {
      onContextChange(Editor.getSnapshot(editor), latestCommit)
    }

    return unsubscribe
  }, [editor, handleSelectorChange, reactEditor])

  const [isFocused, setIsFocused] = useState(ReactEditor.isFocused(reactEditor))
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
    setIsFocused(ReactEditor.isFocused(reactEditor))
  }, [reactEditor])

  useIsomorphicLayoutEffect(() => {
    const fn = () => {
      setIsFocused(ReactEditor.isFocused(reactEditor))
      queueMicrotask(() => {
        setIsFocused(ReactEditor.isFocused(reactEditor))
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
  }, [reactEditor])

  return (
    <EditorSelectorContext.Provider value={selectorContext}>
      <ProjectionContext.Provider value={projectionContextValue}>
        <SlateAnnotationStoreContext.Provider value={annotationStore}>
          <EditorContext.Provider
            value={editor as ReactEditorContextValue<any>}
          >
            <FocusedContext.Provider value={isFocused}>
              {children}
            </FocusedContext.Provider>
          </EditorContext.Provider>
        </SlateAnnotationStoreContext.Provider>
      </ProjectionContext.Provider>
    </EditorSelectorContext.Provider>
  )
}
