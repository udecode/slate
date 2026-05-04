import { act, render } from '@testing-library/react'
import { createEditor } from 'slate'
import { Editor } from 'slate/internal'
import { Editable, Slate, withReact } from '../src'
import { ReactEditor } from '../src/plugin/react-editor'

describe('slate-react DOM capability contract', () => {
  test('editor.dom.focus initializes a null selection at the top of the document', async () => {
    const initialValue = [{ type: 'block', children: [{ text: 'test' }] }]
    const editor = withReact(createEditor({ initialValue }))
    const expectedSelection = {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    }

    act(() => {
      render(
        <Slate editor={editor}>
          <Editable />
        </Slate>
      )
    })

    expect(Editor.getSelection(editor)).toBe(null)

    await act(async () => {
      editor.dom.focus()
    })

    expect(Editor.getSelection(editor)).toEqual(expectedSelection)

    const windowSelection = editor.dom.getWindow().getSelection()

    expect(windowSelection?.focusNode?.textContent).toBe('test')
    expect(windowSelection?.anchorNode?.textContent).toBe('test')
    expect(windowSelection?.anchorOffset).toBe(expectedSelection.anchor.offset)
    expect(windowSelection?.focusOffset).toBe(expectedSelection.focus.offset)
  })

  test('editor.dom.focus stays safe when called mid-transform', async () => {
    const initialValue = [{ type: 'block', children: [{ text: 'test' }] }]
    const editor = withReact(createEditor({ initialValue }))
    const propagatedValue = [
      { type: 'block', children: [{ text: 'foo' }] },
      { type: 'block', children: [{ text: 'bar' }] },
    ]
    const expectedSelection = {
      anchor: { path: [1, 0], offset: 0 },
      focus: { path: [1, 0], offset: 3 },
    }

    act(() => {
      render(
        <Slate editor={editor}>
          <Editable />
        </Slate>
      )
    })

    await act(async () => {
      editor.update((tx) => {
        tx.nodes.remove({ at: [0] })
        tx.nodes.insert(propagatedValue)
        tx.selection.set(expectedSelection)
      })
      editor.dom.focus()
    })

    expect(Editor.getSelection(editor)).toEqual(expectedSelection)

    await act(async () => {
      editor.dom.focus()
    })

    expect(Editor.getSelection(editor)).toEqual(expectedSelection)
  })

  test('editor.dom.focus reports a selection change without a value change', async () => {
    const initialValue = [{ type: 'block', children: [{ text: 'test' }] }]
    const editor = withReact(createEditor({ initialValue }))
    const onChange = jest.fn()
    const onSelectionChange = jest.fn()
    const onValueChange = jest.fn()

    act(() => {
      render(
        <Slate
          editor={editor}
          onChange={onChange}
          onSelectionChange={onSelectionChange}
          onValueChange={onValueChange}
        >
          <Editable />
        </Slate>
      )
    })

    await act(async () => {
      editor.dom.focus()
    })

    expect(Editor.getSelection(editor)).toEqual({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })
    const expectedSelection = {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    }

    expect(onChange).toHaveBeenCalledWith(
      initialValue,
      expect.objectContaining({
        selection: expectedSelection,
        selectionChanged: true,
        valueChanged: false,
      })
    )
    expect(onSelectionChange).toHaveBeenCalledWith(
      expectedSelection,
      expect.objectContaining({ selectionChanged: true })
    )
    expect(onValueChange).not.toHaveBeenCalled()
  })

  test('DOM-present selection export uses direct endpoints for common model selections', async () => {
    const initialValue = [
      { type: 'block', children: [{ text: 'alpha' }] },
      { type: 'block', children: [{ text: 'bravo' }] },
    ]
    const editor = withReact(createEditor({ initialValue }))

    const mounted = render(
      <Slate editor={editor}>
        <Editable />
      </Slate>
    )
    const editable = mounted.container.querySelector('[data-slate-editor]')!
    const toDOMRange = jest.spyOn(ReactEditor, 'toDOMRange')

    await act(async () => {
      editor.update((tx) => {
        tx.selection.set({
          anchor: { path: [1, 0], offset: 2 },
          focus: { path: [1, 0], offset: 2 },
        })
      })
    })

    expect(toDOMRange).not.toHaveBeenCalled()
    expect(document.getSelection()?.anchorNode?.textContent).toBe('bravo')
    expect(document.getSelection()?.anchorOffset).toBe(2)

    toDOMRange.mockClear()

    await act(async () => {
      editor.update((tx) => {
        tx.selection.set({
          anchor: tx.points.start([]),
          focus: tx.points.end([]),
        })
      })
    })

    expect(toDOMRange).not.toHaveBeenCalled()
    expect(document.getSelection()?.anchorNode).toBe(editable)
    expect(document.getSelection()?.anchorOffset).toBe(0)
    expect(document.getSelection()?.focusNode).toBe(editable)
    expect(document.getSelection()?.focusOffset).toBe(
      editable.childNodes.length
    )

    toDOMRange.mockRestore()
  })

  test('large full-document selections stay model-backed instead of selecting every DOM child', async () => {
    const initialValue = Array.from({ length: 1001 }, (_, index) => ({
      type: 'block',
      children: [{ text: `block-${index}` }],
    }))
    const editor = withReact(createEditor({ initialValue }))

    const mounted = render(
      <Slate editor={editor}>
        <Editable />
      </Slate>
    )
    const editable = mounted.container.querySelector('[data-slate-editor]')!
    const toDOMRange = jest.spyOn(ReactEditor, 'toDOMRange')

    await act(async () => {
      editor.update((tx) => {
        tx.selection.set({
          anchor: tx.points.start([]),
          focus: tx.points.end([]),
        })
      })
    })

    expect(toDOMRange).not.toHaveBeenCalled()
    expect(document.getSelection()?.anchorNode).not.toBe(editable)
    expect(document.getSelection()?.focusNode).not.toBe(editable)

    toDOMRange.mockRestore()
  })

  test('browser handle resolves mounted elements by Slate path without DOM scans', () => {
    const initialValue = [{ type: 'block', children: [{ text: 'lookup' }] }]
    const editor = withReact(createEditor({ initialValue }))

    const mounted = render(
      <Slate editor={editor}>
        <Editable />
      </Slate>
    )
    const editable = mounted.container.querySelector('[data-slate-editor]') as
      | (HTMLDivElement & {
          __slateBrowserHandle?: {
            getElementByPath: (path: number[]) => HTMLElement | null
          }
        })
      | null
    const textElement = editable?.__slateBrowserHandle?.getElementByPath([0, 0])

    expect(textElement).toBeInstanceOf(HTMLElement)
    expect(textElement).toHaveAttribute('data-slate-node', 'text')
    expect(textElement?.textContent).toContain('lookup')
  })
})
