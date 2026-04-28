import { act, render, renderHook, waitFor } from '@testing-library/react'
import _ from 'lodash'
import {
  createEditor,
  Editor,
  type Operation,
  type SnapshotChange,
  Text,
} from 'slate'
import {
  Editable,
  Slate,
  useNodeSelector,
  useSlate,
  useSlateSelector,
  useSlateStatic,
  useSlateWithV,
  useTextSelector,
  withReact,
} from '../src'
import {
  usePlaceholderValue,
  useRootRuntimeIds,
  useSelectedTopLevelIndex,
} from '../src/editable/root-selector-sources'
import {
  useMountedNodeRenderSelector,
  useMountedTextRenderSelector,
} from '../src/hooks/use-node-selector'

const initialValue = [{ type: 'block', children: [{ text: 'test' }] }]

describe('slate-react provider hooks contract', () => {
  test('useSlate returns the current provider editor', () => {
    const editor = withReact(createEditor())

    const { result } = renderHook(() => useSlate(), {
      wrapper: ({ children }) => (
        <Slate editor={editor} initialValue={initialValue}>
          <Editable />
          {children}
        </Slate>
      ),
    })

    expect(result.current).toBe(editor)
  })

  test('useSlateStatic updates when the provider editor changes', () => {
    const editorA = withReact(createEditor())
    const editorB = withReact(createEditor())
    const seen: unknown[] = []

    const ShowStaticEditor = () => {
      const editor = useSlateStatic()
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

  test('useSlateWithV tracks the provider version counter', async () => {
    const editor = withReact(createEditor())

    const ShowVersion = () => {
      const { v } = useSlateWithV()
      return <span data-testid="version">V = {v}</span>
    }

    const rendered = render(
      <Slate editor={editor} initialValue={initialValue}>
        <Editable />
        <ShowVersion />
      </Slate>
    )

    expect(rendered.getByTestId('version')).toHaveTextContent('V = 0')

    await act(async () => {
      editor.update(() => {
        editor.insertText('!', { at: { path: [0, 0], offset: 4 } })
      })
    })

    expect(rendered.getByTestId('version')).toHaveTextContent('V = 1')
  })

  test('useSlateSelector honors the equality function when selector identity changes', async () => {
    const editor = withReact(createEditor())
    const callback1 = jest.fn(() => [])
    const callback2 = jest.fn(() => [])

    const { result, rerender } = renderHook(
      ({ callback }) => useSlateSelector(callback, _.isEqual),
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
      editor.update(() => {
        editor.insertText('!', { at: { path: [0, 0], offset: 4 } })
      })
    })

    expect(callback1).toBeCalledTimes(3)
    expect(firstResult).toBe(result.current)

    rerender({ callback: callback2 })

    expect(callback1).toBeCalledTimes(3)
    expect(callback2).toBeCalledTimes(1)
    expect(firstResult).toBe(result.current)
  })

  test('useSlateSelector passes commit facts to shouldUpdate', async () => {
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
      () => useSlateSelector(selector, undefined, { shouldUpdate }),
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
      editor.update(() => {
        editor.select({ path: [0, 0], offset: 0 })
      })
    })

    expect(shouldUpdate).toBeCalled()
    expect(selector).toBeCalledTimes(2)
    expect(result.current).toBe(initialVersion)

    await act(async () => {
      editor.update(() => {
        editor.select({ path: [1, 0], offset: 0 })
      })
    })

    expect(selector).toBeCalledTimes(3)
    expect(result.current).toBe(Editor.getLastCommit(editor)?.version)
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
      editor.update(() => {
        editor.insertText('!', { at: { path: [1, 0], offset: 3 } })
      })
    })

    expect(result.current).toEqual({ nodeText: 'one', text: 'one' })
    expect(nodeSelector).toBeCalledTimes(2)
    expect(textSelector).toBeCalledTimes(2)

    await act(async () => {
      editor.update(() => {
        editor.insertText('!', { at: { path: [0, 0], offset: 3 } })
      })
    })

    expect(result.current).toEqual({ nodeText: 'one!', text: 'one!' })
    expect(nodeSelector).toBeCalledTimes(3)
    expect(textSelector).toBeCalledTimes(3)
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
      editor.update(() => {
        editor.insertText('!', { at: { path: [0, 0], offset: 3 } })
      })
    })

    expect(result.current).toEqual({ nodeText: 'one', text: 'one' })
    expect(nodeSelector).toBeCalledTimes(callsAfterMount.node)
    expect(textSelector).toBeCalledTimes(callsAfterMount.text)

    await act(async () => {
      editor.update(() => {
        editor.setNodes({ tone: true } as never, { at: [0, 0] })
      })
    })

    expect(result.current.text).toBe('one!')
    expect(textSelector.mock.calls.length).toBeGreaterThan(callsAfterMount.text)

    await act(async () => {
      editor.update(() => {
        editor.setNodes({ tone: 'block' } as never, { at: [0] })
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
        selectedTopLevelIndex: useSelectedTopLevelIndex(true),
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
      editor.update(() => {
        editor.select({ path: [1, 0], offset: 0 })
      })
    })

    expect(result.current.selectedTopLevelIndex).toBe(1)
    expect(result.current.topLevelRuntimeIds).toBe(initialRootRuntimeIds)

    await act(async () => {
      editor.update(() => {
        editor.insertText('!', { at: { path: [1, 0], offset: 3 } })
      })
    })

    expect(result.current.topLevelRuntimeIds).toBe(initialRootRuntimeIds)

    await act(async () => {
      editor.update(() => {
        editor.insertNodes(
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
      editor.update(() => {
        editor.insertText('x', { at: { path: [0, 0], offset: 0 } })
      })
    })

    expect(result.current).toBeUndefined()

    await act(async () => {
      editor.update(() => {
        editor.delete({
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
      editor.update(() => {
        editor.select({ path: [0, 0], offset: 0 })
      })
    })

    expect(result.current).toBe('Type something')
    expect(renderCount).toBe(renderCountAfterMount)
  })
})
