import { describe, expect, it } from 'vitest'

import { shouldDeferBackspaceToNativeInput } from '../src/editable/keyboard-input-strategy'

const keyEvent = (key: string) =>
  ({
    altKey: false,
    ctrlKey: false,
    key,
    metaKey: false,
    shiftKey: false,
  }) as KeyboardEvent

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
})
