import { createEditor } from 'slate'
import { describe, expect, it, vi } from 'vitest'
import type { ReactEditor } from '../src'

import {
  applyEditableKeyDown,
  shouldDeferBackspaceToNativeInput,
} from '../src/editable/keyboard-input-strategy'

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
    const editor = createEditor() as ReactEditor
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
})
