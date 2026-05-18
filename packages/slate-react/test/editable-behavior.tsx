import { act, fireEvent, render } from '@testing-library/react'
import { TextApi } from 'slate'
import { Editor } from 'slate/internal'
import {
  createReactEditor,
  defaultScrollSelectionIntoView,
  Editable,
  Slate,
} from '../src'

describe('slate-react editable behavior', () => {
  test('renders initial editor children into the editable DOM', () => {
    const initialValue = [{ type: 'block', children: [{ text: 'test' }] }]
    const editor = createReactEditor({ initialValue })

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
    const editor = createReactEditor({ initialValue })
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
    const editor = createReactEditor({ initialValue })
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
    const editor = createReactEditor({ initialValue })
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
            match: TextApi.isText,
            split: true,
          }
        )
      })
    })

    expect(onChange).toHaveBeenCalled()
    expect(onValueChange).toHaveBeenCalled()
  })

  test('Editable onKeyDown receives editor context for UI hotkeys', async () => {
    const initialValue = [{ type: 'block', children: [{ text: 'test' }] }]
    const editor = createReactEditor({ initialValue })
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

  test('Editable onDOMBeforeInput exposes raw native format input', async () => {
    const initialValue = [{ type: 'block', children: [{ text: 'test' }] }]
    const editor = createReactEditor({ initialValue })
    const onDOMBeforeInput = jest.fn((event, context) => {
      if (event.inputType !== 'formatBold') {
        return
      }

      expect(context.editor).toBe(editor)
      expect(context.inputType).toBe('formatBold')
      expect(context.native).toBe(false)
      event.preventDefault()
      return true
    })

    let rendered!: ReturnType<typeof render>
    act(() => {
      rendered = render(
        <Slate editor={editor}>
          <Editable onDOMBeforeInput={onDOMBeforeInput} />
        </Slate>
      )
    })

    const editable = rendered.container.querySelector('[data-slate-editor]')
    expect(editable).toBeTruthy()
    Object.defineProperty(editable, 'isContentEditable', {
      configurable: true,
      value: true,
    })

    const event = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'formatBold',
    })

    await act(async () => {
      editable!.dispatchEvent(event)
    })

    expect(onDOMBeforeInput).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  test('Editable onBeforeInput is not replayed from native beforeinput', async () => {
    const initialValue = [{ type: 'block', children: [{ text: 'test' }] }]
    const editor = createReactEditor({ initialValue })
    const onBeforeInput = jest.fn()
    const onDOMBeforeInput = jest.fn()

    let rendered!: ReturnType<typeof render>
    act(() => {
      rendered = render(
        <Slate editor={editor}>
          <Editable
            onBeforeInput={onBeforeInput}
            onDOMBeforeInput={onDOMBeforeInput}
          />
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
      editable!.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'formatBold',
        })
      )
    })

    expect(onDOMBeforeInput).toHaveBeenCalledTimes(1)
    expect(onBeforeInput).not.toHaveBeenCalled()
  })

  test('default scroll restores leaf measurement after scrolling a collapsed range', () => {
    const editor = createReactEditor()

    Editor.replace(editor, {
      children: [{ type: 'block', children: [{ text: 'test' }] }],
      selection: {
        anchor: { path: [0, 0], offset: 4 },
        focus: { path: [0, 0], offset: 4 },
      },
    })

    const leaf = document.createElement('span')
    const text = document.createTextNode('test')
    leaf.append(text)
    document.body.append(leaf)

    const range = {
      cloneRange: () => ({
        collapse: () => {},
        getBoundingClientRect: () =>
          ({
            bottom: 1,
            height: 1,
            left: 1,
            right: 1,
            top: 1,
            width: 1,
            x: 1,
            y: 1,
          }) as DOMRect,
        startContainer: text,
      }),
    } as unknown as DOMRange

    try {
      defaultScrollSelectionIntoView(editor, range)

      expect(Object.hasOwn(leaf, 'getBoundingClientRect')).toBe(false)
      expect(typeof leaf.getBoundingClientRect).toBe('function')

      defaultScrollSelectionIntoView(editor, range)

      expect(Object.hasOwn(leaf, 'getBoundingClientRect')).toBe(false)
      expect(typeof leaf.getBoundingClientRect).toBe('function')
    } finally {
      leaf.remove()
    }
  })
})
