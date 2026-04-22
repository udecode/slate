import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createEditor,
  type Descendant,
  Editor,
  type Element,
  Node,
  Transforms,
} from '../src'

const collapsedSelection = (path: number[], offset: number) => ({
  anchor: { path, offset },
  focus: { path, offset },
})

describe('slate transforms contract', () => {
  it('moveNodes is a no-op when the source and destination paths are equal', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        { type: 'block', children: [{ text: '1' }] },
        { type: 'block', children: [{ text: '2' }] },
      ],
      selection: null,
      marks: null,
    })

    Transforms.moveNodes(editor, { at: [1], to: [1] })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      { type: 'block', children: [{ text: '1' }] },
      { type: 'block', children: [{ text: '2' }] },
    ])
  })

  it('moveNodes can move a top-level block inside the next block container', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'block',
          children: [{ text: 'one' }],
        },
        {
          type: 'block',
          children: [{ type: 'block', children: [{ text: 'two' }] }],
        },
      ],
      selection: collapsedSelection([0, 0], 0),
      marks: null,
    })

    Transforms.moveNodes(editor, { at: [0], to: [1, 1] })

    const after = Editor.getSnapshot(editor)

    assert.deepEqual(after.children, [
      {
        type: 'block',
        children: [
          { type: 'block', children: [{ text: 'two' }] },
          { type: 'block', children: [{ text: 'one' }] },
        ],
      },
    ])
    assert.deepEqual(after.selection, collapsedSelection([0, 1, 0], 0))
  })

  it('setNodes can target the selected inline element through match without an explicit path', () => {
    const editor = createEditor()
    editor.isInline = (element) => element.type === 'inline'

    Editor.replace(editor, {
      children: [
        {
          type: 'block',
          children: [
            { text: '' },
            { type: 'inline', children: [{ text: 'word' }] },
            { text: '' },
          ],
        } as Descendant,
      ],
      selection: collapsedSelection([0, 1, 0], 0),
      marks: null,
    })

    Transforms.setNodes(
      editor,
      { someKey: true },
      {
        match: (node) => 'children' in node && Editor.isInline(editor, node),
      }
    )

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'block',
        children: [
          { text: '' },
          { type: 'inline', someKey: true, children: [{ text: 'word' }] },
          { text: '' },
        ],
      },
    ])
  })

  it('setNodes still accepts the legacy generic props contract', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [{ text: 'one' }],
        } as Descendant,
      ],
      selection: collapsedSelection([0, 0], 0),
      marks: null,
    })

    Transforms.setNodes<Element>(editor, { type: 'heading-one' }, { at: [0] })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'heading-one',
        children: [{ text: 'one' }],
      },
    ])
  })

  it('setNodes can target the highest matching inline when mode is highest', () => {
    const editor = createEditor()
    editor.isInline = (element) => element.type === 'inline'

    Editor.replace(editor, {
      children: [
        {
          type: 'block',
          children: [
            { text: '' },
            {
              type: 'inline',
              children: [
                { text: '' },
                { type: 'inline', children: [{ text: 'word' }] },
                { text: '' },
              ],
            },
            { text: '' },
          ],
        } as Descendant,
      ],
      selection: collapsedSelection([0, 1, 1, 0], 0),
      marks: null,
    })

    Transforms.setNodes(
      editor,
      { someKey: true },
      {
        match: (node) => 'children' in node && Editor.isInline(editor, node),
        mode: 'highest',
      }
    )

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'block',
        children: [
          { text: '' },
          {
            type: 'inline',
            someKey: true,
            children: [
              { text: '' },
              {
                type: 'inline',
                children: [{ text: 'word' }],
              },
              { text: '' },
            ],
          },
          { text: '' },
        ],
      },
    ])
  })

  it('wrapNodes can split a selected block range', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        { type: 'block', children: [{ text: 'one' }] },
        { type: 'block', children: [{ text: 'two' }] },
      ],
      selection: {
        anchor: { path: [0, 0], offset: 2 },
        focus: { path: [1, 0], offset: 1 },
      },
      marks: null,
    })

    Transforms.wrapNodes(editor, { type: 'quote', children: [] } as Element, {
      split: true,
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      { type: 'block', children: [{ text: 'on' }] },
      {
        type: 'quote',
        children: [
          { type: 'block', children: [{ text: 'e' }] },
          { type: 'block', children: [{ text: 't' }] },
        ],
      },
      { type: 'block', children: [{ text: 'wo' }] },
    ])
  })

  it('wrapNodes can honor match and leave rejected nodes alone', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'block',
          noneditable: true,
          children: [{ text: 'word' }],
        } as Descendant,
      ],
      selection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      },
      marks: null,
    })

    Transforms.wrapNodes(editor, { type: 'quote', children: [] } as Element, {
      match: (node, currentPath) => {
        if ('noneditable' in node && node.noneditable === true) return false

        for (const [ancestor] of Node.ancestors(editor, currentPath)) {
          if ('noneditable' in ancestor && ancestor.noneditable === true) {
            return false
          }
        }

        return true
      },
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'block',
        noneditable: true,
        children: [{ text: 'word' }],
      },
    ])
  })

  it('unwrapNodes can honor match with mode all', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'block',
          a: true,
          children: [
            {
              type: 'block',
              a: true,
              children: [{ type: 'block', children: [{ text: 'word' }] }],
            },
          ],
        } as Descendant,
      ],
      selection: {
        anchor: { path: [0, 0, 0, 0], offset: 0 },
        focus: { path: [0, 0, 0, 0], offset: 0 },
      },
      marks: null,
    })

    Transforms.unwrapNodes(editor, {
      match: (node) => 'a' in node && node.a === true,
      mode: 'all',
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      { type: 'block', children: [{ text: 'word' }] },
    ])
  })

  it('liftNodes can target inside a void element when voids is true', () => {
    const editor = createEditor()
    editor.isVoid = (element) => element.void === true

    Editor.replace(editor, {
      children: [
        {
          type: 'block',
          void: true,
          children: [{ type: 'block', children: [{ text: 'word' }] }],
        } as Descendant,
      ],
      selection: null,
      marks: null,
    })

    Transforms.liftNodes(editor, { at: [0, 0], voids: true })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      { type: 'block', children: [{ text: 'word' }] },
    ])
  })
})
