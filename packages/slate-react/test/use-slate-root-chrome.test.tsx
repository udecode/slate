import { act, fireEvent, render, screen } from '@testing-library/react'
import type { Descendant } from 'slate'

import {
  createReactEditor,
  Editable,
  Slate,
  useSlateRootChrome,
  useSlateRootEditor,
} from '../src'
import { createSlateProjectionGraph } from '../src/projection-graph'
import {
  createSlateViewSelection,
  readSlateViewSelection,
  writeSlateViewSelection,
} from '../src/view-selection'

const paragraph = (text: string): Descendant => ({
  type: 'paragraph',
  children: [{ text }],
})

const initialValue = () => ({
  roots: {
    header: [paragraph('header')],
    main: [paragraph('body')],
  },
})

const flushRootChromeFocus = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
      return
    }

    setTimeout(resolve, 0)
  })

describe('useSlateRootChrome', () => {
  test('focuses the requested root when clicking non-interactive chrome', async () => {
    const editor = createReactEditor({ initialValue: initialValue() })
    let headerEditor!: ReturnType<typeof useSlateRootEditor>

    const HeaderChrome = () => {
      const chrome = useSlateRootChrome('header')
      headerEditor = useSlateRootEditor('header')

      return (
        <section data-testid="header-chrome" {...chrome.props}>
          <span>Header chrome</span>
          <Editable aria-label="Header editor" root="header" />
        </section>
      )
    }

    render(
      <Slate editor={editor}>
        <HeaderChrome />
        <Editable aria-label="Main editor" />
      </Slate>
    )

    await act(async () => {
      fireEvent.mouseDown(screen.getByTestId('header-chrome'))
      await flushRootChromeFocus()
    })

    expect(headerEditor.read((state) => state.selection.get()?.anchor)).toEqual(
      {
        offset: 6,
        path: [0, 0],
        root: 'header',
      }
    )
  })

  test('ignores native editable text and interactive descendants', async () => {
    const editor = createReactEditor({ initialValue: initialValue() })

    const HeaderChrome = () => {
      const chrome = useSlateRootChrome('header')

      return (
        <section data-testid="header-chrome" {...chrome.props}>
          <button type="button">Header action</button>
          <div
            data-slate-node="element"
            data-testid="native-element-descendant"
          >
            Header paragraph
          </div>
          <span data-slate-string="" data-testid="native-text-descendant">
            Header text
          </span>
        </section>
      )
    }

    render(
      <Slate editor={editor}>
        <HeaderChrome />
      </Slate>
    )

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole('button', { name: 'Header action' }))
      await flushRootChromeFocus()
    })
    expect(editor.read((state) => state.selection.get())).toBeNull()

    await act(async () => {
      fireEvent.mouseDown(screen.getByTestId('native-text-descendant'))
      await flushRootChromeFocus()
    })
    expect(editor.read((state) => state.selection.get())).toBeNull()

    await act(async () => {
      fireEvent.mouseDown(screen.getByTestId('native-element-descendant'))
      await flushRootChromeFocus()
    })
    expect(editor.read((state) => state.selection.get())).toBeNull()
  })

  test('handles blank editable root clicks synchronously', async () => {
    const editor = createReactEditor({ initialValue: initialValue() })
    let headerEditor!: ReturnType<typeof useSlateRootEditor>

    const HeaderChrome = () => {
      const chrome = useSlateRootChrome('header')
      headerEditor = useSlateRootEditor('header')

      return (
        <section data-testid="header-chrome" {...chrome.props}>
          <div
            data-slate-editor="true"
            data-slate-root="header"
            data-testid="blank-editor-surface"
          />
        </section>
      )
    }

    render(
      <Slate editor={editor}>
        <HeaderChrome />
      </Slate>
    )

    fireEvent.mouseDown(screen.getByTestId('blank-editor-surface'))
    fireEvent.mouseUp(screen.getByTestId('blank-editor-surface'))
    await flushRootChromeFocus()

    expect(headerEditor.read((state) => state.selection.get()?.anchor)).toEqual(
      {
        offset: 6,
        path: [0, 0],
        root: 'header',
      }
    )
  })

  test("restores a root's previous selection when chrome reactivates it", async () => {
    const editor = createReactEditor({ initialValue: initialValue() })
    let headerEditor!: ReturnType<typeof useSlateRootEditor>
    let mainEditor!: ReturnType<typeof useSlateRootEditor>

    const HeaderChrome = () => {
      const chrome = useSlateRootChrome('header')
      headerEditor = useSlateRootEditor('header')
      mainEditor = useSlateRootEditor('main')

      return (
        <section data-testid="header-chrome" {...chrome.props}>
          <span>Header chrome</span>
          <Editable aria-label="Header editor" root="header" />
          <Editable aria-label="Main editor" />
        </section>
      )
    }

    render(
      <Slate editor={editor}>
        <HeaderChrome />
      </Slate>
    )

    await act(async () => {
      headerEditor.update((tx) => {
        tx.selection.set({ path: [0, 0], offset: 3 })
      })
    })
    await act(async () => {
      mainEditor.update((tx) => {
        tx.selection.set({ path: [0, 0], offset: 4 })
      })
    })

    await act(async () => {
      fireEvent.mouseDown(screen.getByText('Header chrome'))
      await flushRootChromeFocus()
    })

    expect(
      headerEditor.read((state) => state.selection.get()?.anchor.offset)
    ).toBe(3)
  })

  test('clears projected selections when chrome restores a root selection', async () => {
    const editor = createReactEditor({ initialValue: initialValue() })
    let headerEditor!: ReturnType<typeof useSlateRootEditor>
    let mainEditor!: ReturnType<typeof useSlateRootEditor>

    const HeaderChrome = () => {
      const chrome = useSlateRootChrome('header')
      headerEditor = useSlateRootEditor('header')
      mainEditor = useSlateRootEditor('main')

      return (
        <section data-testid="header-chrome" {...chrome.props}>
          <span>Header chrome</span>
          <Editable aria-label="Header editor" root="header" />
          <Editable aria-label="Main editor" />
        </section>
      )
    }

    render(
      <Slate editor={editor}>
        <HeaderChrome />
      </Slate>
    )

    await act(async () => {
      headerEditor.update((tx) => {
        tx.selection.set({ path: [0, 0], offset: 3 })
      })
    })
    await act(async () => {
      mainEditor.update((tx) => {
        tx.selection.set({ path: [0, 0], offset: 4 })
      })
    })

    const graph = createSlateProjectionGraph([
      { path: [0], root: 'header' },
      { path: [0], root: 'main' },
    ])
    const staleSelection = createSlateViewSelection(graph, {
      anchor: { point: { path: [0, 0], root: 'header', offset: 1 } },
      focus: { point: { path: [0, 0], offset: 1 } },
    })

    writeSlateViewSelection(headerEditor, staleSelection)
    expect(readSlateViewSelection(headerEditor)).toEqual(staleSelection)

    await act(async () => {
      fireEvent.mouseDown(screen.getByText('Header chrome'))
      await flushRootChromeFocus()
    })

    expect(readSlateViewSelection(headerEditor)).toBe(null)
    expect(
      headerEditor.read((state) => state.selection.get()?.anchor.offset)
    ).toBe(3)
  })
})
