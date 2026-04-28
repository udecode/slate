import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import {
  Editor,
  type EditorCommit,
  type EditorSnapshot,
  Node,
  type Selection,
  type Value,
} from 'slate'
import { FocusedContext } from '../hooks/use-focused'
import { useIsomorphicLayoutEffect } from '../hooks/use-isomorphic-layout-effect'
import { syncTextOperationsToDOM } from '../hooks/use-slate-node-ref'
import type { SlateProjectionStore } from '../hooks/use-slate-projections'
import {
  SlateSelectorContext,
  useSelectorContext,
} from '../hooks/use-slate-selector'
import { EditorContext } from '../hooks/use-slate-static'
import { ReactEditor } from '../plugin/react-editor'
import { ProjectionContext } from '../projection-context'
import { REACT_MAJOR_VERSION } from '../utils/environment'

const INITIALIZED_EDITORS = new WeakSet<Editor>()

/**
 * A wrapper around the provider to publish committed editor snapshots, because
 * the editor is a mutable singleton.
 */

export const Slate = (props: {
  editor: ReactEditor
  initialValue?: Value
  children: React.ReactNode
  onSelectionChange?: (selection: Selection) => void
  onSnapshotChange?: (
    snapshot: EditorSnapshot,
    commit: EditorCommit | null
  ) => void
  projectionStore?: SlateProjectionStore<any> | null
  onValueChange?: (value: Value) => void
}) => {
  const {
    editor,
    children,
    onSelectionChange,
    onSnapshotChange,
    onValueChange,
    projectionStore = null,
    initialValue,
  } = props

  if (!INITIALIZED_EDITORS.has(editor)) {
    if (initialValue && !Node.isNodeList(initialValue)) {
      throw new Error(
        '[Slate] initialValue is invalid! Expected a list of elements.'
      )
    }

    if (!Editor.isEditor(editor)) {
      throw new Error('[Slate] editor is invalid!')
    }

    if (initialValue) {
      Editor.replace(editor, {
        children: initialValue,
        selection: null,
      })
    }

    INITIALIZED_EDITORS.add(editor)
  }

  const { selectorContext, onChange: handleSelectorChange } =
    useSelectorContext()
  const lastOperationCountRef = useRef(Editor.getOperations(editor).length)

  useEffect(() => {
    const maybeBatchUpdates =
      REACT_MAJOR_VERSION < 18
        ? ReactDOM.unstable_batchedUpdates
        : (callback: () => void) => callback()

    const onContextChange: Parameters<typeof Editor.subscribe>[1] = (
      snapshot,
      commit
    ) => {
      const nextOperations = commit
        ? [...commit.operations]
        : Editor.getOperations(editor, lastOperationCountRef.current)
      lastOperationCountRef.current = Editor.getOperations(editor).length

      maybeBatchUpdates(() => {
        setIsFocused(ReactEditor.isFocused(editor))
        const textSync = syncTextOperationsToDOM(editor, nextOperations)
        const hasUnsyncedTextOperation =
          textSync.textOperationCount > textSync.syncedTextOperationCount

        onSnapshotChange?.(snapshot, commit ?? null)

        if (onSelectionChange && commit?.selectionChanged) {
          onSelectionChange(snapshot.selection)
        }

        if (onValueChange && commit?.childrenChanged) {
          onValueChange(snapshot.children)
        }

        handleSelectorChange(
          hasUnsyncedTextOperation ? undefined : nextOperations,
          commit
        )
      })
    }

    return Editor.subscribe(editor, onContextChange)
  }, [
    editor,
    handleSelectorChange,
    onSelectionChange,
    onSnapshotChange,
    onValueChange,
  ])

  const [isFocused, setIsFocused] = useState(ReactEditor.isFocused(editor))

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

  return React.createElement(
    SlateSelectorContext.Provider,
    { value: selectorContext },
    <ProjectionContext.Provider value={projectionStore}>
      <EditorContext.Provider value={editor}>
        <FocusedContext.Provider value={isFocused}>
          {children}
        </FocusedContext.Provider>
      </EditorContext.Provider>
    </ProjectionContext.Provider>
  )
}
