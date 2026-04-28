import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createEditor, type Descendant, Editor } from '../src'

const createChildren = (): Descendant[] => [
  {
    type: 'paragraph',
    children: [{ text: 'alpha' }],
  },
  {
    type: 'paragraph',
    children: [{ text: 'beta' }],
  },
]

const createNestedChildren = (): Descendant[] => [
  {
    type: 'quote',
    children: [
      {
        type: 'paragraph',
        children: [{ text: 'alpha' }],
      },
      {
        type: 'paragraph',
        children: [{ text: 'beta' }],
      },
    ],
  },
]

describe('slate range ref contract', () => {
  it('publishes range ref updates at transaction commit', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: createChildren(),
      selection: null,
      marks: null,
    })

    const ref = Editor.rangeRef(editor, {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 4 },
    })

    Editor.withTransaction(editor, () => {
      editor.insertText('>', {
        at: { path: [0, 0], offset: 0 },
      })

      assert.deepEqual(ref.current, {
        anchor: { path: [0, 0], offset: 1 },
        focus: { path: [0, 0], offset: 4 },
      })
    })

    assert.deepEqual(ref.current, {
      anchor: { path: [0, 0], offset: 2 },
      focus: { path: [0, 0], offset: 5 },
    })
  })

  it('defaults rangeRef affinity inward', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: createChildren(),
      selection: null,
      marks: null,
    })

    const ref = Editor.rangeRef(editor, {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 4 },
    })

    editor.insertText('!', {
      at: { path: [0, 0], offset: 4 },
    })

    assert.deepEqual(ref.current, {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 4 },
    })
  })

  it('rebases range ref paths when top-level blocks move', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: createChildren(),
      selection: null,
      marks: null,
    })

    const ref = Editor.rangeRef(editor, {
      anchor: { path: [1, 0], offset: 1 },
      focus: { path: [1, 0], offset: 3 },
    })

    Editor.withTransaction(editor, () => {
      editor.moveNodes({
        at: [0],
        to: [2],
      })
    })

    assert.deepEqual(ref.current, {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 3 },
    })
  })

  it('rebases range refs inside the moved top-level block when moveNodes targets a later slot', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: createChildren(),
      selection: null,
      marks: null,
    })

    const ref = Editor.rangeRef(editor, {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 4 },
    })

    Editor.withTransaction(editor, () => {
      editor.moveNodes({
        at: [0],
        to: [2],
      })
    })

    assert.deepEqual(ref.current, {
      anchor: { path: [1, 0], offset: 1 },
      focus: { path: [1, 0], offset: 4 },
    })
  })

  it('rebases nested range ref paths when nested blocks move', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: createNestedChildren(),
      selection: null,
      marks: null,
    })

    const ref = Editor.rangeRef(editor, {
      anchor: { path: [0, 1, 0], offset: 1 },
      focus: { path: [0, 1, 0], offset: 3 },
    })

    Editor.withTransaction(editor, () => {
      editor.moveNodes({
        at: [0, 0],
        to: [0, 2],
      })
    })

    assert.deepEqual(ref.current, {
      anchor: { path: [0, 0, 0], offset: 1 },
      focus: { path: [0, 0, 0], offset: 3 },
    })
  })
})
