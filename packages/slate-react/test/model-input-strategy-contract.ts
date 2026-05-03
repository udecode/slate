import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createEditor } from 'slate'
import { Editor } from 'slate/internal'
import type { ReactEditor } from '../src'

import { applyModelOwnedBeforeInputOperation } from '../src/editable/model-input-strategy'

const createTextEditor = (text = '', offset = 0) => {
  const editor = createEditor()

  Editor.replace(editor, {
    children: [{ type: 'paragraph', children: [{ text }] }],
    marks: null,
    selection: {
      anchor: { path: [0, 0], offset },
      focus: { path: [0, 0], offset },
    },
  })

  return editor
}

describe('model input strategy', () => {
  it('executes the prepared beforeinput command instead of reparsing event data', () => {
    const editor = createTextEditor()

    applyModelOwnedBeforeInputOperation({
      command: {
        inputType: 'insertText',
        kind: 'insert-text',
        text: 'kernel',
      },
      data: 'event',
      deferredOperations: { current: [] },
      editor: editor as ReactEditor,
      inputType: 'insertText',
      native: false,
      selection: Editor.getSelection(editor),
      setComposing: () => {},
    })

    assert.equal(Editor.string(editor, []), 'kernel')
  })

  it('uses the synced collapsed selection for model-owned insertText', () => {
    const editor = createTextEditor('abcd', 2)
    const selection = Editor.getSelection(editor)

    applyModelOwnedBeforeInputOperation({
      command: {
        inputType: 'insertText',
        kind: 'insert-text',
        text: '!',
      },
      data: '!',
      deferredOperations: { current: [] },
      editor: editor as ReactEditor,
      inputType: 'insertText',
      native: false,
      selection,
      setComposing: () => {},
    })

    assert.equal(Editor.string(editor, []), 'ab!cd')
    assert.deepEqual(Editor.getSelection(editor), {
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })
  })

  it('refreshes selection-dependent delete commands after DOM selection import', () => {
    const editor = createTextEditor('abcd', 2)
    const selection = {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 3 },
    }

    Editor.select(editor, selection)

    applyModelOwnedBeforeInputOperation({
      command: { direction: 'backward', kind: 'delete' },
      data: null,
      deferredOperations: { current: [] },
      editor: editor as ReactEditor,
      inputType: 'deleteContentBackward',
      native: false,
      selection,
      setComposing: () => {},
    })

    assert.equal(Editor.string(editor, []), 'ad')
  })
})
