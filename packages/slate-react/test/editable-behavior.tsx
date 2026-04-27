import { act, render } from '@testing-library/react'
import { createEditor, Text } from 'slate'
import { Editable, Slate, withReact } from '../src'

describe('slate-react editable behavior', () => {
  test('calls onSelectionChange when editor selection changes', async () => {
    const editor = withReact(createEditor())
    const initialValue = [
      { type: 'block', children: [{ text: 'te' }] },
      { type: 'block', children: [{ text: 'st' }] },
    ]
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
      editor.update(() => {
        editor.select({ path: [0, 0], offset: 2 })
      })
    })

    expect(onSelectionChange).toHaveBeenCalled()
    expect(onChange).toHaveBeenCalled()
    expect(onValueChange).not.toHaveBeenCalled()
  })

  test('calls onValueChange when editor children change', async () => {
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
      editor.update(() => {
        editor.insertText('Hello word!', { at: { path: [0, 0], offset: 4 } })
      })
    })

    expect(onValueChange).toHaveBeenCalled()
    expect(onChange).toHaveBeenCalled()
    expect(onSelectionChange).not.toHaveBeenCalled()
  })

  test('calls onValueChange when setNodes changes text shape', async () => {
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
      editor.update(() => {
        editor.setNodes(
          { bold: true },
          {
            at: { path: [0, 0], offset: 2 },
            match: Text.isText,
            split: true,
          }
        )
      })
    })

    expect(onChange).toHaveBeenCalled()
    expect(onValueChange).toHaveBeenCalled()
    expect(onSelectionChange).not.toHaveBeenCalled()
  })
})
