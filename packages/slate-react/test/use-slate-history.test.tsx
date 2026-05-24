import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Descendant } from 'slate'

import {
  createReactEditor,
  Slate,
  useSlateHistory,
  useSlateRootEditor,
} from '../src'

const paragraph = (text: string): Descendant => ({
  type: 'paragraph',
  children: [{ text }],
})

const editorText = (editor: {
  read: <T>(fn: (state: { nodes: { children: () => Descendant[] } }) => T) => T
}) =>
  editor.read((state) => {
    const [firstBlock] = state.nodes.children() as {
      children: { text: string }[]
    }[]

    return firstBlock?.children[0]?.text ?? ''
  })

describe('useSlateHistory', () => {
  test('exposes undo and redo availability from the active root history', async () => {
    const editor = createReactEditor({
      initialValue: [paragraph('body')],
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Slate editor={editor}>{children}</Slate>
    )

    const { result } = renderHook(() => useSlateHistory(), { wrapper })

    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
    expect(result.current.root).toBe('main')

    await act(async () => {
      editor.update((tx) => {
        tx.selection.set({ path: [0, 0], offset: 4 })
        tx.text.insert('!')
      })
    })

    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)
  })

  test('undoes and redoes through the controller', async () => {
    const editor = createReactEditor({
      initialValue: [paragraph('body')],
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Slate editor={editor}>{children}</Slate>
    )

    const { result } = renderHook(() => useSlateHistory(), { wrapper })

    await act(async () => {
      editor.update((tx) => {
        tx.selection.set({ path: [0, 0], offset: 4 })
        tx.text.insert('!')
      })
    })

    await act(async () => {
      result.current.undo()
    })

    expect(editorText(editor)).toBe('body')
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(true)

    await act(async () => {
      result.current.redo()
    })

    expect(editorText(editor)).toBe('body!')
    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)
  })

  test('fixed-root external shortcut preserves the input focus', async () => {
    const editor = createReactEditor({
      initialValue: {
        roots: {
          header: [paragraph('header')],
          main: [paragraph('body')],
        },
      },
    })

    let headerEditor!: ReturnType<typeof useSlateRootEditor>

    const TitleInput = () => {
      const history = useSlateHistory({
        focusPolicy: 'preserve-dom',
        root: 'header',
      })
      headerEditor = useSlateRootEditor('header')

      return <input aria-label="Document title" onKeyDown={history.onKeyDown} />
    }

    render(
      <Slate editor={editor}>
        <TitleInput />
      </Slate>
    )

    await act(async () => {
      headerEditor.update((tx) => {
        tx.selection.set({ path: [0, 0], offset: 6 })
        tx.text.insert('!')
      })
    })

    const input = screen.getByLabelText('Document title')
    input.focus()

    await act(async () => {
      fireEvent.keyDown(input, { code: 'KeyZ', ctrlKey: true, key: 'z' })
    })

    expect(editorText(headerEditor)).toBe('header')
    expect(document.activeElement).toBe(input)
  })

  test('fixed-root availability follows sibling root history changes', async () => {
    const editor = createReactEditor({
      initialValue: {
        roots: {
          header: [paragraph('header')],
          main: [paragraph('body')],
        },
      },
    })
    let headerEditor!: ReturnType<typeof useSlateRootEditor>

    const Probe = () => {
      headerEditor = useSlateRootEditor('header')

      return null
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Slate editor={editor}>
        <Probe />
        {children}
      </Slate>
    )

    const { result } = renderHook(() => useSlateHistory({ root: 'main' }), {
      wrapper,
    })

    expect(result.current.canUndo).toBe(false)

    await act(async () => {
      headerEditor.update((tx) => {
        tx.selection.set({ path: [0, 0], offset: 6 })
        tx.text.insert('!')
      })
    })

    expect(result.current.canUndo).toBe(true)
  })
})
