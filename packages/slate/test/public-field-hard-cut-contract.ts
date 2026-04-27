import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createEditor, Editor, type Editor as EditorType } from '../src'

type PublicStateKeys = Extract<
  keyof EditorType,
  'children' | 'marks' | 'operations' | 'selection'
>

const editorHasNoPublicStateKeys: PublicStateKeys extends never ? true : never =
  true

describe('public editor field hard cuts', () => {
  void editorHasNoPublicStateKeys

  it('does not expose stale state mirrors on editor instances', () => {
    const editor = createEditor()

    for (const property of [
      'children',
      'selection',
      'marks',
      'operations',
    ] as const) {
      assert.equal(property in editor, false)
      assert.equal((editor as Record<string, unknown>)[property], undefined)
    }
  })

  it('keeps explicit lifecycle methods as the write path', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [{ text: 'alpha' }],
        },
      ],
      selection: {
        anchor: { path: [0, 0], offset: 5 },
        focus: { path: [0, 0], offset: 5 },
      },
      marks: null,
    })

    editor.update(() => {
      editor.insertText('!')
    })

    assert.equal(Editor.string(editor, []), 'alpha!')
    assert.deepEqual(editor.getSelection(), {
      anchor: { path: [0, 0], offset: 6 },
      focus: { path: [0, 0], offset: 6 },
    })
    assert.equal(editor.getOperations().length, 1)
  })
})
