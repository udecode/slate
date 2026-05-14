import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createEditor } from 'slate'
import { Editor } from '../src/editable/runtime-editor-api'
import { syncSelectionForBeforeInput } from '../src/editable/selection-reconciler'
import { ReactEditor } from '../src/plugin/react-editor'

const createRootWithoutSelection = () =>
  ({ getSelection: () => null }) as unknown as Document

const createTextEditor = () => {
  const editor = createEditor()

  Editor.replace(editor, {
    children: [
      { type: 'paragraph', children: [{ text: 'one' }] },
      { type: 'paragraph', children: [{ text: 'two' }] },
    ],
    marks: null,
    selection: {
      anchor: { path: [1, 0], offset: 1 },
      focus: { path: [1, 0], offset: 1 },
    },
  })

  return editor
}

describe('selection reconciler', () => {
  it('does not scan the whole document for a valid model-owned text insertion', () => {
    const editor = createTextEditor()
    const selection = Editor.getSelection(editor)
    const originalString = Editor.string

    try {
      Editor.string = () => {
        throw new Error('unexpected root string scan')
      }

      const result = syncSelectionForBeforeInput({
        allowDOMSelectionImport: false,
        data: 'x',
        editor: editor as ReactEditor,
        editorElement: {} as HTMLElement,
        event: { getTargetRanges: () => [] } as unknown as InputEvent,
        inputType: 'insertText',
        isCompositionChange: false,
        native: false,
        preferModelSelectionForInput: true,
        root: createRootWithoutSelection(),
        selection,
      })

      assert.deepEqual(result.selection, selection)
      assert.equal(result.native, false)
    } finally {
      Editor.string = originalString
    }
  })

  it('imports expanded delete target ranges from blur-time IME cleanup events', () => {
    const editor = createTextEditor()
    const selection = Editor.getSelection(editor)
    const targetRange = {} as StaticRange
    const targetSlateRange = {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 3 },
    }
    const originalHasSelectableTarget = ReactEditor.hasSelectableTarget
    const originalResolveSlateRange = ReactEditor.resolveSlateRange

    try {
      ReactEditor.hasSelectableTarget = () => true
      ReactEditor.resolveSlateRange = () => targetSlateRange

      const result = syncSelectionForBeforeInput({
        allowDOMSelectionImport: true,
        data: null,
        editor: editor as ReactEditor,
        editorElement: {} as HTMLElement,
        event: {
          getTargetRanges: () => [targetRange],
        } as unknown as InputEvent,
        inputType: 'deleteContentBackward',
        isCompositionChange: false,
        native: false,
        preferModelSelectionForInput: false,
        root: createRootWithoutSelection(),
        selection,
      })

      assert.deepEqual(result.selection, targetSlateRange)
      assert.deepEqual(Editor.getSelection(editor), targetSlateRange)
    } finally {
      ReactEditor.hasSelectableTarget = originalHasSelectableTarget
      ReactEditor.resolveSlateRange = originalResolveSlateRange
    }
  })

  it('imports expanded insertText target ranges for browser text substitutions', () => {
    const editor = createTextEditor()
    const selection = Editor.getSelection(editor)
    const targetRange = {} as StaticRange
    const targetSlateRange = {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 3 },
    }
    const originalHasSelectableTarget = ReactEditor.hasSelectableTarget
    const originalResolveSlateRange = ReactEditor.resolveSlateRange

    try {
      ReactEditor.hasSelectableTarget = () => true
      ReactEditor.resolveSlateRange = () => targetSlateRange

      const result = syncSelectionForBeforeInput({
        allowDOMSelectionImport: true,
        data: '. ',
        editor: editor as ReactEditor,
        editorElement: {} as HTMLElement,
        event: {
          getTargetRanges: () => [targetRange],
        } as unknown as InputEvent,
        inputType: 'insertText',
        isCompositionChange: false,
        native: false,
        preferModelSelectionForInput: true,
        root: createRootWithoutSelection(),
        selection,
      })

      assert.deepEqual(result.selection, targetSlateRange)
      assert.deepEqual(Editor.getSelection(editor), targetSlateRange)
    } finally {
      ReactEditor.hasSelectableTarget = originalHasSelectableTarget
      ReactEditor.resolveSlateRange = originalResolveSlateRange
    }
  })
})
