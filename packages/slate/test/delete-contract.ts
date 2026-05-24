import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Editor } from 'slate/internal'

import { createEditor, type Descendant, defineEditorExtension } from '../src'

const paragraph = (text: string): Descendant => ({
  type: 'paragraph',
  children: [{ text }],
})

const table = (): Descendant => ({
  type: 'table',
  children: [
    {
      type: 'table-row',
      children: [
        { type: 'table-cell', children: [{ text: '' }] },
        { type: 'table-cell', children: [{ bold: true, text: 'Human' }] },
        { type: 'table-cell', children: [{ bold: true, text: 'Dog' }] },
        { type: 'table-cell', children: [{ bold: true, text: 'Cat' }] },
      ],
    },
    {
      type: 'table-row',
      children: [
        { type: 'table-cell', children: [{ bold: true, text: '# of Feet' }] },
        { type: 'table-cell', children: [{ text: '2' }] },
        { type: 'table-cell', children: [{ text: '4' }] },
        { type: 'table-cell', children: [{ text: '4' }] },
      ],
    },
    {
      type: 'table-row',
      children: [
        { type: 'table-cell', children: [{ bold: true, text: '# of Lives' }] },
        { type: 'table-cell', children: [{ text: '1' }] },
        { type: 'table-cell', children: [{ text: '1' }] },
        { type: 'table-cell', children: [{ text: '9' }] },
      ],
    },
  ],
})

describe('slate delete contract', () => {
  it('deletes a full selection that starts with an inline element', () => {
    const editor = createEditor()
    editor.extend({
      elements: [{ inline: true, type: 'link' }],
      name: 'delete-leading-inline',
    })
    const selection = {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 2], offset: 'World'.length },
    }

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'link', url: 'https://', children: [{ text: 'Hello' }] },
            { text: 'World' },
          ],
        },
      ],
      marks: null,
      selection,
    })

    editor.update((tx) => {
      tx.text.delete({ at: selection })
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'paragraph',
        children: [{ text: '' }],
      },
    ])
    assert.deepEqual(Editor.getSnapshot(editor).selection, {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })
  })

  it('deletes an expanded range that starts with an inline element', () => {
    const editor = createEditor()
    editor.extend({
      elements: [{ inline: true, type: 'link' }],
      name: 'delete-selection-leading-inline',
    })
    const selection = {
      anchor: { path: [0, 1, 0], offset: 0 },
      focus: { path: [0, 2], offset: 'World'.length },
    }

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [
            { text: 'Say' },
            { type: 'link', url: 'https://', children: [{ text: 'Hello' }] },
            { text: 'World' },
          ],
        },
      ],
      marks: null,
      selection,
    })

    editor.update((tx) => {
      tx.text.delete({ at: selection })
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'paragraph',
        children: [{ text: 'Say' }],
      },
    ])
    assert.deepEqual(Editor.getSnapshot(editor).selection, {
      anchor: { path: [0, 0], offset: 'Say'.length },
      focus: { path: [0, 0], offset: 'Say'.length },
    })
  })

  it('deletes only the selected formatted leaf window', () => {
    const editor = createEditor()
    const selection = {
      anchor: { path: [0, 0], offset: 'A '.length },
      focus: { path: [0, 3], offset: 0 },
    }

    editor.update((tx) => {
      tx.value.replace({
        children: [
          {
            type: 'paragraph',
            children: [
              { text: 'A paragraph with ' },
              { bold: true, text: 'rich' },
              { text: ' formatting before ' },
              { italic: true, text: 'much' },
              { text: ' more text.' },
            ],
          },
        ],
        marks: null,
        selection,
      })
    })

    editor.update((tx) => {
      tx.text.delete({ at: selection })
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'paragraph',
        children: [
          { text: 'A ' },
          { italic: true, text: 'much' },
          { text: ' more text.' },
        ],
      },
    ])
    assert.deepEqual(Editor.getSnapshot(editor).selection, {
      anchor: { path: [0, 0], offset: 'A '.length },
      focus: { path: [0, 0], offset: 'A '.length },
    })
  })

  it('trims both edges of an expanded range across sibling text leaves', () => {
    const editor = createEditor()
    const selection = {
      anchor: { path: [0, 0], offset: 'fi'.length },
      focus: { path: [0, 1], offset: 'sec'.length },
    }

    editor.update((tx) => {
      tx.value.replace({
        children: [
          {
            type: 'paragraph',
            children: [
              { bold: true, text: 'first' },
              { italic: true, text: 'second' },
              { text: 'third' },
            ],
          },
        ],
        marks: null,
        selection,
      })
    })

    editor.update((tx) => {
      tx.text.delete({ at: selection })
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'paragraph',
        children: [
          { bold: true, text: 'fi' },
          { italic: true, text: 'ond' },
          { text: 'third' },
        ],
      },
    ])
    assert.deepEqual(Editor.getSnapshot(editor).selection, {
      anchor: { path: [0, 0], offset: 'fi'.length },
      focus: { path: [0, 0], offset: 'fi'.length },
    })
  })

  it('trims cross-block expanded ranges into the anchor block', () => {
    const editor = createEditor()
    const selection = {
      anchor: { path: [0, 0], offset: 'fi'.length },
      focus: { path: [1, 0], offset: 'sec'.length },
    }

    editor.update((tx) => {
      tx.value.replace({
        children: [paragraph('first'), paragraph('second'), paragraph('third')],
        marks: null,
        selection,
      })
    })

    editor.update((tx) => {
      tx.text.delete({ at: selection })
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'paragraph',
        children: [{ text: 'fiond' }],
      },
      paragraph('third'),
    ])
    assert.deepEqual(Editor.getSnapshot(editor).selection, {
      anchor: { path: [0, 0], offset: 'fi'.length },
      focus: { path: [0, 0], offset: 'fi'.length },
    })
  })

  it('merges same-mark text when Backspace crosses an empty marked block start', () => {
    const editor = createEditor()

    editor.update((tx) => {
      tx.value.replace({
        children: [
          {
            type: 'paragraph',
            children: [{ bold: true, text: 'first' }],
          },
          {
            type: 'paragraph',
            children: [{ bold: true, text: '' }, { text: ' second' }],
          },
        ],
        marks: null,
        selection: {
          anchor: { path: [1, 0], offset: 0 },
          focus: { path: [1, 0], offset: 0 },
        },
      })
    })

    editor.update((tx) => {
      tx.text.deleteBackward()
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'paragraph',
        children: [{ bold: true, text: 'first' }, { text: ' second' }],
      },
    ])
    assert.deepEqual(Editor.getSnapshot(editor).selection, {
      anchor: { path: [0, 0], offset: 'first'.length },
      focus: { path: [0, 0], offset: 'first'.length },
    })
  })

  it('deletes through token-like marked text to a canonical empty block', () => {
    const editor = createEditor()

    editor.update((tx) => {
      tx.value.replace({
        children: [
          {
            type: 'paragraph',
            children: [{ text: 'a' }, { text: '#foo', token: true }],
          },
        ],
        marks: null,
        selection: {
          anchor: { path: [0, 1], offset: '#foo'.length },
          focus: { path: [0, 1], offset: '#foo'.length },
        },
      })
    })

    editor.update((tx) => {
      tx.text.deleteBackward()
      tx.text.deleteBackward()
      tx.text.deleteBackward()
      tx.text.deleteBackward()
      tx.text.deleteBackward()
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'paragraph',
        children: [{ text: '' }],
      },
    ])
    assert.deepEqual(Editor.getSnapshot(editor).selection, {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })
  })

  it('resets list-heavy content when deleting the full document selection', () => {
    const editor = createEditor()
    const selection = {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [2, 0], offset: 'after'.length },
    }

    editor.update((tx) => {
      tx.value.replace({
        children: [
          paragraph('before'),
          {
            type: 'bulleted-list',
            children: [
              {
                type: 'list-item',
                children: [
                  {
                    type: 'paragraph',
                    children: [{ text: 'item' }],
                  },
                ],
              },
            ],
          },
          paragraph('after'),
        ],
        marks: null,
        selection,
      })
    })

    editor.update((tx) => {
      tx.text.delete({ at: selection })
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'paragraph',
        children: [{ text: '' }],
      },
    ])
    assert.deepEqual(Editor.getSnapshot(editor).selection, {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })
  })

  it('merges a following paragraph into the previous list item on Backspace', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'bulleted-list',
          children: [
            {
              type: 'list-item',
              children: [{ text: 'list' }],
            },
          ],
        },
        paragraph('paragraph'),
      ],
      marks: null,
      selection: {
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 0 },
      },
    })

    editor.update((tx) => {
      tx.text.deleteBackward()
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'bulleted-list',
        children: [
          {
            type: 'list-item',
            children: [{ text: 'listparagraph' }],
          },
        ],
      },
    ])
    assert.deepEqual(Editor.getSnapshot(editor).selection, {
      anchor: { path: [0, 0, 0], offset: 'list'.length },
      focus: { path: [0, 0, 0], offset: 'list'.length },
    })
  })

  it('does not merge across an isolating block boundary on Backspace', () => {
    const editor = createEditor()
    editor.extend(
      defineEditorExtension({
        elements: [{ isolating: true, type: 'callout' }],
        name: 'isolating-delete-boundary',
      })
    )

    editor.update((tx) => {
      tx.value.replace({
        children: [
          {
            type: 'callout',
            children: [paragraph('inside')],
          },
          paragraph(''),
        ],
        marks: null,
        selection: {
          anchor: { path: [1, 0], offset: 0 },
          focus: { path: [1, 0], offset: 0 },
        },
      })
    })

    editor.update((tx) => {
      tx.text.deleteBackward()
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'callout',
        children: [paragraph('inside')],
      },
      paragraph(''),
    ])
    assert.deepEqual(Editor.getSnapshot(editor).selection, {
      anchor: { path: [1, 0], offset: 0 },
      focus: { path: [1, 0], offset: 0 },
    })
  })

  it('deletes a selected top-level block range with a bounded operation stream', () => {
    const editor = createEditor()
    const children = Array.from({ length: 20 }, (_, index) =>
      paragraph(`block-${index}`)
    )
    const selection = {
      anchor: { path: [10, 0], offset: 0 },
      focus: { path: [11, 0], offset: 'block-11'.length },
    }

    Editor.replace(editor, {
      children,
      marks: null,
      selection,
    })

    const operationsBefore = Editor.getOperations(editor).length

    editor.update((tx) => {
      tx.text.delete({ at: selection })
    })

    assert.deepEqual(
      Editor.getChildren(editor).map((_, index) =>
        Editor.string(editor, [index])
      ),
      [
        'block-0',
        'block-1',
        'block-2',
        'block-3',
        'block-4',
        'block-5',
        'block-6',
        'block-7',
        'block-8',
        'block-9',
        'block-12',
        'block-13',
        'block-14',
        'block-15',
        'block-16',
        'block-17',
        'block-18',
        'block-19',
      ]
    )
    assert.deepEqual(Editor.getSnapshot(editor).selection, {
      anchor: { path: [10, 0], offset: 0 },
      focus: { path: [10, 0], offset: 0 },
    })
    assert.deepEqual(
      Editor.getOperations(editor)
        .slice(operationsBefore)
        .map((operation) => operation.type),
      ['replace_children']
    )
  })

  it('keeps table shape intact when Backspace starts after a table', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [paragraph('before'), table(), paragraph('')],
      marks: null,
      selection: {
        anchor: { path: [2, 0], offset: 0 },
        focus: { path: [2, 0], offset: 0 },
      },
    })

    editor.update((tx) => {
      tx.text.deleteBackward()
    })

    const tableNode = Editor.getChildren(editor)[1] as Descendant & {
      children: { children: Descendant[] }[]
    }

    assert.equal(tableNode.type, 'table')
    assert.equal(Editor.getChildren(editor).length, 2)
    assert.deepEqual(
      tableNode.children.map((row) => row.children.length),
      [4, 4, 4]
    )
    assert.equal(Editor.string(editor, [1, 0, 0]), '')
    assert.equal(Editor.string(editor, [1, 0, 1]), 'Human')
    assert.deepEqual(Editor.getSnapshot(editor).selection, {
      anchor: { path: [1, 2, 3, 0], offset: 1 },
      focus: { path: [1, 2, 3, 0], offset: 1 },
    })
  })

  it('removes one preceding empty paragraph at a time on Backspace', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [paragraph('text')],
      marks: null,
      selection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      },
    })

    editor.update(() => {
      Editor.insertBreak(editor)
      Editor.insertBreak(editor)
      Editor.insertBreak(editor)
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      paragraph(''),
      paragraph(''),
      paragraph(''),
      paragraph('text'),
    ])

    editor.update((tx) => {
      tx.text.deleteBackward()
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      paragraph(''),
      paragraph(''),
      paragraph('text'),
    ])
    assert.deepEqual(Editor.getSnapshot(editor).selection, {
      anchor: { path: [2, 0], offset: 0 },
      focus: { path: [2, 0], offset: 0 },
    })
  })

  it('keeps earlier empty paragraphs when Backspace merges after a space block', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [paragraph('text')],
      marks: null,
      selection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      },
    })

    editor.update(() => {
      Editor.insertBreak(editor)
      Editor.insertBreak(editor)
      Editor.insertBreak(editor)
      Editor.insertBreak(editor)
      Editor.insertText(editor, ' ')
      Editor.insertBreak(editor)
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      paragraph(''),
      paragraph(''),
      paragraph(''),
      paragraph(''),
      paragraph(' '),
      paragraph('text'),
    ])

    editor.update((tx) => {
      tx.text.deleteBackward()
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      paragraph(''),
      paragraph(''),
      paragraph(''),
      paragraph(''),
      paragraph(' text'),
    ])
    assert.deepEqual(Editor.getSnapshot(editor).selection, {
      anchor: { path: [4, 0], offset: 1 },
      focus: { path: [4, 0], offset: 1 },
    })
  })

  it('removes an empty editable inline on Backspace without deleting preceding text', () => {
    const editor = createEditor()
    editor.extend(
      defineEditorExtension({
        elements: [{ inline: true, type: 'button' }],
        name: 'inline-delete-boundary',
      })
    )

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [
            { text: 'an ' },
            { type: 'button', children: [{ text: '' }] },
            { text: '!' },
          ],
        },
      ],
      marks: null,
      selection: {
        anchor: { path: [0, 1, 0], offset: 0 },
        focus: { path: [0, 1, 0], offset: 0 },
      },
    })

    editor.update((tx) => {
      tx.text.deleteBackward()
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'paragraph',
        children: [{ text: 'an !' }],
      },
    ])
    assert.deepEqual(Editor.getSnapshot(editor).selection, {
      anchor: { path: [0, 0], offset: 'an '.length },
      focus: { path: [0, 0], offset: 'an '.length },
    })
  })
})
