import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Editor } from 'slate/internal'
import { createEditor, type Descendant } from '../src'

describe('slate normalization contract', () => {
  it('repairs an empty block with an empty text child', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [{ type: 'block', children: [] } as Descendant],
      selection: null,
      marks: null,
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      { type: 'block', children: [{ text: '' }] },
    ])
  })

  it('removes stray top-level text during replace-time block-only cleanup', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        { text: 'one' } as Descendant,
        { type: 'block', children: [{ text: 'two' }] } as Descendant,
        { text: 'three' } as Descendant,
        { type: 'block', children: [{ text: 'four' }] } as Descendant,
      ],
      selection: null,
      marks: null,
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      { type: 'block', children: [{ text: 'two' }] },
      { type: 'block', children: [{ text: 'four' }] },
    ])
  })

  it('removes stray top-level text during node-op block-only cleanup', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'block',
          children: [{ text: 'alpha' }],
        },
        {
          type: 'block',
          children: [{ text: 'beta' }],
        },
      ] as Descendant[],
      selection: null,
      marks: null,
    })

    editor.update((tx) => {
      tx.nodes.insert({ text: 'stray' }, { at: [0] })
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'block',
        children: [{ text: 'alpha' }],
      },
      {
        type: 'block',
        children: [{ text: 'beta' }],
      },
    ])
  })

  it('explicitly merges adjacent compatible text children in inline-style containers', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [
            { text: 'al', bold: true },
            { text: 'pha', bold: true },
          ],
        },
      ] as Descendant[],
      selection: null,
      marks: null,
    })

    Editor.normalize(editor)

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'paragraph',
        children: [{ text: 'alpha', bold: true }],
      },
    ])
  })

  it('explicitly removes empty adjacent text in inline-style containers', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [
            { text: 'alpha', bold: true },
            { text: '', bold: true },
            { text: 'beta', bold: true },
          ],
        },
      ] as Descendant[],
      selection: null,
      marks: null,
    })

    Editor.normalize(editor)

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'paragraph',
        children: [{ text: 'alphabeta', bold: true }],
      },
    ])
  })

  it('flattens a direct block child inserted into an inline-style container without merging unrelated text runs', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [{ text: 'alpha' }, { text: 'gamma' }],
        },
      ] as Descendant[],
      selection: null,
      marks: null,
    })

    editor.update((tx) => {
      tx.nodes.insert(
        {
          type: 'paragraph',
          children: [{ text: 'beta' }],
        } as Descendant,
        { at: [0, 1] }
      )
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'paragraph',
        children: [{ text: 'alpha' }, { text: 'beta' }, { text: 'gamma' }],
      },
    ])
  })
})
