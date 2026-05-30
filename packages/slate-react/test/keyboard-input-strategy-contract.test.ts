import {
  createEditor,
  createEditorRuntime,
  createEditorView,
  type Descendant,
} from 'slate'
import { Hotkeys } from 'slate-dom'
import { DOMCoverage } from 'slate-dom/internal'
import { history } from 'slate-history'
import { describe, expect, it, vi } from 'vitest'
import { resolveHistoryFocusEditor } from '../src/editable/history-focus'
import {
  applyEditableKeyDown,
  shouldDeferBackspaceToNativeInput,
} from '../src/editable/keyboard-input-strategy'
import { ReactEditor } from '../src/plugin/react-editor'
import { createSlateProjectionGraph } from '../src/projection-graph'
import {
  createSlateViewSelection,
  writeSlateViewSelection,
} from '../src/view-selection'

const keyEvent = (
  key: string,
  options: Partial<
    Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>
  > = {}
) =>
  ({
    altKey: false,
    ctrlKey: false,
    key,
    metaKey: false,
    shiftKey: false,
    ...options,
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

const paragraph = (text: string) =>
  ({
    type: 'paragraph',
    children: [{ text }],
  }) satisfies Descendant

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
    const hasEditableTarget = vi
      .spyOn(ReactEditor, 'hasEditableTarget')
      .mockReturnValue(true)

    try {
      const result = applyEditableKeyDown({
        androidInputManagerRef: { current: null },
        editor,
        event,
        forceRender,
        inputController: {} as any,
        readOnly: true,
        domStrategyRuntime: null,
        setComposing: vi.fn(),
        setExplicitPartialDOMBackedSelection: vi.fn(),
        partialDOMBackedSelection: false,
      })

      expect(result.handled).toBe(true)
      expect(result.repair).toEqual({
        forceRender: true,
        kind: 'force-render',
      })
      expect(event.preventDefault).toHaveBeenCalled()
      expect(undo).not.toHaveBeenCalled()
      expect(forceRender).not.toHaveBeenCalled()
    } finally {
      hasEditableTarget.mockRestore()
    }
  })

  it('prevents printable native key defaults while read-only', () => {
    const editor = createEditor() as ReactEditorType
    const forceRender = vi.fn()
    const event = reactKeyEvent(keyEvent('a'))
    const hasEditableTarget = vi
      .spyOn(ReactEditor, 'hasEditableTarget')
      .mockReturnValue(true)

    try {
      const result = applyEditableKeyDown({
        androidInputManagerRef: { current: null },
        editor,
        event,
        forceRender,
        inputController: {} as any,
        readOnly: true,
        domStrategyRuntime: null,
        setComposing: vi.fn(),
        setExplicitPartialDOMBackedSelection: vi.fn(),
        partialDOMBackedSelection: false,
      })

      expect(result.handled).toBe(true)
      expect(result.repair).toEqual({
        forceRender: true,
        kind: 'force-render',
      })
      expect(event.preventDefault).toHaveBeenCalled()
      expect(forceRender).not.toHaveBeenCalled()
    } finally {
      hasEditableTarget.mockRestore()
    }
  })

  it('does not apply projected destructive commands while read-only', () => {
    const editor = createEditor({
      initialSelection: {
        anchor: { path: [0, 0], offset: 1 },
        focus: { path: [0, 0], offset: 3 },
      },
      initialValue: [paragraph('test')],
    }) as ReactEditorType
    const root = document.createElement('div')
    const nested = document.createElement('div')
    const graph = createSlateProjectionGraph([{ path: [0], root: 'main' }])
    const event = reactKeyEvent(keyEvent('Backspace'))
    const assertDOMNode = vi
      .spyOn(ReactEditor, 'assertDOMNode')
      .mockReturnValue(root)
    const hasEditableTarget = vi
      .spyOn(ReactEditor, 'hasEditableTarget')
      .mockReturnValue(false)

    root.dataset.slateEditor = 'true'
    nested.dataset.slateEditor = 'true'
    root.append(nested)
    document.body.append(root)
    event.target = nested
    writeSlateViewSelection(
      editor,
      createSlateViewSelection(graph, {
        anchor: { point: { path: [0, 0], offset: 1 } },
        focus: { point: { path: [0, 0], offset: 3 } },
      })
    )

    try {
      const result = applyEditableKeyDown({
        androidInputManagerRef: { current: null },
        editor,
        event,
        forceRender: vi.fn(),
        inputController: {} as any,
        readOnly: true,
        domStrategyRuntime: null,
        setComposing: vi.fn(),
        setExplicitPartialDOMBackedSelection: vi.fn(),
        partialDOMBackedSelection: false,
      })

      expect(result.handled).toBe(true)
      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(event.stopPropagation).toHaveBeenCalled()
      expect(editor.read((state) => state.value.get().roots.main)).toEqual([
        paragraph('test'),
      ])
    } finally {
      root.remove()
      assertDOMNode.mockRestore()
      hasEditableTarget.mockRestore()
    }
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
      domStrategyRuntime: null,
      setComposing: vi.fn(),
      setExplicitPartialDOMBackedSelection: vi.fn(),
      partialDOMBackedSelection: false,
    })

    expect(result.handled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()

    hasEditableTarget.mockRestore()
    isComposing.mockRestore()
  })

  it("repairs history focus to the preserved selection root when undoing another root's batch", () => {
    const runtime = createEditorRuntime({
      extensions: [history()],
      initialValue: {
        roots: {
          header: [paragraph('header')],
          main: [paragraph('body')],
        },
      },
    })
    const headerEditor = createEditorView(runtime, { root: 'header' })
    const mainEditor = createEditorView(runtime, { root: 'main' })
    const getMountedViewEditor = vi.fn(() => null)
    const hasEditableTarget = vi
      .spyOn(ReactEditor, 'hasEditableTarget')
      .mockReturnValue(true)
    const isComposing = vi
      .spyOn(ReactEditor, 'isComposing')
      .mockReturnValue(false)

    headerEditor.update((tx) => {
      tx.selection.set({
        anchor: { path: [0, 0], offset: 'header'.length },
        focus: { path: [0, 0], offset: 'header'.length },
      })
      tx.text.insert('!')
    })
    mainEditor.update((tx) => {
      tx.selection.set({
        anchor: { path: [0, 0], offset: 'body'.length },
        focus: { path: [0, 0], offset: 'body'.length },
      })
      tx.text.insert('?')
    })

    try {
      for (let index = 0; index < 2; index++) {
        const event = reactKeyEvent(keyEvent('z', { ctrlKey: true }))

        applyEditableKeyDown({
          androidInputManagerRef: { current: null },
          editor: mainEditor as ReactEditorType,
          event,
          forceRender: vi.fn(),
          getMountedViewEditor,
          inputController: {} as any,
          readOnly: false,
          domStrategyRuntime: null,
          setComposing: vi.fn(),
          setExplicitPartialDOMBackedSelection: vi.fn(),
          partialDOMBackedSelection: false,
        })
      }

      expect(getMountedViewEditor).toHaveBeenLastCalledWith('main')
      expect(mainEditor.read((state) => state.selection.get())).toEqual({
        anchor: { path: [0, 0], offset: 'body'.length },
        focus: { path: [0, 0], offset: 'body'.length },
      })
      expect(headerEditor.read((state) => state.selection.get())).toBe(null)
    } finally {
      hasEditableTarget.mockRestore()
      isComposing.mockRestore()
    }
  })

  it('repairs history focus to the history root when undo leaves no selection', () => {
    const currentEditor = {} as any
    const historyEditor = {} as any
    const getMountedViewEditor = vi.fn((root: string) =>
      root === 'header' ? historyEditor : currentEditor
    )

    expect(
      resolveHistoryFocusEditor({
        currentRoot: 'main',
        editor: currentEditor,
        getMountedViewEditor,
        historyRoot: 'header',
        selectionRoot: null,
      })
    ).toBe(historyEditor)
    expect(getMountedViewEditor).toHaveBeenLastCalledWith('header')
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
      domStrategyRuntime: null,
      setComposing: vi.fn(),
      setExplicitPartialDOMBackedSelection: vi.fn(),
      partialDOMBackedSelection: false,
    })

    expect(result.handled).toBe(true)
    expect(onKeyDown).toHaveBeenCalledWith(event, { editor })
    expect(event.preventDefault).toHaveBeenCalled()

    hasEditableTarget.mockRestore()
    isComposing.mockRestore()
  })

  it('does not swallow printable keys for an unmounted selected root', () => {
    const editor = createEditor({
      initialSelection: {
        anchor: { path: [0, 0], offset: 0, root: 'caption' },
        focus: { path: [0, 0], offset: 0, root: 'caption' },
      },
      initialValue: [{ children: [{ text: 'main' }] }],
    }) as ReactEditorType
    const event = reactKeyEvent(keyEvent('a'))
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
      getMountedViewEditor: () => null,
      inputController: {} as any,
      readOnly: false,
      domStrategyRuntime: null,
      setComposing: vi.fn(),
      setExplicitPartialDOMBackedSelection: vi.fn(),
      partialDOMBackedSelection: false,
    })

    expect(result.handled).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()

    hasEditableTarget.mockRestore()
    isComposing.mockRestore()
  })

  it('keeps ArrowRight at a boundary-policy hidden range edge', () => {
    const editor = createEditor({
      initialSelection: {
        anchor: { path: [0, 0, 0], offset: 'Overview tab visible text'.length },
        focus: { path: [0, 0, 0], offset: 'Overview tab visible text'.length },
      },
      initialValue: [
        {
          type: 'tabs-block',
          children: [
            {
              type: 'tab-panel',
              children: [{ text: 'Overview tab visible text' }],
            },
            {
              type: 'tab-panel',
              children: [{ text: 'Details tab hidden text' }],
            },
          ],
        },
      ],
    }) as ReactEditorType
    const event = reactKeyEvent(keyEvent('ArrowRight'))
    const hasEditableTarget = vi
      .spyOn(ReactEditor, 'hasEditableTarget')
      .mockReturnValue(true)
    const isComposing = vi
      .spyOn(ReactEditor, 'isComposing')
      .mockReturnValue(false)

    DOMCoverage.registerBoundary(editor, {
      anchor: { type: 'placeholder' },
      boundaryId: 'inactive-tab',
      copyPolicy: 'include-model',
      coveredPathRanges: [{ anchor: [0, 1], focus: [0, 1] }],
      coveredRuntimeRanges: [],
      findPolicy: 'not-native-until-mounted',
      ownerPath: [],
      ownerRuntimeId: null,
      reason: 'app-hidden',
      selectionPolicy: 'boundary',
      state: 'intentionally-hidden',
      version: 1,
    })

    try {
      const result = applyEditableKeyDown({
        androidInputManagerRef: { current: null },
        editor,
        event,
        forceRender: vi.fn(),
        inputController: {} as any,
        readOnly: false,
        domStrategyRuntime: null,
        setComposing: vi.fn(),
        setExplicitPartialDOMBackedSelection: vi.fn(),
        partialDOMBackedSelection: false,
      })

      expect(result.handled).toBe(true)
      expect(event.preventDefault).toHaveBeenCalled()
      expect(editor.read((state) => state.selection.get())).toEqual({
        anchor: {
          offset: 'Overview tab visible text'.length,
          path: [0, 0, 0],
        },
        focus: {
          offset: 'Overview tab visible text'.length,
          path: [0, 0, 0],
        },
      })
    } finally {
      DOMCoverage.clear(editor)
      hasEditableTarget.mockRestore()
      isComposing.mockRestore()
    }
  })

  it('skips boundary-policy hidden ranges when moving forward from preceding visible text', () => {
    const intro = 'Intro visible before hidden blocks.'
    const editor = createEditor({
      initialSelection: {
        anchor: { path: [0, 0], offset: intro.length },
        focus: { path: [0, 0], offset: intro.length },
      },
      initialValue: [
        {
          type: 'paragraph',
          children: [{ text: intro }],
        },
        {
          type: 'accordion-block',
          children: [
            {
              type: 'paragraph',
              children: [{ text: 'Accordion secret alpha' }],
            },
            {
              type: 'paragraph',
              children: [{ text: 'Accordion secret beta' }],
            },
          ],
        },
        {
          type: 'paragraph',
          children: [{ text: 'Next visible paragraph.' }],
        },
      ],
    }) as ReactEditorType
    const event = reactKeyEvent(keyEvent('ArrowRight'))
    const hasEditableTarget = vi
      .spyOn(ReactEditor, 'hasEditableTarget')
      .mockReturnValue(true)
    const isComposing = vi
      .spyOn(ReactEditor, 'isComposing')
      .mockReturnValue(false)

    DOMCoverage.registerBoundary(editor, {
      anchor: { type: 'placeholder' },
      boundaryId: 'closed-accordion',
      copyPolicy: 'include-model',
      coveredPathRanges: [{ anchor: [1, 0], focus: [1, 1] }],
      coveredRuntimeRanges: [],
      findPolicy: 'not-native-until-mounted',
      ownerPath: [],
      ownerRuntimeId: null,
      reason: 'app-hidden',
      selectionPolicy: 'boundary',
      state: 'intentionally-hidden',
      version: 1,
    })

    try {
      const result = applyEditableKeyDown({
        androidInputManagerRef: { current: null },
        editor,
        event,
        forceRender: vi.fn(),
        inputController: {} as any,
        readOnly: false,
        domStrategyRuntime: null,
        setComposing: vi.fn(),
        setExplicitPartialDOMBackedSelection: vi.fn(),
        partialDOMBackedSelection: false,
      })

      expect(result.handled).toBe(true)
      expect(event.preventDefault).toHaveBeenCalled()
      expect(editor.read((state) => state.selection.get())).toEqual({
        anchor: { offset: 0, path: [2, 0] },
        focus: { offset: 0, path: [2, 0] },
      })
    } finally {
      DOMCoverage.clear(editor)
      hasEditableTarget.mockRestore()
      isComposing.mockRestore()
    }
  })

  it('extends to the next visible character when extending forward across boundary-policy hidden ranges', () => {
    const intro = 'Intro visible before hidden blocks.'
    const editor = createEditor({
      initialSelection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: intro.length },
      },
      initialValue: [
        {
          type: 'paragraph',
          children: [{ text: intro }],
        },
        {
          type: 'accordion-block',
          children: [
            {
              type: 'paragraph',
              children: [{ text: 'Accordion secret alpha' }],
            },
          ],
        },
        {
          type: 'paragraph',
          children: [{ text: 'Next visible paragraph.' }],
        },
      ],
    }) as ReactEditorType
    const event = reactKeyEvent(keyEvent('ArrowRight', { shiftKey: true }))
    const hasEditableTarget = vi
      .spyOn(ReactEditor, 'hasEditableTarget')
      .mockReturnValue(true)
    const isComposing = vi
      .spyOn(ReactEditor, 'isComposing')
      .mockReturnValue(false)

    DOMCoverage.registerBoundary(editor, {
      anchor: { type: 'placeholder' },
      boundaryId: 'closed-accordion',
      copyPolicy: 'include-model',
      coveredPathRanges: [{ anchor: [1, 0], focus: [1, 0] }],
      coveredRuntimeRanges: [],
      findPolicy: 'not-native-until-mounted',
      ownerPath: [],
      ownerRuntimeId: null,
      reason: 'app-hidden',
      selectionPolicy: 'boundary',
      state: 'intentionally-hidden',
      version: 1,
    })

    try {
      const result = applyEditableKeyDown({
        androidInputManagerRef: { current: null },
        editor,
        event,
        forceRender: vi.fn(),
        inputController: {} as any,
        readOnly: false,
        domStrategyRuntime: null,
        setComposing: vi.fn(),
        setExplicitPartialDOMBackedSelection: vi.fn(),
        partialDOMBackedSelection: false,
      })

      expect(result.handled).toBe(true)
      expect(event.preventDefault).toHaveBeenCalled()
      expect(editor.read((state) => state.selection.get())).toEqual({
        anchor: { offset: 0, path: [0, 0] },
        focus: { offset: 1, path: [2, 0] },
      })
    } finally {
      DOMCoverage.clear(editor)
      hasEditableTarget.mockRestore()
      isComposing.mockRestore()
    }
  })

  it('keeps word selection extension model-owned across boundary-policy hidden ranges', () => {
    const intro = 'Intro visible before hidden blocks.'
    const editor = createEditor({
      initialSelection: {
        anchor: { path: [0, 0], offset: intro.length },
        focus: { path: [0, 0], offset: intro.length },
      },
      initialValue: [
        {
          type: 'paragraph',
          children: [{ text: intro }],
        },
        {
          type: 'hidden-block',
          children: [{ text: 'Hidden word.' }],
        },
        {
          type: 'paragraph',
          children: [{ text: 'Next visible paragraph.' }],
        },
      ],
    }) as ReactEditorType
    const event = reactKeyEvent(
      keyEvent('ArrowRight', { ctrlKey: true, shiftKey: true })
    )
    const hasEditableTarget = vi
      .spyOn(ReactEditor, 'hasEditableTarget')
      .mockReturnValue(true)
    const isComposing = vi
      .spyOn(ReactEditor, 'isComposing')
      .mockReturnValue(false)

    DOMCoverage.registerBoundary(editor, {
      anchor: { type: 'placeholder' },
      boundaryId: 'hidden-word',
      copyPolicy: 'include-model',
      coveredPathRanges: [{ anchor: [1, 0], focus: [1, 0] }],
      coveredRuntimeRanges: [],
      findPolicy: 'not-native-until-mounted',
      ownerPath: [],
      ownerRuntimeId: null,
      reason: 'app-hidden',
      selectionPolicy: 'boundary',
      state: 'intentionally-hidden',
      version: 1,
    })

    try {
      const result = applyEditableKeyDown({
        androidInputManagerRef: { current: null },
        editor,
        event,
        forceRender: vi.fn(),
        inputController: {} as any,
        readOnly: false,
        domStrategyRuntime: null,
        setComposing: vi.fn(),
        setExplicitPartialDOMBackedSelection: vi.fn(),
        partialDOMBackedSelection: false,
      })

      expect(result.handled).toBe(true)
      expect(event.preventDefault).toHaveBeenCalled()
      expect(editor.read((state) => state.selection.get())).toEqual({
        anchor: { offset: intro.length, path: [0, 0] },
        focus: { offset: 'Next'.length, path: [2, 0] },
      })
    } finally {
      DOMCoverage.clear(editor)
      hasEditableTarget.mockRestore()
      isComposing.mockRestore()
    }
  })

  it('keeps reverse word selection extension out of already-spanned hidden ranges', () => {
    const intro = 'Intro visible before hidden blocks.'
    const editor = createEditor({
      initialSelection: {
        anchor: { path: [0, 0], offset: intro.length },
        focus: { path: [2, 0], offset: 0 },
      },
      initialValue: [
        {
          type: 'paragraph',
          children: [{ text: intro }],
        },
        {
          type: 'hidden-block',
          children: [{ text: 'Hidden word.' }],
        },
        {
          type: 'paragraph',
          children: [{ text: 'Next visible paragraph.' }],
        },
      ],
    }) as ReactEditorType
    const event = reactKeyEvent(
      keyEvent('ArrowLeft', { ctrlKey: true, shiftKey: true })
    )
    const hasEditableTarget = vi
      .spyOn(ReactEditor, 'hasEditableTarget')
      .mockReturnValue(true)
    const isComposing = vi
      .spyOn(ReactEditor, 'isComposing')
      .mockReturnValue(false)

    DOMCoverage.registerBoundary(editor, {
      anchor: { type: 'placeholder' },
      boundaryId: 'hidden-word',
      copyPolicy: 'include-model',
      coveredPathRanges: [{ anchor: [1, 0], focus: [1, 0] }],
      coveredRuntimeRanges: [],
      findPolicy: 'not-native-until-mounted',
      ownerPath: [],
      ownerRuntimeId: null,
      reason: 'app-hidden',
      selectionPolicy: 'boundary',
      state: 'intentionally-hidden',
      version: 1,
    })

    try {
      const result = applyEditableKeyDown({
        androidInputManagerRef: { current: null },
        editor,
        event,
        forceRender: vi.fn(),
        inputController: {} as any,
        readOnly: false,
        domStrategyRuntime: null,
        setComposing: vi.fn(),
        setExplicitPartialDOMBackedSelection: vi.fn(),
        partialDOMBackedSelection: false,
      })

      expect(result.handled).toBe(true)
      expect(event.preventDefault).toHaveBeenCalled()
      expect(editor.read((state) => state.selection.get())).toEqual({
        anchor: { offset: intro.length, path: [0, 0] },
        focus: { offset: 'Intro visible before hidden '.length, path: [0, 0] },
      })
    } finally {
      DOMCoverage.clear(editor)
      hasEditableTarget.mockRestore()
      isComposing.mockRestore()
    }
  })

  it('skips multiple hidden ranges owned by the same boundary', () => {
    const intro = 'Intro visible before hidden blocks.'
    const editor = createEditor({
      initialSelection: {
        anchor: { path: [0, 0], offset: intro.length },
        focus: { path: [0, 0], offset: intro.length },
      },
      initialValue: [
        {
          type: 'paragraph',
          children: [{ text: intro }],
        },
        {
          type: 'hidden-block',
          children: [{ text: 'First hidden text.' }],
        },
        {
          type: 'hidden-block',
          children: [{ text: 'Second hidden text.' }],
        },
        {
          type: 'paragraph',
          children: [{ text: 'Next visible paragraph.' }],
        },
      ],
    }) as ReactEditorType
    const event = reactKeyEvent(keyEvent('ArrowRight'))
    const hasEditableTarget = vi
      .spyOn(ReactEditor, 'hasEditableTarget')
      .mockReturnValue(true)
    const isComposing = vi
      .spyOn(ReactEditor, 'isComposing')
      .mockReturnValue(false)

    DOMCoverage.registerBoundary(editor, {
      anchor: { type: 'placeholder' },
      boundaryId: 'same-owner-hidden-ranges',
      copyPolicy: 'include-model',
      coveredPathRanges: [
        { anchor: [1, 0], focus: [1, 0] },
        { anchor: [2, 0], focus: [2, 0] },
      ],
      coveredRuntimeRanges: [],
      findPolicy: 'not-native-until-mounted',
      ownerPath: [],
      ownerRuntimeId: null,
      reason: 'app-hidden',
      selectionPolicy: 'boundary',
      state: 'intentionally-hidden',
      version: 1,
    })

    try {
      const result = applyEditableKeyDown({
        androidInputManagerRef: { current: null },
        editor,
        event,
        forceRender: vi.fn(),
        inputController: {} as any,
        readOnly: false,
        domStrategyRuntime: null,
        setComposing: vi.fn(),
        setExplicitPartialDOMBackedSelection: vi.fn(),
        partialDOMBackedSelection: false,
      })

      expect(result.handled).toBe(true)
      expect(event.preventDefault).toHaveBeenCalled()
      expect(editor.read((state) => state.selection.get())).toEqual({
        anchor: { offset: 0, path: [3, 0] },
        focus: { offset: 0, path: [3, 0] },
      })
    } finally {
      DOMCoverage.clear(editor)
      hasEditableTarget.mockRestore()
      isComposing.mockRestore()
    }
  })

  it('collapses plain line movement when skipping boundary-policy hidden ranges', () => {
    const intro = 'Intro visible before hidden blocks.'
    const editor = createEditor({
      initialSelection: {
        anchor: { path: [0, 0], offset: intro.length },
        focus: { path: [0, 0], offset: intro.length },
      },
      initialValue: [
        {
          type: 'paragraph',
          children: [{ text: intro }],
        },
        {
          type: 'hidden-block',
          children: [{ text: 'Hidden line.' }],
        },
        {
          type: 'paragraph',
          children: [{ text: 'Next visible paragraph.' }],
        },
      ],
    }) as ReactEditorType
    const event = reactKeyEvent(keyEvent('LineForward'))
    const hasEditableTarget = vi
      .spyOn(ReactEditor, 'hasEditableTarget')
      .mockReturnValue(true)
    const isComposing = vi
      .spyOn(ReactEditor, 'isComposing')
      .mockReturnValue(false)
    const isMoveLineForward = vi
      .spyOn(Hotkeys, 'isMoveLineForward')
      .mockReturnValue(true)

    DOMCoverage.registerBoundary(editor, {
      anchor: { type: 'placeholder' },
      boundaryId: 'hidden-line',
      copyPolicy: 'include-model',
      coveredPathRanges: [{ anchor: [1, 0], focus: [1, 0] }],
      coveredRuntimeRanges: [],
      findPolicy: 'not-native-until-mounted',
      ownerPath: [],
      ownerRuntimeId: null,
      reason: 'app-hidden',
      selectionPolicy: 'boundary',
      state: 'intentionally-hidden',
      version: 1,
    })

    try {
      const result = applyEditableKeyDown({
        androidInputManagerRef: { current: null },
        editor,
        event,
        forceRender: vi.fn(),
        inputController: {} as any,
        readOnly: false,
        domStrategyRuntime: null,
        setComposing: vi.fn(),
        setExplicitPartialDOMBackedSelection: vi.fn(),
        partialDOMBackedSelection: false,
      })

      expect(result.handled).toBe(true)
      expect(event.preventDefault).toHaveBeenCalled()
      expect(editor.read((state) => state.selection.get())).toEqual({
        anchor: { offset: 0, path: [2, 0] },
        focus: { offset: 0, path: [2, 0] },
      })
    } finally {
      DOMCoverage.clear(editor)
      hasEditableTarget.mockRestore()
      isComposing.mockRestore()
      isMoveLineForward.mockRestore()
    }
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
        domStrategyRuntime: null,
        setComposing: vi.fn(),
        setExplicitPartialDOMBackedSelection: vi.fn(),
        partialDOMBackedSelection: false,
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
