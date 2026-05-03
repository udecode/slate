import { act, render, renderHook, waitFor } from '@testing-library/react'
import _ from 'lodash'
import { createEditor, type Operation, type SnapshotChange, Text } from 'slate'
import { Editor } from 'slate/internal'
import {
  Editable,
  Slate,
  useEditor,
  useEditorSelector,
  useEditorState,
  useNodeSelector,
  useTextSelector,
  withReact,
} from '../src'
import {
  usePlaceholderValue,
  useRootRuntimeIds,
  useTopLevelSelectionIndex,
} from '../src/editable/root-selector-sources'
import {
  useMountedNodeRenderSelector,
  useMountedTextRenderSelector,
} from '../src/hooks/use-node-selector'
import { createSlateReactRenderCounter } from '../src/render-profiler'

const initialValue = [{ type: 'block', children: [{ text: 'test' }] }]

describe('slate-react provider hooks contract', () => {
  test('useEditor updates when the provider editor changes', () => {
    const editorA = withReact(createEditor())
    const editorB = withReact(createEditor())
    const seen: unknown[] = []

    const ShowStaticEditor = () => {
      const editor = useEditor()
      seen.push(editor)
      return (
        <span data-testid="static-editor">
          {editor === editorB ? 'B' : 'A'}
        </span>
      )
    }

    const rendered = render(
      <Slate editor={editorA} initialValue={initialValue}>
        <Editable />
        <ShowStaticEditor />
      </Slate>
    )

    expect(rendered.getByTestId('static-editor')).toHaveTextContent('A')
    expect(seen.at(-1)).toBe(editorA)

    rendered.rerender(
      <Slate editor={editorB} initialValue={initialValue}>
        <Editable />
        <ShowStaticEditor />
      </Slate>
    )

    expect(rendered.getByTestId('static-editor')).toHaveTextContent('B')
    expect(seen.at(-1)).toBe(editorB)
  })

  test('useEditorSelector honors the equality function when selector identity changes', async () => {
    const editor = withReact(createEditor())
    const callback1 = jest.fn(() => [])
    const callback2 = jest.fn(() => [])

    const { result, rerender } = renderHook(
      ({ callback }) => useEditorSelector(callback, _.isEqual),
      {
        initialProps: { callback: callback1 },
        wrapper: ({ children }) => (
          <Slate editor={editor} initialValue={initialValue}>
            <Editable />
            {children}
          </Slate>
        ),
      }
    )

    expect(callback1).toBeCalledTimes(2)

    const firstResult = result.current

    await act(async () => {
      editor.update((tx) => {
        tx.text.insert('!', { at: { path: [0, 0], offset: 4 } })
      })
    })

    expect(callback1).toBeCalledTimes(3)
    expect(firstResult).toBe(result.current)

    rerender({ callback: callback2 })

    expect(callback1).toBeCalledTimes(3)
    expect(callback2).toBeCalledTimes(1)
    expect(firstResult).toBe(result.current)
  })

  test('useEditorSelector passes commit facts to shouldUpdate', async () => {
    const editor = withReact(createEditor())

    Editor.replace(editor, {
      children: [
        { type: 'block', children: [{ text: 'one' }] },
        { type: 'block', children: [{ text: 'two' }] },
      ],
    })

    const targetRuntimeId = Editor.getSnapshot(editor).index.pathToId['1.0']
    const selector = jest.fn(() => Editor.getLastCommit(editor)?.version ?? 0)
    const shouldUpdate = jest.fn(
      (_operations?: readonly Operation[], change?: SnapshotChange) =>
        Boolean(
          change?.selectionImpactRuntimeIds?.includes(targetRuntimeId ?? '')
        )
    )
    const initialVersion = Editor.getLastCommit(editor)?.version ?? 0

    const { result } = renderHook(
      () => useEditorSelector(selector, undefined, { shouldUpdate }),
      {
        wrapper: ({ children }) => (
          <Slate editor={editor}>
            <Editable />
            {children}
          </Slate>
        ),
      }
    )

    expect(selector).toBeCalledTimes(2)
    expect(result.current).toBe(initialVersion)

    await act(async () => {
      editor.update((tx) => {
        tx.selection.set({ path: [0, 0], offset: 0 })
      })
    })

    expect(shouldUpdate).toBeCalled()
    expect(selector).toBeCalledTimes(2)
    expect(result.current).toBe(initialVersion)

    await act(async () => {
      editor.update((tx) => {
        tx.selection.set({ path: [1, 0], offset: 0 })
      })
    })

    expect(selector).toBeCalledTimes(3)
    expect(result.current).toBe(Editor.getLastCommit(editor)?.version)
  })

  test('useEditorState reads through editor.read and filters by commit facts', async () => {
    const editor = withReact(createEditor())

    Editor.replace(editor, {
      children: [
        { type: 'block', children: [{ text: 'one' }] },
        { type: 'block', children: [{ text: 'two' }] },
      ],
      selection: null,
    })

    const snapshot = Editor.getSnapshot(editor)
    const blockRuntimeId = snapshot.index.pathToId['0']
    const textRuntimeId = snapshot.index.pathToId['0.0']
    const selector = jest.fn((state) => state.selection.get())
    const seenChanges: SnapshotChange[] = []
    const shouldUpdate = jest.fn((change?: SnapshotChange) => {
      if (change) {
        seenChanges.push(change)
      }

      return Boolean(change?.selectionChanged)
    })

    const { result } = renderHook(
      () => useEditorState(selector, { shouldUpdate }),
      {
        wrapper: ({ children }) => (
          <Slate editor={editor}>
            <Editable />
            {children}
          </Slate>
        ),
      }
    )

    expect(selector).toBeCalledTimes(2)
    expect(result.current).toBe(null)

    await act(async () => {
      editor.update((tx) => {
        tx.text.insert('!', { at: { path: [0, 0], offset: 3 } })
      })
    })

    expect(shouldUpdate).toBeCalled()
    expect(selector).toBeCalledTimes(2)
    expect(result.current).toBe(null)
    expect(seenChanges.at(-1)?.dirtyTextRuntimeIds).toEqual([textRuntimeId])
    expect(seenChanges.at(-1)?.dirtyElementRuntimeIds).toEqual([blockRuntimeId])
    expect(seenChanges.at(-1)?.dirtyTopLevelRuntimeIds).toEqual([
      blockRuntimeId,
    ])
    expect(seenChanges.at(-1)?.dirtyTopLevelRanges).toEqual([[0, 0]])
    expect(seenChanges.at(-1)?.rootRuntimeIdsChanged).toBe(false)
    expect(seenChanges.at(-1)?.topLevelOrderChanged).toBe(false)
    expect(seenChanges.at(-1)?.fullDocumentChanged).toBe(false)

    await act(async () => {
      editor.update((tx) => {
        tx.selection.set({ path: [1, 0], offset: 1 })
      })
    })

    expect(selector).toBeCalledTimes(3)
    expect(result.current).toEqual({
      anchor: { path: [1, 0], offset: 1 },
      focus: { path: [1, 0], offset: 1 },
    })
  })

  test('runtime selector hooks skip unrelated runtime id commits', async () => {
    const editor = withReact(createEditor())

    Editor.replace(editor, {
      children: [
        { type: 'block', children: [{ text: 'one' }] },
        { type: 'block', children: [{ text: 'two' }] },
      ],
      selection: null,
    })

    const snapshot = Editor.getSnapshot(editor)
    const blockRuntimeId = snapshot.index.pathToId['0']
    const textRuntimeId = snapshot.index.pathToId['0.0']

    if (!blockRuntimeId || !textRuntimeId) {
      throw new Error('Expected runtime ids for selector contract')
    }

    const nodeSelector = jest.fn(({ node }) =>
      node && 'children' in node && 'text' in node.children[0]
        ? node.children[0].text
        : null
    )
    const textSelector = jest.fn(({ text }) => text?.text ?? null)

    const { result } = renderHook(
      () => ({
        nodeText: useNodeSelector(nodeSelector, undefined, {
          runtimeId: blockRuntimeId,
        }),
        text: useTextSelector(textSelector, undefined, {
          runtimeId: textRuntimeId,
        }),
      }),
      {
        wrapper: ({ children }) => (
          <Slate editor={editor}>
            <Editable />
            {children}
          </Slate>
        ),
      }
    )

    expect(result.current).toEqual({ nodeText: 'one', text: 'one' })
    expect(nodeSelector).toBeCalledTimes(2)
    expect(textSelector).toBeCalledTimes(2)

    await act(async () => {
      editor.update((tx) => {
        tx.text.insert('!', { at: { path: [1, 0], offset: 3 } })
      })
    })

    expect(result.current).toEqual({ nodeText: 'one', text: 'one' })
    expect(nodeSelector).toBeCalledTimes(2)
    expect(textSelector).toBeCalledTimes(2)

    await act(async () => {
      editor.update((tx) => {
        tx.text.insert('!', { at: { path: [0, 0], offset: 3 } })
      })
    })

    expect(result.current).toEqual({ nodeText: 'one!', text: 'one!' })
    expect(nodeSelector).toBeCalledTimes(3)
    expect(textSelector).toBeCalledTimes(3)
  })

  test('runtime selector listeners do not fan out to unrelated runtime ids', async () => {
    const editor = withReact(createEditor())

    Editor.replace(editor, {
      children: [
        { type: 'block', children: [{ text: 'one' }] },
        { type: 'block', children: [{ text: 'two' }] },
      ],
      selection: null,
    })

    const snapshot = Editor.getSnapshot(editor)
    const firstBlockRuntimeId = snapshot.index.pathToId['0']
    const secondTextRuntimeId = snapshot.index.pathToId['1.0']

    if (!firstBlockRuntimeId || !secondTextRuntimeId) {
      throw new Error('Expected runtime ids for listener fanout contract')
    }

    const selector = jest.fn(() => Editor.getLastCommit(editor)?.version ?? 0)
    const shouldUpdate = jest.fn(() => true)
    const counter = createSlateReactRenderCounter()
    const previousProfiler = globalThis.__SLATE_REACT_RENDER_PROFILER__
    globalThis.__SLATE_REACT_RENDER_PROFILER__ = counter.profiler

    try {
      const { result } = renderHook(
        () =>
          useEditorSelector(selector, undefined, {
            runtimeId: firstBlockRuntimeId,
            shouldUpdate,
          }),
        {
          wrapper: ({ children }) => (
            <Slate editor={editor}>
              <Editable />
              {children}
            </Slate>
          ),
        }
      )

      const initialVersion = result.current
      counter.reset()

      await act(async () => {
        editor.update((tx) => {
          tx.text.insert('!', { at: { path: [1, 0], offset: 3 } })
        })
      })

      expect(result.current).toBe(initialVersion)
      expect(shouldUpdate).not.toBeCalled()
      expect(
        counter
          .snapshot()
          .events.filter(
            (event) =>
              event.id === 'selector-runtime-check' &&
              event.runtimeId === firstBlockRuntimeId
          )
      ).toHaveLength(0)

      counter.reset()

      await act(async () => {
        editor.update((tx) => {
          tx.text.insert('!', { at: { path: [0, 0], offset: 3 } })
        })
      })

      const profile = counter.snapshot()
      const targetSelectorEvents = profile.events.filter(
        (event) => event.runtimeId === firstBlockRuntimeId
      )

      expect(shouldUpdate).toBeCalledTimes(1)
      expect(result.current).toBe(Editor.getLastCommit(editor)?.version)
      expect(
        targetSelectorEvents.filter(
          (event) => event.id === 'selector-runtime-check'
        )
      ).not.toHaveLength(0)
      expect(
        targetSelectorEvents.filter(
          (event) => event.id === 'selector-runtime-notify'
        )
      ).not.toHaveLength(0)
    } finally {
      globalThis.__SLATE_REACT_RENDER_PROFILER__ = previousProfiler
    }
  })

  test('Editable keeps large DOM-present root groups stable across local edits and parent rerenders', async () => {
    const editor = withReact(createEditor())
    const value = Array.from({ length: 1001 }, (_value, index) => ({
      type: 'block',
      children: [{ text: `line ${index}` }],
    }))
    const counter = createSlateReactRenderCounter()
    const previousProfiler = globalThis.__SLATE_REACT_RENDER_PROFILER__
    let rendered: ReturnType<typeof render> | null = null
    globalThis.__SLATE_REACT_RENDER_PROFILER__ = counter.profiler

    try {
      rendered = render(
        <Slate editor={editor} initialValue={value}>
          <Editable data-testid="grouped-root" />
        </Slate>
      )

      expect(counter.snapshot().byKind.group).toBe(1)
      expect(
        rendered.container.querySelectorAll(
          '[data-slate-root-group-state="pending-mount"]'
        )
      ).toHaveLength(1)

      counter.reset()

      await act(async () => {
        editor.update((tx) => {
          tx.text.insert('!', { at: { path: [1000, 0], offset: 0 } })
        })
      })

      const editProfile = counter.snapshot()

      expect(
        editProfile.events.filter(
          (event) => event.kind === 'group' && event.id === '0-49'
        )
      ).toHaveLength(0)
      expect(editProfile.byKind.group ?? 0).toBeLessThanOrEqual(1)

      counter.reset()

      rendered.rerender(
        <Slate editor={editor}>
          <Editable data-testid="grouped-root-next" />
        </Slate>
      )

      expect(counter.snapshot().byKind.group ?? 0).toBe(0)
    } finally {
      rendered?.unmount()
      globalThis.__SLATE_REACT_RENDER_PROFILER__ = previousProfiler
    }
  })

  test('Editable can explicitly use DOM-present large-document grouping', () => {
    const editor = withReact(createEditor())
    const value = Array.from({ length: 1001 }, (_value, index) => ({
      type: 'block',
      children: [{ text: `line ${index}` }],
    }))
    const counter = createSlateReactRenderCounter()
    const previousProfiler = globalThis.__SLATE_REACT_RENDER_PROFILER__
    let rendered: ReturnType<typeof render> | null = null
    globalThis.__SLATE_REACT_RENDER_PROFILER__ = counter.profiler

    try {
      rendered = render(
        <Slate editor={editor} initialValue={value}>
          <Editable
            data-testid="dom-present-root"
            largeDocument="dom-present"
          />
        </Slate>
      )

      expect(counter.snapshot().byKind.group).toBe(1)
      expect(
        rendered.container.querySelectorAll(
          '[data-slate-root-group-state="pending-mount"]'
        )
      ).toHaveLength(1)
    } finally {
      rendered?.unmount()
      globalThis.__SLATE_REACT_RENDER_PROFILER__ = previousProfiler
    }
  })

  test('Editable can disable automatic large-document root grouping', () => {
    const editor = withReact(createEditor())
    const value = Array.from({ length: 1001 }, (_value, index) => ({
      type: 'block',
      children: [{ text: `line ${index}` }],
    }))
    const counter = createSlateReactRenderCounter()
    const previousProfiler = globalThis.__SLATE_REACT_RENDER_PROFILER__
    let rendered: ReturnType<typeof render> | null = null
    globalThis.__SLATE_REACT_RENDER_PROFILER__ = counter.profiler

    try {
      rendered = render(
        <Slate editor={editor} initialValue={value}>
          <Editable data-testid="ungrouped-root" largeDocument="off" />
        </Slate>
      )

      expect(counter.snapshot().byKind.group ?? 0).toBe(0)
    } finally {
      rendered?.unmount()
      globalThis.__SLATE_REACT_RENDER_PROFILER__ = previousProfiler
    }
  })

  test('Editable root-order commits do not fan out to every mounted runtime node', async () => {
    const editor = withReact(createEditor())
    const value = Array.from({ length: 1001 }, (_value, index) => ({
      type: 'block',
      children: [{ text: `line ${index}` }],
    }))
    const counter = createSlateReactRenderCounter()
    const previousProfiler = globalThis.__SLATE_REACT_RENDER_PROFILER__
    let rendered: ReturnType<typeof render> | null = null
    globalThis.__SLATE_REACT_RENDER_PROFILER__ = counter.profiler

    try {
      rendered = render(
        <Slate editor={editor} initialValue={value}>
          <Editable data-testid="root-order-fanout" />
        </Slate>
      )
      counter.reset()

      await act(async () => {
        editor.update((tx) => {
          tx.nodes.insert(
            { type: 'block', children: [{ text: 'new line' }] } as never,
            { at: [1001] }
          )
        })
      })

      const profile = counter.snapshot()

      expect(profile.byKey['selector:selector-runtime-node-check'] ?? 0).toBe(0)
      expect(profile.byKey['selector:selector-runtime-node-notify'] ?? 0).toBe(
        0
      )
      expect(profile.byKey['selector:selector-root-runtime-ids-notify']).toBe(1)
    } finally {
      rendered?.unmount()
      globalThis.__SLATE_REACT_RENDER_PROFILER__ = previousProfiler
    }
  })

  test('Editable full-document replacement does not fan out to stale mounted runtime nodes', async () => {
    const editor = withReact(createEditor())
    const value = Array.from({ length: 1001 }, (_value, index) => ({
      type: 'block',
      children: [{ text: `line ${index}` }],
    }))
    const counter = createSlateReactRenderCounter()
    const previousProfiler = globalThis.__SLATE_REACT_RENDER_PROFILER__
    let rendered: ReturnType<typeof render> | null = null
    globalThis.__SLATE_REACT_RENDER_PROFILER__ = counter.profiler

    try {
      rendered = render(
        <Slate editor={editor} initialValue={value}>
          <Editable data-testid="full-document-fanout" />
        </Slate>
      )
      counter.reset()

      await act(async () => {
        editor.update((tx) => {
          tx.value.replace({
            children: [{ type: 'block', children: [{ text: 'replacement' }] }],
            selection: {
              anchor: { path: [0, 0], offset: 11 },
              focus: { path: [0, 0], offset: 11 },
            },
          })
        })
      })

      const profile = counter.snapshot()

      expect(profile.byKey['selector:selector-runtime-node-check'] ?? 0).toBe(1)
      expect(profile.byKey['selector:selector-runtime-node-notify'] ?? 0).toBe(
        1
      )
      expect(profile.byKey['selector:selector-root-runtime-ids-notify']).toBe(1)
    } finally {
      rendered?.unmount()
      globalThis.__SLATE_REACT_RENDER_PROFILER__ = previousProfiler
    }
  })

  test('mounted render selector hooks skip synced text commits but catch the next node commit', async () => {
    const editor = withReact(createEditor())

    Editor.replace(editor, {
      children: [{ type: 'block', children: [{ text: 'one' }] }],
      selection: null,
    })

    const snapshot = Editor.getSnapshot(editor)
    const blockRuntimeId = snapshot.index.pathToId['0']
    const textRuntimeId = snapshot.index.pathToId['0.0']

    if (!blockRuntimeId || !textRuntimeId) {
      throw new Error('Expected runtime ids for mounted selector contract')
    }

    const nodeSelector = jest.fn(({ node }) => {
      if (!node || Editor.isEditor(node) || !('children' in node)) {
        return null
      }

      const firstChild = node.children[0]

      return Text.isText(firstChild) ? firstChild.text : null
    })
    const textSelector = jest.fn(({ text }) => text?.text ?? null)

    const { result } = renderHook(
      () => ({
        nodeText: useMountedNodeRenderSelector(nodeSelector, undefined, {
          runtimeId: blockRuntimeId,
        }),
        text: useMountedTextRenderSelector(textSelector, undefined, {
          runtimeId: textRuntimeId,
        }),
      }),
      {
        wrapper: ({ children }) => (
          <Slate editor={editor}>
            <Editable />
            {children}
          </Slate>
        ),
      }
    )

    expect(result.current).toEqual({ nodeText: 'one', text: 'one' })

    const callsAfterMount = {
      node: nodeSelector.mock.calls.length,
      text: textSelector.mock.calls.length,
    }

    await act(async () => {
      editor.update((tx) => {
        tx.text.insert('!', { at: { path: [0, 0], offset: 3 } })
      })
    })

    expect(result.current).toEqual({ nodeText: 'one', text: 'one' })
    expect(nodeSelector).toBeCalledTimes(callsAfterMount.node)
    expect(textSelector).toBeCalledTimes(callsAfterMount.text)

    await act(async () => {
      editor.update((tx) => {
        tx.nodes.set({ tone: true } as never, { at: [0, 0] })
      })
    })

    expect(result.current.text).toBe('one!')
    expect(textSelector.mock.calls.length).toBeGreaterThan(callsAfterMount.text)

    await act(async () => {
      editor.update((tx) => {
        tx.nodes.set({ tone: 'block' } as never, { at: [0] })
      })
    })

    expect(result.current.nodeText).toBe('one!')
    expect(nodeSelector.mock.calls.length).toBeGreaterThan(callsAfterMount.node)
  })

  test('root selector sources track structural ids and selected top-level index', async () => {
    const editor = withReact(createEditor())

    Editor.replace(editor, {
      children: [
        { type: 'block', children: [{ text: 'one' }] },
        { type: 'block', children: [{ text: 'two' }] },
      ],
      selection: null,
    })

    const { result } = renderHook(
      () => ({
        selectedTopLevelIndex: useTopLevelSelectionIndex(true),
        topLevelRuntimeIds: useRootRuntimeIds(),
      }),
      {
        wrapper: ({ children }) => (
          <Slate editor={editor}>
            <Editable />
            {children}
          </Slate>
        ),
      }
    )

    expect(result.current.selectedTopLevelIndex).toBe(null)
    expect(result.current.topLevelRuntimeIds).toHaveLength(2)

    const initialRootRuntimeIds = result.current.topLevelRuntimeIds

    await act(async () => {
      editor.update((tx) => {
        tx.selection.set({ path: [1, 0], offset: 0 })
      })
    })

    expect(result.current.selectedTopLevelIndex).toBe(1)
    expect(result.current.topLevelRuntimeIds).toBe(initialRootRuntimeIds)

    await act(async () => {
      editor.update((tx) => {
        tx.text.insert('!', { at: { path: [1, 0], offset: 3 } })
      })
    })

    expect(result.current.topLevelRuntimeIds).toBe(initialRootRuntimeIds)

    await act(async () => {
      editor.update((tx) => {
        tx.nodes.insert(
          { type: 'block', children: [{ text: 'three' }] } as never,
          { at: [2] }
        )
      })
    })

    expect(result.current.topLevelRuntimeIds).toHaveLength(3)
    expect(result.current.topLevelRuntimeIds).not.toBe(initialRootRuntimeIds)
  })

  test('placeholder root source tracks empty editor state', async () => {
    const editor = withReact(createEditor())

    Editor.replace(editor, {
      children: [{ type: 'block', children: [{ text: '' }] }],
      selection: null,
    })

    const { result } = renderHook(() => usePlaceholderValue('Type something'), {
      wrapper: ({ children }) => (
        <Slate editor={editor}>
          <Editable />
          {children}
        </Slate>
      ),
    })

    await waitFor(() => expect(result.current).toBe('Type something'))

    await act(async () => {
      editor.update((tx) => {
        tx.text.insert('x', { at: { path: [0, 0], offset: 0 } })
      })
    })

    expect(result.current).toBeUndefined()

    await act(async () => {
      editor.update((tx) => {
        tx.text.delete({
          at: {
            anchor: { path: [0, 0], offset: 0 },
            focus: { path: [0, 0], offset: 1 },
          },
        })
      })
    })

    await waitFor(() => expect(result.current).toBe('Type something'))
  })

  test('placeholder root source ignores selection-only commits', async () => {
    const editor = withReact(createEditor())

    Editor.replace(editor, {
      children: [{ type: 'block', children: [{ text: '' }] }],
      selection: null,
    })

    let renderCount = 0
    const { result } = renderHook(
      () => {
        renderCount += 1

        return usePlaceholderValue('Type something')
      },
      {
        wrapper: ({ children }) => (
          <Slate editor={editor}>
            <Editable />
            {children}
          </Slate>
        ),
      }
    )

    await waitFor(() => expect(result.current).toBe('Type something'))

    const renderCountAfterMount = renderCount

    await act(async () => {
      editor.update((tx) => {
        tx.selection.set({ path: [0, 0], offset: 0 })
      })
    })

    expect(result.current).toBe('Type something')
    expect(renderCount).toBe(renderCountAfterMount)
  })
})
