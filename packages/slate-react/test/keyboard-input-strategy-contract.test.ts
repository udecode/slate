import { createEditor } from 'slate'
import { describe, expect, it, vi } from 'vitest'
import { editableKeyCommands } from '../src'

import {
  applyEditableKeyDown,
  shouldDeferBackspaceToNativeInput,
} from '../src/editable/keyboard-input-strategy'
import { ReactEditor } from '../src/plugin/react-editor'

const keyEvent = (key: string) =>
  ({
    altKey: false,
    ctrlKey: false,
    key,
    metaKey: false,
    shiftKey: false,
  }) as KeyboardEvent

const reactKeyEvent = (nativeEvent: KeyboardEvent) =>
  ({
    isDefaultPrevented: () => false,
    isPropagationStopped: () => false,
    nativeEvent,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    target: null,
  }) as any

describe('keyboard input strategy', () => {
  it('defers iOS Korean Backspace to native input', () => {
    expect(
      shouldDeferBackspaceToNativeInput({
        isIOS: true,
        language: 'ko-KR',
        nativeEvent: keyEvent('Backspace'),
      })
    ).toBe(true)
  })

  it('keeps non-Korean Backspace model-owned', () => {
    expect(
      shouldDeferBackspaceToNativeInput({
        isIOS: true,
        language: 'en-US',
        nativeEvent: keyEvent('Backspace'),
      })
    ).toBe(false)
  })

  it('keeps non-Backspace keys model-owned for iOS Korean input', () => {
    expect(
      shouldDeferBackspaceToNativeInput({
        isIOS: true,
        language: 'ko-KR',
        nativeEvent: keyEvent('Delete'),
      })
    ).toBe(false)
  })

  it('does not route undo hotkeys while read-only', () => {
    const editor = createEditor() as ReactEditorType
    const undo = vi.fn()
    const forceRender = vi.fn()
    const event = reactKeyEvent({
      ...keyEvent('z'),
      metaKey: true,
    } as KeyboardEvent)

    ;(editor as any).undo = undo

    const result = applyEditableKeyDown({
      androidInputManagerRef: { current: null },
      editor,
      event,
      forceRender,
      inputController: {} as any,
      readOnly: true,
      renderingStrategy: null,
      setComposing: vi.fn(),
      setExplicitShellBackedSelection: vi.fn(),
      shellBackedSelection: false,
    })

    expect(result.handled).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(undo).not.toHaveBeenCalled()
    expect(forceRender).not.toHaveBeenCalled()
  })

  it('routes non-format keydown commands through onCommand before default mutation', () => {
    const editor = createEditor({
      initialValue: [{ children: [{ text: 'test' }] }],
    }) as ReactEditorType
    const event = reactKeyEvent(keyEvent('Enter'))
    const onCommand = vi.fn(() => true)
    const hasEditableTarget = vi
      .spyOn(ReactEditor, 'hasEditableTarget')
      .mockReturnValue(true)
    const isComposing = vi
      .spyOn(ReactEditor, 'isComposing')
      .mockReturnValue(false)

    const result = applyEditableKeyDown({
      androidInputManagerRef: { current: null },
      editor,
      event,
      forceRender: vi.fn(),
      inputController: {} as any,
      onCommand,
      readOnly: false,
      renderingStrategy: null,
      setComposing: vi.fn(),
      setExplicitShellBackedSelection: vi.fn(),
      shellBackedSelection: false,
    })

    expect(result.handled).toBe(true)
    expect(onCommand).toHaveBeenCalledWith(
      { kind: 'insert-break', variant: 'paragraph' },
      expect.objectContaining({
        editor,
        native: false,
      })
    )
    expect(event.preventDefault).toHaveBeenCalled()

    hasEditableTarget.mockRestore()
    isComposing.mockRestore()
  })

  it('runs extension key commands before raw keydown fallback', () => {
    const editor = createEditor({
      initialValue: [{ children: [{ text: 'test' }] }],
    }) as ReactEditorType
    const event = reactKeyEvent(keyEvent('Tab'))
    const keyCommand = vi.fn(() => true)
    const onKeyDown = vi.fn()
    const hasEditableTarget = vi
      .spyOn(ReactEditor, 'hasEditableTarget')
      .mockReturnValue(true)
    const isComposing = vi
      .spyOn(ReactEditor, 'isComposing')
      .mockReturnValue(false)

    editor.extend({
      capabilities: editableKeyCommands(keyCommand),
      name: 'test-key-commands',
    })

    const result = applyEditableKeyDown({
      androidInputManagerRef: { current: null },
      editor,
      event,
      forceRender: vi.fn(),
      inputController: {} as any,
      onKeyDown,
      readOnly: false,
      renderingStrategy: null,
      setComposing: vi.fn(),
      setExplicitShellBackedSelection: vi.fn(),
      shellBackedSelection: false,
    })

    expect(result.handled).toBe(true)
    expect(keyCommand).toHaveBeenCalledWith(
      expect.objectContaining({ editor, event })
    )
    expect(onKeyDown).not.toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalled()

    hasEditableTarget.mockRestore()
    isComposing.mockRestore()
  })
})
