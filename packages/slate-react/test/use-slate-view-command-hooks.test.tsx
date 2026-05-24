import { act, fireEvent, render, screen } from '@testing-library/react'
import { useLayoutEffect } from 'react'

import {
  createReactEditor,
  Editable,
  Slate,
  useSlateCommandCallback,
  useSlateViewEffect,
} from '../src'

const initialValue = [{ type: 'block', children: [{ text: 'test' }] }]

describe('slate-react view and command hooks', () => {
  test('useSlateViewEffect runs after child layout effects with the committed root editor', () => {
    const editor = createReactEditor({ initialValue })
    const calls: { childLayoutSeen: string | null; root: string }[] = []

    const Probe = () => {
      useLayoutEffect(() => {
        screen
          .getByTestId('view-effect-root')
          .setAttribute('data-child-layout', 'ready')
      }, [])

      useSlateViewEffect((viewEditor) => {
        calls.push({
          childLayoutSeen: screen
            .getByTestId('view-effect-root')
            .getAttribute('data-child-layout'),
          root: viewEditor.read((state) => state.view.root()),
        })
      })

      return null
    }

    render(
      <Slate editor={editor}>
        <Editable data-testid="view-effect-root" />
        <Probe />
      </Slate>
    )

    expect(calls).toEqual([{ childLayoutSeen: 'ready', root: 'main' }])
  })

  test('useSlateViewEffect stays registered across editor commits', async () => {
    const editor = createReactEditor({ initialValue })
    const calls: string[] = []

    const Probe = () => {
      useSlateViewEffect(
        (viewEditor) => {
          calls.push(
            viewEditor.read((state) => {
              const [firstBlock] = state.nodes.children() as {
                children: { text: string }[]
              }[]

              return firstBlock?.children[0]?.text ?? ''
            })
          )
        },
        { deps: [] }
      )

      return null
    }

    render(
      <Slate editor={editor}>
        <Editable />
        <Probe />
      </Slate>
    )

    await act(async () => {
      editor.update((tx) => {
        tx.text.insert('!', { at: { path: [0, 0], offset: 4 } })
      })
    })

    expect(calls).toEqual(['test', 'test!'])
  })

  test('useSlateViewEffect with explicit deps ignores focus-only context changes', async () => {
    const editor = createReactEditor({ initialValue })
    const calls: string[] = []
    const cleanups: string[] = []

    const Probe = () => {
      useSlateViewEffect(
        () => {
          calls.push('effect')

          return () => {
            cleanups.push('cleanup')
          }
        },
        { deps: [] }
      )

      return null
    }

    render(
      <Slate editor={editor}>
        <Editable aria-label="Editor" />
        <Probe />
      </Slate>
    )

    await act(async () => {
      fireEvent.focusIn(screen.getByLabelText('Editor'))
      fireEvent.focusOut(screen.getByLabelText('Editor'))
    })

    expect(calls).toEqual(['effect'])
    expect(cleanups).toEqual([])
  })

  test('useSlateViewEffect reruns when deps change without an editor commit', () => {
    const editor = createReactEditor({ initialValue })
    const calls: string[] = []

    const Probe = ({ label }: { label: string }) => {
      useSlateViewEffect(
        () => {
          calls.push(label)
        },
        { deps: [label] }
      )

      return null
    }

    const rendered = render(
      <Slate editor={editor}>
        <Editable />
        <Probe label="first" />
      </Slate>
    )

    expect(calls).toEqual(['first'])

    rendered.rerender(
      <Slate editor={editor}>
        <Editable />
        <Probe label="second" />
      </Slate>
    )

    expect(calls).toEqual(['first', 'second'])
  })

  test('useSlateViewEffect without deps reruns on React rerenders', () => {
    const editor = createReactEditor({ initialValue })
    const calls: string[] = []

    const Probe = ({ label }: { label: string }) => {
      useSlateViewEffect(() => {
        calls.push(label)
      })

      return null
    }

    const rendered = render(
      <Slate editor={editor}>
        <Editable />
        <Probe label="first" />
      </Slate>
    )

    expect(calls).toEqual(['first'])

    rendered.rerender(
      <Slate editor={editor}>
        <Editable />
        <Probe label="second" />
      </Slate>
    )

    expect(calls).toEqual(['first', 'second'])
  })

  test('useSlateCommandCallback keeps a stable handler while calling the latest callback with the target root editor', () => {
    const editor = createReactEditor({
      initialValue: {
        roots: {
          header: [{ type: 'block', children: [{ text: 'head' }] }],
          main: initialValue,
        },
      },
    })
    const calls: { label: string; root: string }[] = []
    const handlers: unknown[] = []

    const CommandButton = ({ label }: { label: string }) => {
      const command = useSlateCommandCallback(
        (viewEditor) => {
          calls.push({
            label,
            root: viewEditor.read((state) => state.view.root()),
          })
        },
        { root: 'header' }
      )

      handlers.push(command)

      return (
        <button onClick={() => command()} type="button">
          Run command
        </button>
      )
    }

    const rendered = render(
      <Slate editor={editor}>
        <Editable aria-label="Header editor" root="header" />
        <Editable aria-label="Body editor" />
        <CommandButton label="first" />
      </Slate>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Run command' }))

    rendered.rerender(
      <Slate editor={editor}>
        <Editable aria-label="Header editor" root="header" />
        <Editable aria-label="Body editor" />
        <CommandButton label="second" />
      </Slate>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Run command' }))

    expect(handlers[0]).toBe(handlers[1])
    expect(calls).toEqual([
      { label: 'first', root: 'header' },
      { label: 'second', root: 'header' },
    ])
  })
})
