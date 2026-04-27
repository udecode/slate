import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createEditor, type Descendant, Editor, setTargetRuntime } from '../src'

const paragraph = (text: string): Descendant => ({
  type: 'paragraph',
  children: [{ text }],
})

const setupEditor = () => {
  const editor = createEditor()

  Editor.replace(editor, {
    children: [paragraph('one'), paragraph('two')],
    selection: {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    },
  })

  return editor
}

describe('editor methods', () => {
  it('applies marks through the transaction-resolved implicit target', () => {
    const editor = setupEditor()
    let calls = 0

    setTargetRuntime(editor, {
      resolveImplicitTarget() {
        calls += 1

        return {
          anchor: { path: [1, 0], offset: 0 },
          focus: { path: [1, 0], offset: 3 },
        }
      },
    })

    editor.addMark('bold', true)

    assert.equal(calls, 1)
    assert.deepEqual(Editor.getChildren(editor), [
      paragraph('one'),
      {
        type: 'paragraph',
        children: [{ text: 'two', bold: true }],
      },
    ])
  })

  it('removes marks through the transaction-resolved implicit target', () => {
    const editor = createEditor()
    let calls = 0

    Editor.replace(editor, {
      children: [
        paragraph('one'),
        {
          type: 'paragraph',
          children: [{ text: 'two', bold: true }],
        },
      ],
      selection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      },
    })

    setTargetRuntime(editor, {
      resolveImplicitTarget() {
        calls += 1

        return {
          anchor: { path: [1, 0], offset: 0 },
          focus: { path: [1, 0], offset: 3 },
        }
      },
    })

    editor.removeMark('bold')

    assert.equal(calls, 1)
    assert.deepEqual(Editor.getChildren(editor), [
      paragraph('one'),
      paragraph('two'),
    ])
  })

  it('toggles marks from the transaction-resolved implicit target', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [{ text: 'one', bold: true }],
        },
        paragraph('two'),
      ],
      selection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 3 },
      },
    })

    setTargetRuntime(editor, {
      resolveImplicitTarget() {
        return {
          anchor: { path: [1, 0], offset: 0 },
          focus: { path: [1, 0], offset: 3 },
        }
      },
    })

    editor.toggleMark('bold')

    assert.deepEqual(Editor.getChildren(editor), [
      {
        type: 'paragraph',
        children: [{ text: 'one', bold: true }],
      },
      {
        type: 'paragraph',
        children: [{ text: 'two', bold: true }],
      },
    ])
  })

  it('toggles blocks from the transaction-resolved implicit target', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'heading-one',
          children: [{ text: 'one' }],
        },
        paragraph('two'),
      ],
      selection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 3 },
      },
    })

    setTargetRuntime(editor, {
      resolveImplicitTarget() {
        return {
          anchor: { path: [1, 0], offset: 0 },
          focus: { path: [1, 0], offset: 3 },
        }
      },
    })

    editor.toggleBlock('heading-one')

    assert.deepEqual(Editor.getChildren(editor), [
      {
        type: 'heading-one',
        children: [{ text: 'one' }],
      },
      {
        type: 'heading-one',
        children: [{ text: 'two' }],
      },
    ])
  })

  it('toggles alignment from the transaction-resolved implicit target', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          align: 'center',
          children: [{ text: 'one' }],
        },
        paragraph('two'),
      ],
      selection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 3 },
      },
    })

    setTargetRuntime(editor, {
      resolveImplicitTarget() {
        return {
          anchor: { path: [1, 0], offset: 0 },
          focus: { path: [1, 0], offset: 3 },
        }
      },
    })

    editor.toggleAlignment('center')

    assert.deepEqual(Editor.getChildren(editor), [
      {
        type: 'paragraph',
        align: 'center',
        children: [{ text: 'one' }],
      },
      {
        type: 'paragraph',
        align: 'center',
        children: [{ text: 'two' }],
      },
    ])
  })

  it('toggles lists from the transaction-resolved implicit target', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'bulleted-list',
          children: [
            {
              type: 'list-item',
              children: [{ text: 'one' }],
            },
          ],
        },
        paragraph('two'),
      ],
      selection: {
        anchor: { path: [0, 0, 0], offset: 0 },
        focus: { path: [0, 0, 0], offset: 3 },
      },
    })

    setTargetRuntime(editor, {
      resolveImplicitTarget() {
        return {
          anchor: { path: [1, 0], offset: 0 },
          focus: { path: [1, 0], offset: 3 },
        }
      },
    })

    editor.toggleList('bulleted-list')

    assert.deepEqual(Editor.getChildren(editor), [
      {
        type: 'bulleted-list',
        children: [
          {
            type: 'list-item',
            children: [{ text: 'one' }],
          },
        ],
      },
      {
        type: 'bulleted-list',
        children: [
          {
            type: 'list-item',
            children: [{ text: 'two' }],
          },
        ],
      },
    ])
  })
})
