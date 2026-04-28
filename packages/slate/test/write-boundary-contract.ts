import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createEditor, Editor } from '../src'

describe('editor write boundary', () => {
  const createSeededEditor = () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [{ text: 'one' }],
        },
      ],
      selection: {
        anchor: { path: [0, 0], offset: 3 },
        focus: { path: [0, 0], offset: 3 },
      },
      marks: null,
    })

    return editor
  }

  it('rejects direct primitive writes outside editor.update', () => {
    const cases: [string, (editor: ReturnType<typeof createEditor>) => void][] =
      [
        ['insertText', (editor) => editor.insertText('!')],
        ['setNodes', (editor) => editor.setNodes({ type: 'heading-one' })],
        ['delete', (editor) => editor.delete()],
        ['removeNodes', (editor) => editor.removeNodes({ at: [0] })],
        [
          'select',
          (editor) =>
            editor.select({
              anchor: { path: [0, 0], offset: 0 },
              focus: { path: [0, 0], offset: 3 },
            }),
        ],
      ]

    for (const [name, write] of cases) {
      const editor = createSeededEditor()

      assert.throws(
        () => write(editor),
        /editor writes must run inside editor\.update/,
        name
      )
      assert.equal(Editor.string(editor, []), 'one', name)
      assert.equal(Editor.getLastCommit(editor)?.classes[0], 'replace', name)
    }
  })

  it('keeps applyOperations as the explicit operation replay writer', () => {
    const editor = createSeededEditor()

    assert.equal('apply' in editor, false)

    editor.applyOperations([
      {
        offset: 3,
        path: [0, 0],
        text: '!',
        type: 'insert_text',
      },
    ])

    const commit = Editor.getLastCommit(editor)

    assert(commit)
    assert.equal(Editor.string(editor, []), 'one!')
    assert.deepEqual(commit.classes, ['text'])
    assert.equal(commit.operations.length, 1)
  })

  it('routes implicit writes through editor.update and primitive methods', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [{ text: 'one' }],
        },
        {
          type: 'paragraph',
          children: [{ text: 'two' }],
        },
      ],
      selection: {
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 3 },
      },
      marks: null,
    })

    editor.update(() => {
      editor.setNodes({ type: 'heading-one' })
      editor.insertText('TWO')
    })

    const snapshot = editor.getSnapshot()

    assert.equal(snapshot.children[0].type, 'paragraph')
    assert.equal(snapshot.children[1].type, 'heading-one')
    assert.equal(Editor.string(editor, [1]), 'TWO')
    assert.deepEqual(snapshot.selection, {
      anchor: { path: [1, 0], offset: 3 },
      focus: { path: [1, 0], offset: 3 },
    })
  })
})
