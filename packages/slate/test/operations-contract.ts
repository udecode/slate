import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createEditor, type Descendant, Editor } from '../src'

const moveChildren = (): Descendant[] => [
  {
    type: 'element',
    children: [{ text: '1' }],
  },
  {
    type: 'element',
    children: [{ text: '2' }],
  },
]

const collapsedSelection = (path: number[], offset: number) => ({
  anchor: { path, offset },
  focus: { path, offset },
})

describe('slate operations contract', () => {
  it('treats move_node as a no-op when path equals newPath', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: moveChildren(),
      selection: null,
      marks: null,
    })

    editor.apply({
      type: 'move_node',
      path: [0],
      newPath: [0],
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, moveChildren())
  })

  it('moves a node when move_node targets the post-removal destination path', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: moveChildren(),
      selection: null,
      marks: null,
    })

    editor.apply({
      type: 'move_node',
      path: [0],
      newPath: [2],
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'element',
        children: [{ text: '2' }],
      },
      {
        type: 'element',
        children: [{ text: '1' }],
      },
    ])
  })

  it('rebases selection with the effective move_node target when moving to a later sibling slot', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: moveChildren(),
      selection: collapsedSelection([0, 0], 0),
      marks: null,
    })

    editor.apply({
      type: 'move_node',
      path: [0],
      newPath: [2],
    })

    const after = Editor.getSnapshot(editor)

    assert.deepEqual(after.children, [
      {
        type: 'element',
        children: [{ text: '2' }],
      },
      {
        type: 'element',
        children: [{ text: '1' }],
      },
    ])
    assert.deepEqual(after.selection, collapsedSelection([1, 0], 0))
  })

  it('rebases selection when insert_node inserts before the selected node', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: moveChildren(),
      selection: collapsedSelection([0, 0], 0),
      marks: null,
    })

    editor.apply({
      type: 'insert_node',
      path: [0],
      node: {
        type: 'element',
        children: [{ text: '0' }],
      },
    })

    const after = Editor.getSnapshot(editor)

    assert.deepEqual(after.children, [
      {
        type: 'element',
        children: [{ text: '0' }],
      },
      {
        type: 'element',
        children: [{ text: '1' }],
      },
      {
        type: 'element',
        children: [{ text: '2' }],
      },
    ])
    assert.deepEqual(after.selection, collapsedSelection([1, 0], 0))
  })

  it('applies partial set_selection patches against the current selection', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: moveChildren(),
      selection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [1, 0], offset: 1 },
      },
      marks: null,
    })

    editor.apply({
      type: 'set_selection',
      properties: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [1, 0], offset: 1 },
      },
      newProperties: {
        focus: { path: [1, 0], offset: 0 },
      },
    })

    assert.deepEqual(Editor.getSnapshot(editor).selection, {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [1, 0], offset: 0 },
    })
  })

  it('rejects partial set_selection patches when the editor has no live selection', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: moveChildren(),
      selection: null,
      marks: null,
    })

    assert.throws(
      () =>
        editor.apply({
          type: 'set_selection',
          properties: null,
          newProperties: {
            anchor: { path: [0, 0], offset: 0 },
          },
        }),
      /set_selection patch requires an existing selection or a full range/
    )
  })

  it('splits a text node with split_node then splits its parent element', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'element',
          children: [{ text: 'some text', bold: true }],
        },
      ],
      selection: null,
      marks: null,
    })

    editor.apply({
      type: 'split_node',
      path: [0, 0],
      position: 5,
      properties: {
        bold: true,
      },
    })

    editor.apply({
      type: 'split_node',
      path: [0],
      position: 1,
      properties: {},
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'element',
        children: [{ text: 'some ', bold: true }],
      },
      {
        type: 'element',
        children: [{ text: 'text', bold: true }],
      },
    ])
  })

  it('splits an element node with element-level split_node properties', () => {
    const editor = createEditor()
    editor.isInline = (element) => element.type === 'inline'

    Editor.replace(editor, {
      children: [
        {
          type: 'element',
          data: true,
          children: [
            { text: 'before text' },
            {
              type: 'inline',
              children: [{ text: 'hyperlink' }],
            },
            { text: 'after text' },
          ],
        },
      ],
      selection: null,
      marks: null,
    })

    editor.apply({
      type: 'split_node',
      path: [0],
      position: 1,
      properties: {
        data: true,
      },
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'element',
        data: true,
        children: [{ text: 'before text' }],
      },
      {
        type: 'element',
        data: true,
        children: [
          { text: '' },
          {
            type: 'inline',
            children: [{ text: 'hyperlink' }],
          },
          { text: 'after text' },
        ],
      },
    ])
  })

  it('rebases selection to the next text when remove_node deletes the selected leading empty text', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'element',
          children: [{ text: '' }, { text: 'b' }],
        },
      ],
      selection: collapsedSelection([0, 0], 0),
      marks: null,
    })

    editor.apply({
      type: 'remove_node',
      path: [0, 0],
      node: { text: '' },
    })

    const after = Editor.getSnapshot(editor)

    assert.deepEqual(after.children, [
      {
        type: 'element',
        children: [{ text: 'b' }],
      },
    ])
    assert.deepEqual(after.selection, collapsedSelection([0, 0], 0))
  })

  it('rebases selection to the previous text end when remove_node deletes the selected trailing empty text', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'element',
          children: [{ text: 'a' }, { text: '' }],
        },
      ],
      selection: collapsedSelection([0, 1], 0),
      marks: null,
    })

    editor.apply({
      type: 'remove_node',
      path: [0, 1],
      node: { text: '' },
    })

    const after = Editor.getSnapshot(editor)

    assert.deepEqual(after.children, [
      {
        type: 'element',
        children: [{ text: 'a' }],
      },
    ])
    assert.deepEqual(after.selection, collapsedSelection([0, 0], 1))
  })

  it('rebases selection into the adjacent inline when remove_node deletes the selected trailing spacer text', () => {
    const editor = createEditor()
    editor.isInline = (element) => element.type === 'inline'

    Editor.replace(editor, {
      children: [
        {
          type: 'element',
          children: [
            { text: '' },
            {
              type: 'inline',
              children: [{ text: 'a' }],
            },
            { text: '' },
          ],
        },
      ],
      selection: collapsedSelection([0, 2], 0),
      marks: null,
    })

    editor.apply({
      type: 'remove_node',
      path: [0, 2],
      node: { text: '' },
    })

    const after = Editor.getSnapshot(editor)

    assert.deepEqual(after.children, [
      {
        type: 'element',
        children: [
          { text: '' },
          {
            type: 'inline',
            children: [{ text: 'a' }],
          },
          { text: '' },
        ],
      },
    ])
    assert.deepEqual(after.selection, collapsedSelection([0, 1, 0], 1))
  })

  it('rebases expanded selections inward when remove_text deletes text inside the range', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'element',
          children: [{ text: 'word' }],
        },
      ],
      selection: {
        anchor: { path: [0, 0], offset: 1 },
        focus: { path: [0, 0], offset: 4 },
      },
      marks: null,
    })

    editor.apply({
      type: 'remove_text',
      path: [0, 0],
      offset: 1,
      text: 'or',
    })

    const after = Editor.getSnapshot(editor)

    assert.equal(after.children[0]?.children[0]?.text, 'wd')
    assert.deepEqual(after.selection, {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 2 },
    })
  })

  it('removes omitted text props through raw set_node', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'element',
          children: [{ text: 'a', someKey: true }],
        },
      ],
      selection: null,
      marks: null,
    })

    editor.apply({
      type: 'set_node',
      path: [0, 0],
      properties: { someKey: true },
      newProperties: {},
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'element',
        children: [{ text: 'a' }],
      },
    ])
  })

  it('splits a text node with empty split_node properties and clears the right branch props', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'element',
          children: [{ text: 'some text', bold: true }],
        },
      ],
      selection: null,
      marks: null,
    })

    editor.apply({
      type: 'split_node',
      path: [0, 0],
      position: 5,
      properties: {},
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'element',
        children: [{ text: 'some ', bold: true }, { text: 'text' }],
      },
    ])
  })

  it('splits an element node with empty split_node properties and clears the right branch props', () => {
    const editor = createEditor()
    editor.isInline = (element) => element.type === 'inline'

    Editor.replace(editor, {
      children: [
        {
          type: 'element',
          data: true,
          children: [
            { text: 'before text' },
            {
              type: 'inline',
              children: [{ text: 'hyperlink' }],
            },
            { text: 'after text' },
          ],
        },
      ],
      selection: null,
      marks: null,
    })

    editor.apply({
      type: 'split_node',
      path: [0],
      position: 1,
      properties: {},
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'element',
        data: true,
        children: [{ text: 'before text' }],
      },
      {
        type: 'element',
        children: [
          { text: '' },
          {
            type: 'inline',
            children: [{ text: 'hyperlink' }],
          },
          { text: 'after text' },
        ],
      },
    ])
  })
})
