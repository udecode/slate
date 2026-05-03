import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Editor } from 'slate/internal'

import { createEditor, type Descendant } from '../src'

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

describe('slate clipboard contract', () => {
  it('extracts the selected fragment from an expanded selection', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: createChildren(),
      selection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 5 },
      },
      marks: null,
    })

    assert.deepEqual(
      editor.read((state) => state.fragment.get()),
      [
        {
          type: 'paragraph',
          children: [{ text: 'alpha' }],
        },
      ]
    )
  })

  it('extracts a mixed inline fragment from a single top-level block selection', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [
            { text: 'alpha ' },
            {
              type: 'chip',
              children: [{ text: 'beta' }],
            },
            { text: ' gamma' },
          ],
        },
      ],
      selection: {
        anchor: { path: [0, 0], offset: 3 },
        focus: { path: [0, 2], offset: 3 },
      },
      marks: null,
    })

    assert.deepEqual(
      editor.read((state) => state.fragment.get()),
      [
        {
          type: 'paragraph',
          children: [
            { text: 'ha ' },
            {
              type: 'chip',
              children: [{ text: 'beta' }],
            },
            { text: ' ga' },
          ],
        },
      ]
    )
  })

  it('treats an empty fragment insert as a no-op', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: createChildren(),
      selection: {
        anchor: { path: [0, 0], offset: 2 },
        focus: { path: [0, 0], offset: 2 },
      },
      marks: null,
    })

    const before = Editor.getSnapshot(editor)

    editor.update((tx) => {
      tx.fragment.insert([])
    })

    const after = Editor.getSnapshot(editor)

    assert.equal(after, before)
    assert.equal(Editor.getOperations(editor).length, 0)
  })

  it('inserts a fragment into a collapsed text selection', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: createChildren(),
      selection: {
        anchor: { path: [1, 0], offset: 2 },
        focus: { path: [1, 0], offset: 2 },
      },
      marks: null,
    })

    editor.update((tx) => {
      tx.fragment.insert([
        {
          type: 'paragraph',
          children: [{ text: 'alpha' }],
        },
      ])
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
  })

  it('replaces an expanded text selection with a fragment', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: createChildren(),
      selection: {
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 4 },
      },
      marks: null,
    })

    editor.update((tx) => {
      tx.fragment.insert([
        {
          type: 'paragraph',
          children: [{ text: 'alpha' }],
        },
      ])
    })

    const snapshot = Editor.getSnapshot(editor)

    assert.deepEqual(snapshot.children, [
      {
        type: 'paragraph',
        children: [{ text: 'alpha' }],
      },
      {
        type: 'paragraph',
        children: [{ text: 'alpha' }],
      },
    ])
    assert.deepEqual(snapshot.selection, {
      anchor: { path: [1, 0], offset: 5 },
      focus: { path: [1, 0], offset: 5 },
    })
  })
})
