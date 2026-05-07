import { createEditor } from 'slate'
import { Editor } from 'slate/internal'
import { describe, expect, it } from 'vitest'
import type { ReactEditor } from '../src'

import { applyModelOwnedBeforeInputOperation } from '../src/editable/model-input-strategy'

const createTextEditor = (text = '', offset = 0, type = 'paragraph') => {
  const editor = createEditor()

  Editor.replace(editor, {
    children: [{ type, children: [{ text }] }],
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

    expect(Editor.string(editor, [])).toBe('kernel')
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

    expect(Editor.string(editor, [])).toBe('ab!cd')
    expect(Editor.getSelection(editor)).toEqual({
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })
  })

  it('routes Android-style replacement text through model-owned beforeinput', () => {
    const editor = createTextEditor('alpha beta')
    const selection = {
      anchor: { path: [0, 0], offset: 'alpha '.length },
      focus: { path: [0, 0], offset: 'alpha beta'.length },
    }

    Editor.select(editor, selection)

    const repair = applyModelOwnedBeforeInputOperation({
      data: 'omega',
      deferredOperations: { current: [] },
      editor: editor as ReactEditor,
      inputType: 'insertReplacementText',
      native: false,
      selection,
      setComposing: () => {},
    })

    expect(Editor.string(editor, [])).toBe('alpha omega')
    expect(Editor.getSelection(editor)).toEqual({
      anchor: { path: [0, 0], offset: 'alpha omega'.length },
      focus: { path: [0, 0], offset: 'alpha omega'.length },
    })
    expect(repair).toEqual({ kind: 'none' })
  })

  it('replaces an autocorrect prefix without appending after it', () => {
    const editor = createTextEditor('i', 1)
    const insertSelection = Editor.getSelection(editor)

    applyModelOwnedBeforeInputOperation({
      data: 'S',
      deferredOperations: { current: [] },
      editor: editor as ReactEditor,
      inputType: 'insertText',
      native: false,
      selection: insertSelection,
      setComposing: () => {},
    })

    const replacementSelection = {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 1 },
    }

    Editor.select(editor, replacementSelection)

    const repair = applyModelOwnedBeforeInputOperation({
      data: 'I',
      deferredOperations: { current: [] },
      editor: editor as ReactEditor,
      inputType: 'insertReplacementText',
      native: false,
      selection: replacementSelection,
      setComposing: () => {},
    })

    expect(Editor.string(editor, [])).toBe('IS')
    expect(Editor.getSelection(editor)).toEqual({
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 1 },
    })
    expect(repair).toEqual({ kind: 'none' })
  })

  it('splits a custom block on Enter without dropping follow-up text', () => {
    const editor = createTextEditor('Heading', 'Heading'.length, 'heading-one')
    const selection = Editor.getSelection(editor)

    const repair = applyModelOwnedBeforeInputOperation({
      data: null,
      deferredOperations: { current: [] },
      editor: editor as ReactEditor,
      inputType: 'insertParagraph',
      native: false,
      selection,
      setComposing: () => {},
    })

    const [heading, paragraph] = Editor.getChildren(editor) as any[]

    expect(heading.type).toBe('heading-one')
    expect(Editor.string(editor, [0])).toBe('Heading')
    expect(paragraph.type).toBe('heading-one')
    expect(Editor.string(editor, [1])).toBe('')
    expect(Editor.getSelection(editor)).toEqual({
      anchor: { path: [1, 0], offset: 0 },
      focus: { path: [1, 0], offset: 0 },
    })
    expect(repair).toEqual({
      focus: true,
      forceRender: true,
      kind: 'repair-caret',
      selectionSourceTransition: {
        preferModelSelection: true,
        reason: 'model-command',
        selectionSource: 'model-owned',
      },
    })

    applyModelOwnedBeforeInputOperation({
      data: 'A',
      deferredOperations: { current: [] },
      editor: editor as ReactEditor,
      inputType: 'insertText',
      native: false,
      selection: Editor.getSelection(editor),
      setComposing: () => {},
    })

    expect(Editor.string(editor, [1])).toBe('A')
    expect(Editor.getSelection(editor)).toEqual({
      anchor: { path: [1, 0], offset: 1 },
      focus: { path: [1, 0], offset: 1 },
    })
  })

  it('routes Android-style first-line autocorrect through empty-state replacement text', () => {
    const editor = createTextEditor()
    const selection = Editor.getSelection(editor)

    const repair = applyModelOwnedBeforeInputOperation({
      data: 'hello',
      deferredOperations: { current: [] },
      editor: editor as ReactEditor,
      inputType: 'insertReplacementText',
      native: false,
      selection,
      setComposing: () => {},
    })

    expect(Editor.string(editor, [])).toBe('hello')
    expect(Editor.getSelection(editor)).toEqual({
      anchor: { path: [0, 0], offset: 'hello'.length },
      focus: { path: [0, 0], offset: 'hello'.length },
    })
    expect(repair).toEqual({ kind: 'none' })
  })

  it('routes Android-style backspace through model-owned beforeinput', () => {
    const editor = createTextEditor('abcd', 2)
    const selection = Editor.getSelection(editor)

    const repair = applyModelOwnedBeforeInputOperation({
      data: null,
      deferredOperations: { current: [] },
      editor: editor as ReactEditor,
      inputType: 'deleteContentBackward',
      native: false,
      selection,
      setComposing: () => {},
    })

    expect(Editor.string(editor, [])).toBe('acd')
    expect(repair).toEqual({
      focus: true,
      kind: 'repair-caret',
      selectionSourceTransition: {
        preferModelSelection: true,
        reason: 'model-command',
        selectionSource: 'model-owned',
      },
    })
  })

  it('keeps Android-style empty-state backspace from mutating placeholder text', () => {
    const editor = createTextEditor()
    const selection = Editor.getSelection(editor)

    const repair = applyModelOwnedBeforeInputOperation({
      data: null,
      deferredOperations: { current: [] },
      editor: editor as ReactEditor,
      inputType: 'deleteContentBackward',
      native: false,
      selection,
      setComposing: () => {},
    })

    expect(Editor.string(editor, [])).toBe('')
    expect(Editor.getSelection(editor)).toEqual({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })
    expect(repair).toEqual({
      focus: true,
      kind: 'repair-caret',
      selectionSourceTransition: {
        preferModelSelection: true,
        reason: 'model-command',
        selectionSource: 'model-owned',
      },
    })
  })

  it('replaces expanded CJK composition selection once', () => {
    const editor = createTextEditor('prefix stale suffix')
    const selection = {
      anchor: { path: [0, 0], offset: 'prefix '.length },
      focus: { path: [0, 0], offset: 'prefix stale'.length },
    }

    Editor.select(editor, selection)

    const repair = applyModelOwnedBeforeInputOperation({
      data: '中文',
      deferredOperations: { current: [] },
      editor: editor as ReactEditor,
      inputType: 'insertFromComposition',
      native: false,
      selection,
      setComposing: () => {},
    })

    expect(Editor.string(editor, [])).toBe('prefix 中文 suffix')
    expect(Editor.getSelection(editor)).toEqual({
      anchor: { path: [0, 0], offset: 'prefix 中文'.length },
      focus: { path: [0, 0], offset: 'prefix 中文'.length },
    })
    expect(repair).toEqual({ kind: 'none' })
  })

  it('deletes expanded CJK composition selection once', () => {
    const editor = createTextEditor('中文')
    const selection = {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 2 },
    }

    Editor.select(editor, selection)

    const repair = applyModelOwnedBeforeInputOperation({
      data: null,
      deferredOperations: { current: [] },
      editor: editor as ReactEditor,
      inputType: 'deleteByComposition',
      native: false,
      selection,
      setComposing: () => {},
    })

    expect(Editor.string(editor, [])).toBe('中')
    expect(Editor.getSelection(editor)).toEqual({
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 1 },
    })
    expect(repair).toEqual({
      focus: true,
      kind: 'repair-caret',
      selectionSourceTransition: {
        preferModelSelection: true,
        reason: 'model-command',
        selectionSource: 'model-owned',
      },
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

    expect(Editor.string(editor, [])).toBe('ad')
  })
})
