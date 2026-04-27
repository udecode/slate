import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { createEditor } from 'slate'
import {
  Editable,
  ReactEditor,
  RenderElementProps,
  Slate,
  useSelected,
  withReact,
} from '../src'

describe('slate-react surface contract', () => {
  test('Editable defaults translate="no" and allows override', () => {
    const editor = withReact(createEditor())
    const initialValue = [{ type: 'block', children: [{ text: 'test' }] }]

    const defaultRender = render(
      <Slate editor={editor} initialValue={initialValue}>
        <Editable />
      </Slate>
    )

    expect(
      defaultRender.container
        .querySelector('[data-slate-editor]')
        ?.getAttribute('translate')
    ).toBe('no')

    defaultRender.rerender(
      <Slate editor={editor} initialValue={initialValue}>
        <Editable translate="yes" />
      </Slate>
    )

    expect(
      defaultRender.container
        .querySelector('[data-slate-editor]')
        ?.getAttribute('translate')
    ).toBe('yes')
  })

  test('structured render surface keeps mount identity stable across split and merge', async () => {
    const editor = withReact(createEditor())
    const mounts = jest.fn()

    const renderElement = ({ children }: RenderElementProps) => {
      useEffect(() => mounts(), [])
      return <div>{children}</div>
    }

    const rendered = render(
      <Slate
        editor={editor}
        initialValue={[{ type: 'block', children: [{ text: 'test' }] }]}
      >
        <Editable renderElement={renderElement} />
      </Slate>
    )

    await act(async () => {
      editor.update(() => {
        editor.splitNodes({ at: { path: [0, 0], offset: 2 } })
      })
    })

    expect(mounts).toHaveBeenCalledTimes(2)
    rendered.unmount()

    const mergeEditor = withReact(createEditor())
    const mergeMounts = jest.fn()

    const mergeRenderElement = ({ children }: RenderElementProps) => {
      useEffect(() => mergeMounts(), [])
      return <div>{children}</div>
    }

    render(
      <Slate
        editor={mergeEditor}
        initialValue={[
          { type: 'block', children: [{ text: 'te' }] },
          { type: 'block', children: [{ text: 'st' }] },
        ]}
      >
        <Editable renderElement={mergeRenderElement} />
      </Slate>
    )

    await act(async () => {
      mergeEditor.update(() => {
        mergeEditor.mergeNodes({ at: { path: [0, 0], offset: 0 } })
      })
    })

    expect(mergeMounts).toHaveBeenCalledTimes(2)
  })

  test('useSelected remains stable when the selected element path shifts after structural edits', async () => {
    const editor = withReact(createEditor()) as ReactEditor
    const elementSelectedRenders: Record<string, boolean[] | undefined> = {}

    const renderElement = ({
      element,
      attributes,
      children,
    }: RenderElementProps) => {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const selected = useSelected()
      const { id } = element as { id: string }

      let selectedRenders = elementSelectedRenders[id]

      if (!selectedRenders) {
        selectedRenders = []
        elementSelectedRenders[id] = selectedRenders
      }

      selectedRenders.push(selected)

      return <div {...attributes}>{children}</div>
    }

    render(
      <Slate
        editor={editor}
        initialValue={[
          {
            id: '0',
            children: [
              { id: '0.0', children: [{ text: '' }] },
              { id: '0.1', children: [{ text: '' }] },
              { id: '0.2', children: [{ text: '' }] },
            ],
          },
          { id: '1', children: [{ text: '' }] },
          { id: '2', children: [{ text: '' }] },
        ]}
      >
        <Editable renderElement={renderElement} />
      </Slate>
    )

    Object.values(elementSelectedRenders).forEach((selectedRenders) => {
      selectedRenders?.splice(0, selectedRenders.length)
    })

    await act(async () => {
      editor.update(() => {
        editor.select({ path: [2, 0], offset: 0 })
      })
    })

    expect(elementSelectedRenders).toEqual({
      '0': [],
      '0.0': [],
      '0.1': [],
      '0.2': [],
      '1': [],
      '2': [true],
    })

    Object.values(elementSelectedRenders).forEach((selectedRenders) => {
      selectedRenders?.splice(0, selectedRenders.length)
    })

    await act(async () => {
      editor.update(() => {
        editor.insertNodes({ id: 'new', children: [{ text: '' }] } as never, {
          at: [2],
        })
      })
    })

    expect(elementSelectedRenders).toEqual({
      '0': [],
      '0.0': [],
      '0.1': [],
      '0.2': [],
      '1': [],
      new: [false, false],
      '2': [true],
    })
  })
})
