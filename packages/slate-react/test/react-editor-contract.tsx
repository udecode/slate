import { act, render } from '@testing-library/react'
import { createEditor, Editor } from 'slate'
import { Editable, ReactEditor, Slate, withReact } from '../src'

describe('slate-react ReactEditor contract', () => {
  test('ReactEditor.focus initializes a null selection at the top of the document', async () => {
    const editor = withReact(createEditor())
    const initialValue = [{ type: 'block', children: [{ text: 'test' }] }]
    const expectedSelection = {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    }

    act(() => {
      render(
        <Slate editor={editor} initialValue={initialValue}>
          <Editable />
        </Slate>
      )
    })

    expect(Editor.getSelection(editor)).toBe(null)

    await act(async () => {
      ReactEditor.focus(editor)
    })

    expect(Editor.getSelection(editor)).toEqual(expectedSelection)

    const windowSelection = ReactEditor.getWindow(editor).getSelection()

    expect(windowSelection?.focusNode?.textContent).toBe('test')
    expect(windowSelection?.anchorNode?.textContent).toBe('test')
    expect(windowSelection?.anchorOffset).toBe(expectedSelection.anchor.offset)
    expect(windowSelection?.focusOffset).toBe(expectedSelection.focus.offset)
  })

  test('ReactEditor.focus stays safe when called mid-transform', async () => {
    const editor = withReact(createEditor())
    const initialValue = [{ type: 'block', children: [{ text: 'test' }] }]
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
        <Slate editor={editor} initialValue={initialValue}>
          <Editable />
        </Slate>
      )
    })

    await act(async () => {
      editor.update(() => {
        editor.removeNodes({ at: [0] })
        editor.insertNodes(propagatedValue)
        editor.select(expectedSelection)
      })
      ReactEditor.focus(editor)
    })

    expect(Editor.getSelection(editor)).toEqual(expectedSelection)

    await act(async () => {
      ReactEditor.focus(editor)
    })

    expect(Editor.getSelection(editor)).toEqual(expectedSelection)
  })

  test('ReactEditor.focus does not trigger onValueChange', async () => {
    const editor = withReact(createEditor())
    const initialValue = [{ type: 'block', children: [{ text: 'test' }] }]
    const onChange = jest.fn()
    const onValueChange = jest.fn()
    const onSelectionChange = jest.fn()

    act(() => {
      render(
        <Slate
          editor={editor}
          initialValue={initialValue}
          onChange={onChange}
          onSelectionChange={onSelectionChange}
          onValueChange={onValueChange}
        >
          <Editable />
        </Slate>
      )
    })

    await act(async () => {
      ReactEditor.focus(editor)
    })

    expect(Editor.getSelection(editor)).toEqual({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })
    expect(onChange).toHaveBeenCalled()
    expect(onSelectionChange).toHaveBeenCalled()
    expect(onValueChange).not.toHaveBeenCalled()
  })
})
