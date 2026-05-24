import { createEditor, defineEditorExtension } from 'slate'
import { Editor } from 'slate/internal'
import {
  EDITOR_TO_PENDING_DIFFS,
  EDITOR_TO_PENDING_INSERTION_MARKS,
} from 'slate-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createAndroidInputManager,
  shouldFlushStoredTextDiffForTransformMiddleware,
} from '../src/hooks/android-input-manager/android-input-manager'
import { ReactEditor } from '../src/plugin/react-editor'

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const createDebouncedSpy = () =>
  Object.assign(vi.fn(), {
    cancel: vi.fn(),
    flush: vi.fn(),
  }) as any

const range = (start: number, end = start) => ({
  anchor: { path: [0, 0], offset: start },
  focus: { path: [0, 0], offset: end },
})

const beforeInputEvent = (
  inputType: string,
  data: string,
  targetRanges: StaticRange[] = []
) =>
  ({
    cancelable: true,
    data,
    getTargetRanges: () => targetRanges,
    inputType,
    preventDefault: vi.fn(),
  }) as unknown as InputEvent

describe('Android input manager transform middleware flush policy', () => {
  it('flushes stored text diffs when insertText transform middleware is registered', () => {
    const editor = createEditor({
      extensions: [
        defineEditorExtension({
          name: 'insert-text-transform',
          transforms: {
            insertText({ next }) {
              next()
            },
          },
        }),
      ],
    })

    expect(
      shouldFlushStoredTextDiffForTransformMiddleware(editor as never, {
        start: 0,
        end: 0,
        text: ' ',
      })
    ).toBe(true)
  })

  it('keeps plain editors on the deferred pending-diff path', () => {
    const editor = createEditor()

    expect(
      shouldFlushStoredTextDiffForTransformMiddleware(editor as never, {
        start: 0,
        end: 0,
        text: ' ',
      })
    ).toBe(false)
  })

  it('does not fast-flush delete diffs through insertText middleware', () => {
    const editor = createEditor({
      extensions: [
        defineEditorExtension({
          name: 'insert-text-transform',
          transforms: {
            insertText({ next }) {
              next()
            },
          },
        }),
      ],
    })

    expect(
      shouldFlushStoredTextDiffForTransformMiddleware(editor as never, {
        start: 0,
        end: 1,
        text: '',
      })
    ).toBe(false)
  })

  it('does not treat unrelated transform middleware as insertText policy', () => {
    const editor = createEditor({
      extensions: [
        defineEditorExtension({
          name: 'insert-break-transform',
          transforms: {
            insertBreak({ next }) {
              next()
            },
          },
        }),
      ],
    })

    expect(
      shouldFlushStoredTextDiffForTransformMiddleware(editor as never, {
        start: 0,
        end: 0,
        text: ' ',
      })
    ).toBe(false)
  })
})

describe('Android input manager stored text diffs', () => {
  it('stores the normalized replacement diff for a synced text leaf', () => {
    vi.useFakeTimers()

    const editor = createEditor({
      initialValue: [{ children: [{ text: 'abc' }] }],
    })
    const scheduleOnDOMSelectionChange = createDebouncedSpy()
    const onDOMSelectionChange = createDebouncedSpy()
    const textHost = document.createElement('span')
    const textNode = document.createTextNode('abc')

    textHost.setAttribute('data-slate-dom-sync', 'true')
    textHost.setAttribute('data-slate-node', 'text')
    textHost.append(textNode)

    vi.spyOn(ReactEditor, 'getWindow').mockReturnValue(window)
    vi.spyOn(ReactEditor, 'resolveDOMPoint').mockReturnValue([textNode, 0])
    vi.spyOn(ReactEditor, 'resolveSlateRange').mockReturnValue(null)

    const manager = createAndroidInputManager({
      editor: editor as never,
      onDOMSelectionChange,
      receivedUserInput: { current: true },
      scheduleOnDOMSelectionChange,
    })

    Editor.select(editor, range(0, 3))
    manager.handleDOMBeforeInput(
      beforeInputEvent('insertReplacementText', 'axc')
    )

    expect(EDITOR_TO_PENDING_DIFFS.get(editor)?.[0]?.diff).toEqual({
      end: 2,
      start: 1,
      text: 'x',
    })
  })
})

describe('Android input manager SwiftKey insert-position hint', () => {
  it('keeps selection on the marked inserted leaf after collapsed mark typing', () => {
    vi.useFakeTimers()

    const editor = createEditor({
      initialValue: [{ children: [{ text: 'a' }] }],
    })
    const scheduleOnDOMSelectionChange = createDebouncedSpy()
    const onDOMSelectionChange = createDebouncedSpy()
    const textHost = document.createElement('span')
    const textNode = document.createTextNode('a')

    textHost.setAttribute('data-slate-dom-sync', 'true')
    textHost.setAttribute('data-slate-node', 'text')
    textHost.append(textNode)

    vi.spyOn(ReactEditor, 'getWindow').mockReturnValue(window)
    vi.spyOn(ReactEditor, 'resolveDOMPoint').mockReturnValue([textNode, 1])
    vi.spyOn(ReactEditor, 'resolveSlateRange').mockReturnValue(null)

    const manager = createAndroidInputManager({
      editor: editor as never,
      onDOMSelectionChange,
      receivedUserInput: { current: true },
      scheduleOnDOMSelectionChange,
    })

    Editor.select(editor, range(1))
    Editor.addMark(editor, 'bold', true)
    EDITOR_TO_PENDING_INSERTION_MARKS.set(editor, { bold: true })

    manager.handleDOMBeforeInput(beforeInputEvent('insertText', 'w'))
    manager.flush()

    const snapshot = Editor.getSnapshot(editor)
    expect(snapshot.children).toEqual([
      { children: [{ text: 'a' }, { bold: true, text: 'w' }] },
    ])
    expect(snapshot.selection).toEqual({
      anchor: { path: [0, 1], offset: 1 },
      focus: { path: [0, 1], offset: 1 },
    })
  })

  it('keeps the mark-placeholder hint through scheduled selection restoration', () => {
    vi.useFakeTimers()

    const editor = createEditor({
      initialValue: [{ children: [{ text: '' }] }],
    })
    const scheduleOnDOMSelectionChange = createDebouncedSpy()
    const onDOMSelectionChange = createDebouncedSpy()
    const textHost = document.createElement('span')
    const textNode = document.createTextNode('')

    textHost.setAttribute('data-slate-dom-sync', 'true')
    textHost.setAttribute('data-slate-node', 'text')
    textHost.append(textNode)

    vi.spyOn(ReactEditor, 'getWindow').mockReturnValue(window)
    vi.spyOn(ReactEditor, 'resolveDOMPoint').mockReturnValue([textNode, 0])
    const resolveSlateRange = vi
      .spyOn(ReactEditor, 'resolveSlateRange')
      .mockReturnValue(null)

    const manager = createAndroidInputManager({
      editor: editor as never,
      onDOMSelectionChange,
      receivedUserInput: { current: true },
      scheduleOnDOMSelectionChange,
    })

    Editor.select(editor, range(0))
    EDITOR_TO_PENDING_INSERTION_MARKS.set(editor, { bold: true })
    EDITOR_TO_PENDING_DIFFS.set(editor, [
      {
        diff: { start: 0, end: 0, text: 'some ' },
        id: 0,
        path: [0, 0],
      },
    ])

    manager.flush()
    expect(Editor.string(editor, [])).toBe('some ')

    Editor.select(editor, range(5))
    manager.handleDOMBeforeInput(beforeInputEvent('insertText', 'text'))

    resolveSlateRange.mockReturnValueOnce(range(6, 9))
    manager.handleDOMBeforeInput(
      beforeInputEvent('insertCompositionText', 'text', [{} as StaticRange])
    )
    manager.flush()

    expect(Editor.string(editor, [])).toBe('some text')
  })
})
