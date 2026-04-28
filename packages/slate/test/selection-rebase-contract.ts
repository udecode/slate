import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createEditor, type Descendant, Editor } from '../src'

const paragraphWithEmptySuffixLeaves = (): Descendant => ({
  type: 'paragraph',
  children: [
    { text: 'This is editable ' },
    { bold: true, text: 'rich' },
    { text: ' text, ' },
    { italic: true, text: 'much' },
    { text: ' ' },
    { code: true, text: '' },
    { text: '' },
  ],
})

const paragraphWithPunctuationSuffixLeaf = (): Descendant => ({
  type: 'paragraph',
  children: [
    { text: 'This is editable ' },
    { code: true, text: '<textarea>' },
    { text: '!' },
  ],
})

describe('selection rebase contract', () => {
  it('rebases selection out of a removable empty marked leaf during destructive cleanup', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [paragraphWithEmptySuffixLeaves()],
      selection: {
        anchor: { path: [0, 5], offset: 0 },
        focus: { path: [0, 5], offset: 0 },
      },
    })

    editor.update(() => {
      editor.delete({ reverse: true, unit: 'character' })
    })

    assert.equal(Editor.string(editor, [0]), 'This is editable rich text, much')
    assert.deepEqual(Editor.getSelection(editor), {
      anchor: { path: [0, 3], offset: 4 },
      focus: { path: [0, 3], offset: 4 },
    })
  })

  it('rebases forward delete of a suffix leaf to the previous surviving point in the same block', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        paragraphWithPunctuationSuffixLeaf(),
        {
          type: 'paragraph',
          children: [{ text: 'next paragraph' }],
        },
      ],
      selection: {
        anchor: { path: [0, 2], offset: 0 },
        focus: { path: [0, 2], offset: 0 },
      },
    })

    editor.update(() => {
      editor.delete({ unit: 'character' })
    })

    assert.equal(Editor.string(editor, [0]), 'This is editable <textarea>')
    assert.deepEqual(Editor.getSelection(editor), {
      anchor: { path: [0, 1], offset: '<textarea>'.length },
      focus: { path: [0, 1], offset: '<textarea>'.length },
    })
  })
})
