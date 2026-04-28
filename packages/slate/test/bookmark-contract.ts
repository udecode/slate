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

const createSplitChildren = (): Descendant[] => [
  {
    type: 'paragraph',
    children: [{ text: 'alpha' }],
  },
]

const createMergeChildren = (): Descendant[] => [
  {
    type: 'paragraph',
    children: [{ text: 'alpha' }],
  },
  {
    type: 'paragraph',
    children: [{ text: 'beta' }],
  },
]

const createMoveChildren = (): Descendant[] => [
  {
    type: 'paragraph',
    children: [{ text: 'alpha' }],
  },
  {
    type: 'paragraph',
    children: [{ text: 'beta' }],
  },
]

const createRange = (
  anchor: { path: number[]; offset: number },
  focus: { path: number[]; offset: number }
) => ({
  anchor,
  focus,
})

describe('slate bookmark contract', () => {
  it('round-trips a bookmark on an unchanged snapshot and hides its backing range ref', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: createChildren(),
      selection: null,
      marks: null,
    })

    const range = createRange(
      { path: [0, 0], offset: 1 },
      { path: [0, 0], offset: 4 }
    )
    const bookmark = Editor.bookmark(editor, range)

    assert.equal(Editor.rangeRefs(editor).size, 0)
    assert.deepEqual(bookmark.resolve(), range)
    assert.deepEqual(bookmark.unref(), range)
  })

  it('maps through text inserted before the anchor range without mounted DOM', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: createSplitChildren(),
      selection: null,
      marks: null,
    })

    const bookmark = Editor.bookmark(
      editor,
      createRange({ path: [0, 0], offset: 1 }, { path: [0, 0], offset: 4 })
    )

    editor.update(() => {
      editor.insertText('>', {
        at: { path: [0, 0], offset: 0 },
      })
    })

    assert.deepEqual(bookmark.resolve(), {
      anchor: { path: [0, 0], offset: 2 },
      focus: { path: [0, 0], offset: 5 },
    })
    assert.equal(Editor.string(editor, bookmark.resolve()!), 'lph')
  })

  it('defaults bookmark boundary behavior inward for annotation-style anchors', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: createSplitChildren(),
      selection: null,
      marks: null,
    })

    const bookmark = Editor.bookmark(
      editor,
      createRange({ path: [0, 0], offset: 1 }, { path: [0, 0], offset: 4 })
    )

    editor.update(() => {
      editor.insertText('!', {
        at: { path: [0, 0], offset: 4 },
      })
    })

    assert.deepEqual(bookmark.resolve(), {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 4 },
    })
    assert.equal(Editor.string(editor, bookmark.resolve()!), 'lph')
  })

  it('survives splitNodes block splitting across a bookmarked text span', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: createSplitChildren(),
      selection: null,
      marks: null,
    })

    const bookmark = Editor.bookmark(
      editor,
      createRange({ path: [0, 0], offset: 1 }, { path: [0, 0], offset: 4 })
    )

    editor.update(() => {
      editor.splitNodes({
        at: { path: [0, 0], offset: 2 },
      })
    })

    const resolved = bookmark.resolve()

    assert.ok(resolved)
    assert.equal(Editor.string(editor, resolved), 'lph')
    assert.deepEqual(resolved, {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [1, 0], offset: 2 },
    })
  })

  it('survives merge_node of the bookmarked block container', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: createMergeChildren(),
      selection: null,
      marks: null,
    })

    const bookmark = Editor.bookmark(
      editor,
      createRange({ path: [1, 0], offset: 1 }, { path: [1, 0], offset: 3 })
    )

    editor.applyOperations([
      {
        type: 'merge_node',
        path: [1],
        position: 1,
        properties: { type: 'paragraph' },
      },
    ])

    const resolved = bookmark.resolve()

    assert.ok(resolved)
    assert.deepEqual(resolved, {
      anchor: { path: [0, 1], offset: 1 },
      focus: { path: [0, 1], offset: 3 },
    })
    assert.equal(Editor.string(editor, resolved), 'et')
  })

  it('survives move_node of the containing block', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: createMoveChildren(),
      selection: null,
      marks: null,
    })

    const bookmark = Editor.bookmark(
      editor,
      createRange({ path: [1, 0], offset: 1 }, { path: [1, 0], offset: 3 })
    )

    editor.update(() => {
      editor.moveNodes({ at: [1], to: [0] })
    })

    const resolved = bookmark.resolve()

    assert.ok(resolved)
    assert.deepEqual(resolved, {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 3 },
    })
    assert.equal(Editor.string(editor, resolved), 'et')
  })

  it('rebases across normalization-driven spacer insertion', () => {
    const editor = createEditor()
    editor.isInline = (element) => element.type === 'inline'

    Editor.replace(editor, {
      children: [
        {
          type: 'block',
          children: [{ text: 'gamma' }],
        },
      ],
      selection: null,
      marks: null,
    })

    const bookmark = Editor.bookmark(
      editor,
      createRange({ path: [0, 0], offset: 1 }, { path: [0, 0], offset: 4 })
    )

    editor.update(() => {
      editor.insertNodes(
        {
          type: 'inline',
          children: [{ text: 'beta' }],
        } as Descendant,
        { at: [0, 0] }
      )
    })

    const resolved = bookmark.resolve()

    assert.ok(resolved)
    assert.deepEqual(resolved, {
      anchor: { path: [0, 2], offset: 1 },
      focus: { path: [0, 2], offset: 4 },
    })
    assert.equal(Editor.string(editor, resolved), 'amm')
  })

  it('fails closed when the bookmarked content is fully deleted', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: createChildren(),
      selection: null,
      marks: null,
    })

    const bookmark = Editor.bookmark(
      editor,
      createRange({ path: [1, 0], offset: 1 }, { path: [1, 0], offset: 3 })
    )

    editor.update(() => {
      editor.removeNodes({ at: [1] })
    })

    assert.equal(bookmark.resolve(), null)
  })
})
