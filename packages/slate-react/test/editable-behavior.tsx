import { act, fireEvent, render } from '@testing-library/react'
import { createEditor, Text } from 'slate'
import { Editable, Slate, withReact } from '../src'

describe('slate-react editable behavior', () => {
  test('renders initial editor children into the editable DOM', () => {
    const initialValue = [{ type: 'block', children: [{ text: 'test' }] }]
    const editor = withReact(createEditor({ initialValue }))

    const rendered = render(
      <Slate editor={editor}>
        <Editable />
      </Slate>
    )

    expect(
      rendered.container.querySelector('[data-slate-editor]')
    ).toHaveTextContent('test')
  })

  test('calls onChange and onSelectionChange when editor selection changes', async () => {
    const initialValue = [
      { type: 'block', children: [{ text: 'te' }] },
      { type: 'block', children: [{ text: 'st' }] },
    ]
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
      editor.update((tx) => {
        tx.selection.set({ path: [0, 0], offset: 2 })
      })
    })

    const expectedSelection = {
      anchor: { path: [0, 0], offset: 2 },
      focus: { path: [0, 0], offset: 2 },
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

  test('calls onChange and onValueChange when editor children change', async () => {
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
      editor.update((tx) => {
        tx.text.insert('Hello word!', { at: { path: [0, 0], offset: 4 } })
      })
    })

    const expectedValue = [
      { type: 'block', children: [{ text: 'testHello word!' }] },
    ]

    expect(onChange).toHaveBeenCalledWith(
      expectedValue,
      expect.objectContaining({
        selectionChanged: false,
        valueChanged: true,
      })
    )
    expect(onValueChange).toHaveBeenCalledWith(
      expectedValue,
      expect.objectContaining({ valueChanged: true })
    )
    expect(onSelectionChange).not.toHaveBeenCalled()
  })

  test('calls value callbacks when setNodes changes text shape', async () => {
    const initialValue = [{ type: 'block', children: [{ text: 'test' }] }]
    const editor = withReact(createEditor({ initialValue }))
    const onChange = jest.fn()
    const onValueChange = jest.fn()

    act(() => {
      render(
        <Slate
          editor={editor}
          onChange={onChange}
          onValueChange={onValueChange}
        >
          <Editable />
        </Slate>
      )
    })

    await act(async () => {
      editor.update((tx) => {
        tx.nodes.set(
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
  })

  test('Editable onKeyDown receives editor context and can handle model commands', async () => {
    const initialValue = [{ type: 'block', children: [{ text: 'test' }] }]
    const editor = withReact(createEditor({ initialValue }))
    const onChange = jest.fn()
    const onKeyDown = jest.fn((event, context) => {
      if (event.key !== 'x') {
        return
      }

      context.editor.update((tx) => {
        tx.text.insert('x', { at: { path: [0, 0], offset: 4 } })
      })

      return true
    })

    let rendered!: ReturnType<typeof render>
    act(() => {
      rendered = render(
        <Slate editor={editor} onChange={onChange}>
          <Editable onKeyDown={onKeyDown} />
        </Slate>
      )
    })

    const editable = rendered.container.querySelector('[data-slate-editor]')
    expect(editable).toBeTruthy()
    Object.defineProperty(editable, 'isContentEditable', {
      configurable: true,
      value: true,
    })

    await act(async () => {
      fireEvent.keyDown(editable!, { key: 'x' })
    })

    expect(onKeyDown).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'x' }),
      { editor }
    )
    expect(onChange).toHaveBeenCalledWith(
      [{ type: 'block', children: [{ text: 'testx' }] }],
      expect.objectContaining({ valueChanged: true })
    )
  })
})
