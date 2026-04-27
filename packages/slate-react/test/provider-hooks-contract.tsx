import { act, render, renderHook } from '@testing-library/react'
import _ from 'lodash'
import { createEditor } from 'slate'
import {
  Editable,
  Slate,
  useSlate,
  useSlateSelector,
  useSlateStatic,
  useSlateWithV,
  withReact,
} from '../src'

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
})
