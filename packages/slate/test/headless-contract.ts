import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createEditor,
  type Descendant,
  type Editor as SlateEditor,
} from 'slate'
import { Editor } from 'slate/internal'
import { History, HistoryEditor, withHistory } from 'slate-history'
import { createHyperscript } from 'slate-hyperscript'

import { jsx } from './index.js'

const createSelectedEditor = (): SlateEditor =>
  jsx(
    'editor',
    {},
    [
      jsx('element', { type: 'paragraph' }, 'alpha'),
      jsx('element', { type: 'paragraph' }, 'beta'),
    ],
    jsx(
      'selection',
      {},
      jsx('anchor', { path: [1, 0], offset: 2 }),
      jsx('focus', { path: [1, 0], offset: 2 })
    )
  ) as SlateEditor

describe('slate headless contract', () => {
  it('supports package-split headless composition through source-resolved package imports', () => {
    const editor = withHistory(createEditor())
    const input = createSelectedEditor()
    const h = createHyperscript({
      elements: {
        paragraph: { type: 'paragraph' },
      },
    })
    const fragment = h(
      'fragment',
      {},
      h('paragraph', {}, 'alpha')
    ) as Descendant[]

    assert.equal(History.isHistory(editor.history), true)

    Editor.replace(editor, {
      children: Editor.getChildren(input) as Descendant[],
      selection: Editor.getSelection(input),
      marks: null,
    })

    const inputSelection = Editor.getSelection(input)!
    const ref = Editor.rangeRef(editor, inputSelection)

    editor.update((tx) => {
      tx.fragment.insert(fragment)
    })

    const snapshot = Editor.getSnapshot(editor)

    assert.deepEqual(snapshot.children, [
      {
        type: 'paragraph',
        children: [{ text: 'alpha' }],
      },
      {
        type: 'paragraph',
        children: [{ text: 'bealphata' }],
      },
    ])
    assert.deepEqual(snapshot.selection, {
      anchor: { path: [1, 0], offset: 7 },
      focus: { path: [1, 0], offset: 7 },
    })
    assert.deepEqual(ref.current, snapshot.selection)

    HistoryEditor.undo(editor)

    assert.deepEqual(
      Editor.getSnapshot(editor).children,
      Editor.getChildren(input)
    )
    assert.deepEqual(Editor.getSnapshot(editor).selection, inputSelection)
  })

  it('lets hyperscript-built selections drive core fragment extraction without React', () => {
    const h = createHyperscript({
      elements: {
        paragraph: { type: 'paragraph' },
      },
    })
    const input = h(
      'editor',
      {},
      h('paragraph', {}, 'word'),
      h(
        'selection',
        {},
        h('anchor', { path: [0, 0], offset: 1 }),
        h('focus', { path: [0, 0], offset: 3 })
      )
    ) as SlateEditor
    const editor = createEditor()

    Editor.replace(editor, {
      children: Editor.getChildren(input) as Descendant[],
      selection: Editor.getSelection(input),
      marks: null,
    })

    assert.deepEqual(Editor.getFragment(editor), [
      {
        type: 'paragraph',
        children: [{ text: 'or' }],
      },
    ])
  })
})
