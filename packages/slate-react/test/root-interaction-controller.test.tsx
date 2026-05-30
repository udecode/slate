import { act, fireEvent, render, screen } from '@testing-library/react'
import type { Descendant } from 'slate'
import { afterEach } from 'vitest'

import { createReactEditor, Editable, Slate } from '../src'

const paragraph = (text: string): Descendant => ({
  type: 'paragraph',
  children: [{ text }],
})

const rect = ({
  bottom = 20,
  left,
  right,
  top = 0,
}: {
  bottom?: number
  left: number
  right: number
  top?: number
}) =>
  ({
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect

const rangeDescriptor = Object.getOwnPropertyDescriptor(
  Range.prototype,
  'getClientRects'
)

afterEach(() => {
  if (rangeDescriptor) {
    Object.defineProperty(Range.prototype, 'getClientRects', rangeDescriptor)
  } else {
    delete (Range.prototype as Partial<Range>).getClientRects
  }
})

describe('root interaction controller', () => {
  test('prevents native fallback on focused blank editable-root clicks', async () => {
    const editor = createReactEditor({
      initialValue: {
        roots: {
          main: [paragraph('body')],
        },
      },
    })

    render(
      <Slate editor={editor}>
        <Editable aria-label="Main editor" layout={{}} />
      </Slate>
    )

    const editable = screen.getByLabelText('Main editor')

    await act(async () => {
      editable.focus()
    })

    expect(document.activeElement).toBe(editable)
    expect(fireEvent.mouseDown(editable)).toBe(false)
  })

  test('owns focused native-editable coordinate placements in layout mode', async () => {
    const editor = createReactEditor({
      initialValue: {
        roots: {
          main: [paragraph('body')],
        },
      },
    })

    render(
      <Slate editor={editor}>
        <Editable aria-label="Main editor" layout={{}} />
      </Slate>
    )

    const editable = screen.getByLabelText('Main editor')
    const string = editable.querySelector<HTMLElement>('[data-slate-string]')

    expect(string).toBeTruthy()

    Object.defineProperty(string!, 'getClientRects', {
      configurable: true,
      value: () => [rect({ left: 10, right: 80 })],
    })
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [rect({ left: 10, right: 30 })],
    })

    await act(async () => {
      editable.focus()
    })

    expect(document.activeElement).toBe(editable)
    expect(fireEvent.mouseDown(string!, { clientX: 8, clientY: 10 })).toBe(
      false
    )
  })
})
