import { act, render, waitFor } from '@testing-library/react'
import React from 'react'
import { createEditor } from 'slate'
import { Editor } from 'slate/internal'

import { Editable, Slate, withReact } from '../src'

const getFirstElement = (container: HTMLElement) => {
  const element = container.querySelector('[data-slate-node="element"]')

  if (!(element instanceof HTMLElement)) {
    throw new Error('Expected the editor to render a block element.')
  }

  return element
}

const getZeroWidthLineBreaks = (element: HTMLElement) =>
  Array.from(element.querySelectorAll('[data-slate-zero-width="n"]')).filter(
    (zeroWidth) => zeroWidth.querySelector('br')
  )

describe('rendered DOM shape contract', () => {
  test('custom element and text renderers include mounted path metadata', () => {
    const editor = withReact(createEditor())

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [{ text: 'path metadata' }],
        },
      ],
      selection: null,
    })

    const rendered = render(
      <Slate editor={editor}>
        <Editable
          id="rendered-dom-shape-path-metadata"
          renderElement={({ attributes, children }) => (
            <p {...attributes}>{children}</p>
          )}
          renderLeaf={({ attributes, children }) => (
            <span {...attributes}>{children}</span>
          )}
        />
      </Slate>
    )
    const block = getFirstElement(rendered.container)
    const text = rendered.container.querySelector('[data-slate-node="text"]')

    expect(block.getAttribute('data-slate-path')).toBe('0')
    expect(text?.getAttribute('data-slate-path')).toBe('0,0')
  })

  test('non-empty blocks do not render empty marked leaves as visual line breaks', () => {
    const editor = withReact(createEditor())

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [
            { text: 'This is editable ' },
            { bold: true, text: 'rich' },
            { text: ' text, ' },
            { italic: true, text: 'much' },
            { text: ' ' },
            { code: true, text: '' },
            { text: '' },
          ],
        },
      ],
      selection: null,
    })

    const rendered = render(
      <Slate editor={editor}>
        <Editable id="rendered-dom-shape-invalid-empty-leaves" />
      </Slate>
    )
    const block = getFirstElement(rendered.container)

    expect(block.textContent?.replaceAll('\uFEFF', '')).toBe(
      'This is editable rich text, much '
    )
    expect(getZeroWidthLineBreaks(block)).toHaveLength(0)
  })

  test('empty blocks still render one line-break placeholder', () => {
    const editor = withReact(createEditor())

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [{ text: '' }],
        },
      ],
      selection: null,
    })

    const rendered = render(
      <Slate editor={editor}>
        <Editable id="rendered-dom-shape-empty-block" />
      </Slate>
    )
    const block = getFirstElement(rendered.container)

    expect(getZeroWidthLineBreaks(block)).toHaveLength(1)
  })

  test('custom placeholder height contributes to editable root height', async () => {
    const editor = withReact(createEditor())
    const originalGetBoundingClientRect =
      HTMLElement.prototype.getBoundingClientRect

    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.matches('[data-slate-placeholder="true"]')) {
        return {
          bottom: 86,
          height: 86,
          left: 0,
          right: 200,
          top: 0,
          width: 200,
          x: 0,
          y: 0,
          toJSON() {
            return this
          },
        } as DOMRect
      }

      return originalGetBoundingClientRect.call(this)
    }

    try {
      Editor.replace(editor, {
        children: [
          {
            type: 'paragraph',
            children: [{ text: '' }],
          },
        ],
        selection: null,
      })

      const rendered = render(
        <Slate editor={editor}>
          <Editable
            id="rendered-dom-shape-custom-placeholder-height"
            placeholder="Type something"
            renderPlaceholder={({ attributes, children }) => (
              <div {...attributes}>
                <p>{children}</p>
                <pre>custom placeholder</pre>
              </div>
            )}
          />
        </Slate>
      )
      const editable = rendered.container.querySelector(
        '[data-slate-editor="true"]'
      ) as HTMLElement | null

      await waitFor(() => {
        expect(editable?.style.minHeight).toBe('86px')
      })
    } finally {
      HTMLElement.prototype.getBoundingClientRect =
        originalGetBoundingClientRect
    }
  })

  test('custom placeholder restores children and height after deleting text', async () => {
    const editor = withReact(createEditor())
    const originalGetBoundingClientRect =
      HTMLElement.prototype.getBoundingClientRect

    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.matches('[data-slate-placeholder="true"]')) {
        return {
          bottom: 86,
          height: 86,
          left: 0,
          right: 200,
          top: 0,
          width: 200,
          x: 0,
          y: 0,
          toJSON() {
            return this
          },
        } as DOMRect
      }

      return originalGetBoundingClientRect.call(this)
    }

    try {
      Editor.replace(editor, {
        children: [
          {
            type: 'paragraph',
            children: [{ text: '' }],
          },
        ],
        selection: null,
      })

      const rendered = render(
        <Slate editor={editor}>
          <Editable
            id="rendered-dom-shape-custom-placeholder-delete-empty"
            placeholder="Type something"
            renderPlaceholder={({ attributes, children }) => (
              <div {...attributes}>
                <p>{children}</p>
                <pre>custom placeholder</pre>
              </div>
            )}
          />
        </Slate>
      )
      const editable = rendered.container.querySelector(
        '[data-slate-editor="true"]'
      ) as HTMLElement | null

      await waitFor(() => {
        const placeholder = rendered.container.querySelector(
          '[data-slate-placeholder="true"]'
        )

        expect(placeholder?.textContent).toContain('Type something')
        expect(editable?.style.minHeight).toBe('86px')
      })

      await act(async () => {
        editor.update((tx) => {
          tx.text.insert('abc', { at: { path: [0, 0], offset: 0 } })
        })
      })

      await waitFor(() => {
        expect(
          rendered.container.querySelector('[data-slate-placeholder="true"]')
        ).toBeNull()
        expect(editable?.style.minHeight).toBe('')
      })

      await act(async () => {
        editor.update((tx) => {
          tx.text.delete({
            at: {
              anchor: { path: [0, 0], offset: 0 },
              focus: { path: [0, 0], offset: 3 },
            },
          })
        })
      })

      await waitFor(() => {
        const placeholder = rendered.container.querySelector(
          '[data-slate-placeholder="true"]'
        )

        expect(placeholder?.textContent).toContain('Type something')
        expect(editable?.style.minHeight).toBe('86px')
      })
    } finally {
      HTMLElement.prototype.getBoundingClientRect =
        originalGetBoundingClientRect
    }
  })
})
