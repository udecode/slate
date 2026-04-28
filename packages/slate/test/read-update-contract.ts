import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createEditor, type Descendant, Editor } from '../src'

const paragraph = (text: string): Descendant => ({
  type: 'paragraph',
  children: [{ text }],
})

describe('read/update contract', () => {
  it('exposes a coherent read boundary and an update boundary with commit tags', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [paragraph('one')],
      selection: {
        anchor: { path: [0, 0], offset: 3 },
        focus: { path: [0, 0], offset: 3 },
      },
    })

    const state = editor.read(() => ({
      children: editor.getChildren(),
      selection: editor.getSelection(),
    }))

    assert.deepEqual(state.children, [paragraph('one')])
    assert.deepEqual(state.selection, {
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })

    editor.update(
      () => {
        editor.insertText('!')
      },
      { tag: ['history-push', 'paste'] }
    )

    assert.equal(Editor.string(editor, []), 'one!')

    const commit = Editor.getLastCommit(editor)

    assert(commit)
    assert.deepEqual(commit.classes, ['text'])
    assert.deepEqual(commit.tags, ['history-push', 'paste'])
  })

  it('rejects starting an update inside a plain read', () => {
    const editor = createEditor()

    assert.throws(
      () =>
        Editor.read(editor, () => {
          Editor.update(editor, () => {
            editor.insertText('x')
          })
        }),
      /editor\.update cannot be started inside editor\.read/
    )
  })

  it('rejects direct primitive writes inside a plain read', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [paragraph('one')],
      selection: {
        anchor: { path: [0, 0], offset: 3 },
        focus: { path: [0, 0], offset: 3 },
      },
    })

    assert.throws(
      () =>
        editor.read(() => {
          editor.insertText('!')
        }),
      /editor writes cannot be started inside editor\.read/
    )
  })

  it('rejects compatibility transform writes inside a plain read', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [paragraph('one')],
      selection: {
        anchor: { path: [0, 0], offset: 3 },
        focus: { path: [0, 0], offset: 3 },
      },
    })

    assert.throws(
      () =>
        editor.read(() => {
          editor.insertText('!')
        }),
      /editor writes cannot be started inside editor\.read/
    )
  })

  it('rejects replay writes inside a plain read', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [paragraph('one')],
      selection: {
        anchor: { path: [0, 0], offset: 3 },
        focus: { path: [0, 0], offset: 3 },
      },
    })

    assert.throws(
      () =>
        editor.read(() => {
          editor.applyOperations([
            {
              offset: 3,
              path: [0, 0],
              text: '!',
              type: 'insert_text',
            },
          ])
        }),
      /editor\.update cannot be started inside editor\.read/
    )
  })
})
