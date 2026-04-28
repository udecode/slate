import { act, render } from '@testing-library/react'
import { createEditor, Text } from 'slate'
import { Editable, Slate, withReact } from '../src'

describe('slate-react editable behavior', () => {
  test('renders initial editor children into the editable DOM', () => {
    const editor = withReact(createEditor())
    const initialValue = [{ type: 'block', children: [{ text: 'test' }] }]

    const rendered = render(
      <Slate editor={editor} initialValue={initialValue}>
        <Editable />
      </Slate>
    )

    expect(
      rendered.container.querySelector('[data-slate-editor]')
    ).toHaveTextContent('test')
  })

  test('calls onSelectionChange when editor selection changes', async () => {
    const editor = withReact(createEditor())
    const initialValue = [
      { type: 'block', children: [{ text: 'te' }] },
      { type: 'block', children: [{ text: 'st' }] },
    ]
    const onSnapshotChange = jest.fn()
    const onValueChange = jest.fn()
    const onSelectionChange = jest.fn()

    act(() => {
      render(
        <Slate
          editor={editor}
          initialValue={initialValue}
          onSelectionChange={onSelectionChange}
          onSnapshotChange={onSnapshotChange}
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
    expect(onSnapshotChange).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: {
          anchor: { path: [0, 0], offset: 2 },
          focus: { path: [0, 0], offset: 2 },
        },
      }),
      expect.objectContaining({ selectionChanged: true })
    )
    expect(onValueChange).not.toHaveBeenCalled()
  })

  test('calls onValueChange when editor children change', async () => {
    const editor = withReact(createEditor())
    const initialValue = [{ type: 'block', children: [{ text: 'test' }] }]
    const onSnapshotChange = jest.fn()
    const onValueChange = jest.fn()
    const onSelectionChange = jest.fn()

    act(() => {
      render(
        <Slate
          editor={editor}
          initialValue={initialValue}
          onSelectionChange={onSelectionChange}
          onSnapshotChange={onSnapshotChange}
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
    expect(onSnapshotChange).toHaveBeenCalledWith(
      expect.objectContaining({
        children: [{ type: 'block', children: [{ text: 'testHello word!' }] }],
      }),
      expect.objectContaining({ childrenChanged: true })
    )
    expect(onSelectionChange).not.toHaveBeenCalled()
  })

  test('calls onValueChange when setNodes changes text shape', async () => {
    const editor = withReact(createEditor())
    const initialValue = [{ type: 'block', children: [{ text: 'test' }] }]
    const onSnapshotChange = jest.fn()
    const onValueChange = jest.fn()
    const onSelectionChange = jest.fn()

    act(() => {
      render(
        <Slate
          editor={editor}
          initialValue={initialValue}
          onSelectionChange={onSelectionChange}
          onSnapshotChange={onSnapshotChange}
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

    expect(onSnapshotChange).toHaveBeenCalled()
    expect(onValueChange).toHaveBeenCalled()
    expect(onSelectionChange).not.toHaveBeenCalled()
  })
})
