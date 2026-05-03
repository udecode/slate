import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Editor } from 'slate/internal'

import { createEditor, Element, Node, Operation, Range, Text } from '../src'

describe('slate interfaces contract', () => {
  it('treats editors as nodes, not elements', () => {
    const editor = createEditor()

    assert.equal(Node.isNode(editor), true)
    assert.equal(Element.isElement(editor), false)
  })

  it('treats arrays of editor-like values as not an element list', () => {
    const editor = createEditor()

    assert.equal(Element.isElementList([editor]), false)
  })

  it('treats plain text objects as text', () => {
    assert.equal(Text.isText({ text: '' }), true)
  })

  it('rejects plain objects as nodes', () => {
    assert.equal(Node.isNode({}), false)
  })

  it('recognizes move_node operations', () => {
    assert.equal(
      Operation.isOperation({
        type: 'move_node',
        path: [0],
        newPath: [1],
      }),
      true
    )
  })

  it('recognizes operation lists', () => {
    assert.equal(
      Operation.isOperationList([
        {
          type: 'set_node',
          path: [0],
          properties: {},
          newProperties: {},
        },
      ]),
      true
    )
  })

  it('recognizes ranges', () => {
    assert.equal(
      Range.isRange({
        anchor: { path: [0, 1], offset: 0 },
        focus: { path: [0, 1], offset: 0 },
      }),
      true
    )
  })

  it('rejects insert_fragment operations whose at target is only a Path', () => {
    assert.equal(
      Operation.isOperation({
        type: 'insert_fragment',
        fragment: [],
        at: [0],
      }),
      false
    )
  })

  it('recognizes editor instances without stale public state fields', () => {
    const editor = createEditor() as ReturnType<typeof createEditor> & {
      exec?: () => void
    }

    editor.exec = () => {}

    assert.equal('apply' in editor, false)
    assert.equal(Array.isArray(editor.read((state) => state.value.get())), true)
    assert.equal(Editor.getSelection(editor), null)
    assert.equal('children' in editor, false)
    assert.equal('selection' in editor, false)
  })
})
