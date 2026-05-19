import { createEditor } from 'slate'
import { describe, expect, it, vi } from 'vitest'

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

  it('applies model-owned keydown commands without a public onCommand hook', () => {
    const editor = createEditor({
      initialValue: [{ children: [{ text: 'test' }] }],
    }) as ReactEditorType
    const event = reactKeyEvent(keyEvent('Enter'))
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
      readOnly: false,
      renderingStrategy: null,
      setComposing: vi.fn(),
      setExplicitShellBackedSelection: vi.fn(),
      shellBackedSelection: false,
    })

    expect(result.handled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()

    hasEditableTarget.mockRestore()
    isComposing.mockRestore()
  })

  it('runs raw keydown before model fallback', () => {
    const editor = createEditor({
      initialValue: [{ children: [{ text: 'test' }] }],
    }) as ReactEditorType
    const event = reactKeyEvent(keyEvent('Tab'))
    const onKeyDown = vi.fn(() => true)
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
      onKeyDown,
      readOnly: false,
      renderingStrategy: null,
      setComposing: vi.fn(),
      setExplicitShellBackedSelection: vi.fn(),
      shellBackedSelection: false,
    })

    expect(result.handled).toBe(true)
    expect(onKeyDown).toHaveBeenCalledWith(event, { editor })
    expect(event.preventDefault).toHaveBeenCalled()

    hasEditableTarget.mockRestore()
    isComposing.mockRestore()
  })

  it('keeps DeleteForward direction in the Chrome/WebKit void-node fallback', async () => {
    vi.resetModules()

    const applyEditableCommand = vi.fn(() => true)

    vi.doMock('slate-dom', async (importOriginal) => {
      const actual = await importOriginal<typeof import('slate-dom')>()

      return {
        ...actual,
        HAS_BEFORE_INPUT_SUPPORT: true,
        IS_CHROME: true,
        IS_WEBKIT: false,
      }
    })
    vi.doMock('../src/editable/editing-kernel', async (importOriginal) => {
      const actual =
        await importOriginal<typeof import('../src/editable/editing-kernel')>()

      return {
        ...actual,
        getEditableCommandFromKeyDown: vi.fn(() => null),
      }
    })
    vi.doMock('../src/editable/mutation-controller', async (importOriginal) => {
      const actual =
        await importOriginal<
          typeof import('../src/editable/mutation-controller')
        >()

      return {
        ...actual,
        applyEditableCommand,
      }
    })

    try {
      const [
        { createEditor, defineEditorExtension },
        { ReactEditor },
        { applyEditableKeyDown },
      ] = await Promise.all([
        import('slate'),
        import('../src/plugin/react-editor'),
        import('../src/editable/keyboard-input-strategy'),
      ])
      const editor = createEditor({
        extensions: [
          defineEditorExtension({
            elements: [{ type: 'image', void: 'block' }],
            name: 'keyboard-input-strategy-void-test',
          }),
        ],
        initialSelection: {
          anchor: { path: [0, 0], offset: 0 },
          focus: { path: [0, 0], offset: 0 },
        },
        initialValue: [{ type: 'image', children: [{ text: '' }] }],
      }) as ReactEditorType
      const event = reactKeyEvent(keyEvent('Delete'))
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
        readOnly: false,
        renderingStrategy: null,
        setComposing: vi.fn(),
        setExplicitShellBackedSelection: vi.fn(),
        shellBackedSelection: false,
      })

      expect(result.handled).toBe(true)
      expect(event.preventDefault).toHaveBeenCalled()
      expect(applyEditableCommand).toHaveBeenCalledWith({
        command: { direction: 'forward', kind: 'delete', unit: 'block' },
        editor,
      })

      hasEditableTarget.mockRestore()
      isComposing.mockRestore()
    } finally {
      vi.doUnmock('slate-dom')
      vi.doUnmock('../src/editable/editing-kernel')
      vi.doUnmock('../src/editable/mutation-controller')
      vi.resetModules()
    }
  })
})
