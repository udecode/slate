import { createEditorRuntime, createEditorView, type Descendant } from 'slate'
import { Editor } from 'slate/internal'
import { history } from 'slate-history'

import {
  dom,
  EDITOR_TO_ROOT_VIEW_EDITORS,
  EDITOR_TO_USER_SELECTION,
} from '../src'

const paragraph = (text: string) =>
  ({
    type: 'paragraph',
    children: [{ text }],
  }) satisfies Descendant

describe('root operation middleware', () => {
  test('uses operation roots for DOM key preservation during sibling-root history replay', () => {
    const runtime = createEditorRuntime({
      extensions: [history(), dom()],
      initialValue: {
        roots: {
          header: [paragraph('header')],
          main: [paragraph('first'), paragraph('second')],
        },
      },
    })
    const headerEditor = createEditorView(runtime, { root: 'header' })
    const mainEditor = createEditorView(runtime, { root: 'main' })

    mainEditor.update((tx) => {
      tx.selection.set({
        anchor: { path: [1, 0], offset: 'second'.length },
        focus: { path: [1, 0], offset: 'second'.length },
      })
      tx.text.insert('!')
    })

    expect(() => {
      headerEditor.update((tx) => {
        tx.history.undo()
      })
    }).not.toThrow()

    expect(runtime.read((state) => state.value.get())).toEqual({
      roots: {
        header: [paragraph('header')],
        main: [paragraph('first'), paragraph('second')],
      },
    })
  })

  test('clears root view user selection refs on explicit selection changes', () => {
    const runtime = createEditorRuntime({
      extensions: [dom()],
      initialValue: {
        roots: {
          header: [paragraph('header')],
          main: [paragraph('body')],
        },
      },
    })
    const headerEditor = createEditorView(runtime, { root: 'header' })
    const selectionRef = Editor.rangeRef(headerEditor, {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 6 },
    })

    EDITOR_TO_ROOT_VIEW_EDITORS.set(runtime.editor, new Set([headerEditor]))
    EDITOR_TO_USER_SELECTION.set(headerEditor, selectionRef)

    headerEditor.update((tx) => {
      tx.selection.set({ path: [0, 0], offset: 3 })
    })

    expect(EDITOR_TO_USER_SELECTION.has(headerEditor)).toBe(false)
    expect(selectionRef.current).toBe(null)
  })
})
