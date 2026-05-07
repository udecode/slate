import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Editor } from 'slate/internal'
import {
  createEditor,
  type Descendant,
  Operation,
  type Operation as SlateOperation,
} from '../src'
import { extendTestSchema } from './support/schema'

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

const applyOperation = (
  editor: ReturnType<typeof createEditor>,
  operation: SlateOperation
) => {
  editor.update((tx) => {
    tx.operations.replay([operation])
  })
}

describe('slate operations contract', () => {
  it('applies and inverts replace_fragment as one root replacement', () => {
    const editor = createEditor()
    const children = moveChildren()
    const newChildren: Descendant[] = [
      {
        type: 'element',
        children: [{ text: 'one' }],
      },
      {
        type: 'element',
        children: [{ text: 'two' }],
      },
      {
        type: 'element',
        children: [{ text: 'three' }],
      },
    ]
    const selection = collapsedSelection([0, 0], 0)
    const newSelection = collapsedSelection([2, 0], 'three'.length)
    const operation: SlateOperation = {
      children,
      newChildren,
      newSelection,
      path: [],
      selection,
      type: 'replace_fragment',
    }

    assert.equal(Operation.isOperation(operation), true)

    Editor.replace(editor, {
      children,
      selection,
      marks: null,
    })

    applyOperation(editor, operation)

    assert.deepEqual(Editor.getSnapshot(editor).children, newChildren)
    assert.deepEqual(Editor.getSnapshot(editor).selection, newSelection)

    applyOperation(editor, Operation.inverse(operation))

    assert.deepEqual(Editor.getSnapshot(editor).children, children)
    assert.deepEqual(Editor.getSnapshot(editor).selection, selection)
  })

  it('applies and inverts replace_children as one parent child-range replacement', () => {
    const editor = createEditor()
    const children: Descendant[] = [
      {
        type: 'element',
        children: [{ text: '0' }],
      },
      ...moveChildren(),
      {
        type: 'element',
        children: [{ text: '3' }],
      },
    ]
    const newChildren = [
      {
        type: 'element',
        children: [{ text: 'one-two' }],
      },
    ]
    const selection = collapsedSelection([1, 0], 0)
    const newSelection = collapsedSelection([1, 0], 'one-two'.length)
    const operation: SlateOperation = {
      children: children.slice(1, 3),
      index: 1,
      newChildren,
      newSelection,
      path: [],
      selection,
      type: 'replace_children',
    }

    assert.equal(Operation.isOperation(operation), true)

    Editor.replace(editor, {
      children,
      selection,
      marks: null,
    })

    applyOperation(editor, operation)

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      children[0],
      newChildren[0],
      children[3],
    ])
    assert.deepEqual(Editor.getSnapshot(editor).selection, newSelection)

    applyOperation(editor, Operation.inverse(operation))

    assert.deepEqual(Editor.getSnapshot(editor).children, children)
    assert.deepEqual(Editor.getSnapshot(editor).selection, selection)
  })

  it('rejects unknown operation-like records during replay', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: moveChildren(),
      selection: collapsedSelection([0, 0], 0),
      marks: null,
    })

    assert.throws(() => {
      editor.update((tx) => {
        tx.operations.replay([
          {
            type: 'custom_operation',
            path: [0],
            payload: true,
          },
        ] as never)
      })
    }, /Cannot replay an unknown Slate operation/)

    assert.deepEqual(
      Editor.getOperations(editor).map((operation) => operation.type),
      []
    )
  })

  it('rebases refs after replace_children and nulls refs inside the replaced window', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'element',
          children: [{ text: '0' }],
        },
        ...moveChildren(),
        {
          type: 'element',
          children: [{ text: '3' }],
        },
      ],
      selection: collapsedSelection([3, 0], 0),
      marks: null,
    })

    const beforeRef = Editor.pathRef(editor, [0])
    const insidePathRef = Editor.pathRef(editor, [1])
    const insidePointRef = Editor.pointRef(editor, { path: [2, 0], offset: 0 })
    const afterRef = Editor.pathRef(editor, [3, 0])

    applyOperation(editor, {
      type: 'replace_children',
      path: [],
      index: 1,
      children: moveChildren(),
      newChildren: [
        {
          type: 'element',
          children: [{ text: 'one-two' }],
        },
      ],
      selection: collapsedSelection([3, 0], 0),
      newSelection: collapsedSelection([2, 0], 0),
    })

    assert.deepEqual(beforeRef.unref(), [0])
    assert.equal(insidePathRef.unref(), null)
    assert.equal(insidePointRef.unref(), null)
    assert.deepEqual(afterRef.unref(), [2, 0])
  })

  it('treats move_node as a no-op when path equals newPath', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: moveChildren(),
      selection: null,
      marks: null,
    })

    applyOperation(editor, {
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

    applyOperation(editor, {
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

    applyOperation(editor, {
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

    applyOperation(editor, {
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

    applyOperation(editor, {
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
        applyOperation(editor, {
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

    applyOperation(editor, {
      type: 'split_node',
      path: [0, 0],
      position: 5,
      properties: {
        bold: true,
      },
    })

    applyOperation(editor, {
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
    extendTestSchema(editor, { type: 'inline', inline: true })

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

    applyOperation(editor, {
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

    applyOperation(editor, {
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

    applyOperation(editor, {
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
    extendTestSchema(editor, { type: 'inline', inline: true })

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

    applyOperation(editor, {
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

    applyOperation(editor, {
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

    applyOperation(editor, {
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

    applyOperation(editor, {
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
    extendTestSchema(editor, { type: 'inline', inline: true })

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

    applyOperation(editor, {
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
