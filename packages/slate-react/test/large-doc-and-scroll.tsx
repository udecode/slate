import { act, render } from '@testing-library/react'
import React from 'react'
import { createEditor, type Descendant, Editor } from 'slate'
import { IS_COMPOSING } from 'slate-dom'

import { createSlateProjectionStore, Editable, withReact } from '../src'
import { didSyncTextPathToDOM } from '../src/hooks/use-slate-node-ref'

test('Editable largeDocument shells far islands without mounting editable descendants', async () => {
  const editor = createEditor()

  Editor.replace(editor, {
    children: Array.from({ length: 6 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `block-${index + 1}` }],
    })),
    selection: null,
  })

  const rendered = render(
    <Editable
      editor={editor}
      id="large-document-shells"
      largeDocument={{
        activeRadius: 0,
        enabled: true,
        islandSize: 2,
        threshold: 1,
      }}
    />
  )

  expect(
    rendered.container.querySelectorAll(
      '[data-slate-large-document-shell="true"]'
    ).length
  ).toBe(2)
  expect(
    rendered.container.querySelectorAll('[data-slate-node="text"]').length
  ).toBe(1)
  expect(
    rendered.container
      .querySelector(
        '[data-slate-large-document-shell="true"][data-slate-large-document-island="1"]'
      )
      ?.textContent?.includes('block-3')
  ).toBe(true)
})

test('Editable marks only default plain text as DOM-sync capable', async () => {
  const editor = createEditor()

  Editor.replace(editor, {
    children: [
      {
        type: 'paragraph',
        children: [{ text: 'alpha' }],
      },
    ],
    selection: null,
  })

  const rendered = render(
    <Editable
      editor={editor}
      id="large-document-default-dom-sync"
      largeDocument={{
        activeRadius: 0,
        enabled: true,
        islandSize: 2,
        threshold: 1,
      }}
    />
  )

  expect(
    rendered.container
      .querySelector('[data-slate-node="text"]')
      ?.getAttribute('data-slate-dom-sync')
  ).toBe('true')
  expect(
    rendered.container
      .querySelector('[data-slate-node="text"]')
      ?.hasAttribute('data-slate-dom-sync-reason')
  ).toBe(false)
})

test('Editable disables DOM text sync for app-owned text renderers', async () => {
  const editor = createEditor()

  Editor.replace(editor, {
    children: [
      {
        type: 'paragraph',
        children: [{ text: 'alpha' }],
      },
    ],
    selection: null,
  })

  const rendered = render(
    <Editable
      editor={editor}
      id="large-document-custom-render-text"
      largeDocument={{
        activeRadius: 0,
        enabled: true,
        islandSize: 2,
        threshold: 1,
      }}
      renderText={({ attributes, children }) => (
        <span {...attributes} data-custom-text="true">
          {children}
        </span>
      )}
    />
  )

  expect(
    rendered.container
      .querySelector('[data-slate-node="text"]')
      ?.hasAttribute('data-slate-dom-sync')
  ).toBe(false)
  expect(
    rendered.container
      .querySelector('[data-slate-node="text"]')
      ?.getAttribute('data-slate-dom-sync-reason')
  ).toBe('custom-text')
})

test('Editable disables DOM text sync for app-owned leaf and segment renderers', async () => {
  const leafEditor = createEditor()
  const segmentEditor = createEditor()

  const children: Descendant[] = [
    {
      type: 'paragraph',
      children: [{ text: 'alpha' }],
    },
  ]

  Editor.replace(leafEditor, {
    children,
    selection: null,
  })
  Editor.replace(segmentEditor, {
    children,
    selection: null,
  })

  const leafRendered = render(
    <Editable
      editor={leafEditor}
      id="large-document-custom-render-leaf"
      largeDocument={{
        activeRadius: 0,
        enabled: true,
        islandSize: 2,
        threshold: 1,
      }}
      renderLeaf={({ attributes, children }) => (
        <span {...attributes} data-custom-leaf="true">
          {children}
        </span>
      )}
    />
  )
  const segmentRendered = render(
    <Editable
      editor={segmentEditor}
      id="large-document-custom-render-segment"
      largeDocument={{
        activeRadius: 0,
        enabled: true,
        islandSize: 2,
        threshold: 1,
      }}
      renderSegment={(_segment, children) => (
        <span data-custom-segment="true">{children}</span>
      )}
    />
  )

  expect(
    leafRendered.container
      .querySelector('[data-slate-node="text"]')
      ?.hasAttribute('data-slate-dom-sync')
  ).toBe(false)
  expect(
    leafRendered.container
      .querySelector('[data-slate-node="text"]')
      ?.getAttribute('data-slate-dom-sync-reason')
  ).toBe('custom-leaf')
  expect(
    segmentRendered.container
      .querySelector('[data-slate-node="text"]')
      ?.hasAttribute('data-slate-dom-sync')
  ).toBe(false)
  expect(
    segmentRendered.container
      .querySelector('[data-slate-node="text"]')
      ?.getAttribute('data-slate-dom-sync-reason')
  ).toBe('custom-segment')
})

test('Editable disables DOM text sync when projections affect the text node', async () => {
  const editor = createEditor()

  Editor.replace(editor, {
    children: [
      {
        type: 'paragraph',
        children: [{ text: 'alpha' }],
      },
    ],
    selection: null,
  })

  const projectionStore = createSlateProjectionStore(editor, () => [
    {
      key: 'highlight-alpha',
      range: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 5 },
      },
    },
  ])

  const rendered = render(
    <Editable
      editor={editor}
      id="large-document-projection-dom-sync"
      largeDocument={{
        activeRadius: 0,
        enabled: true,
        islandSize: 2,
        threshold: 1,
      }}
      projectionStore={projectionStore}
    />
  )

  expect(
    rendered.container
      .querySelector('[data-slate-node="text"]')
      ?.hasAttribute('data-slate-dom-sync')
  ).toBe(false)
  expect(
    rendered.container
      .querySelector('[data-slate-node="text"]')
      ?.getAttribute('data-slate-dom-sync-reason')
  ).toBe('projection')

  projectionStore.destroy()
})

test('Editable disables DOM text sync for empty zero-width text', async () => {
  const editor = createEditor()

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
    <Editable
      editor={editor}
      id="large-document-empty-dom-sync"
      largeDocument={{
        activeRadius: 0,
        enabled: true,
        islandSize: 2,
        threshold: 1,
      }}
      placeholder="Write something"
    />
  )

  expect(
    rendered.container
      .querySelector('[data-slate-node="text"]')
      ?.hasAttribute('data-slate-dom-sync')
  ).toBe(false)
  expect(
    rendered.container
      .querySelector('[data-slate-node="text"]')
      ?.getAttribute('data-slate-dom-sync-reason')
  ).toBe('empty-text')
  expect(
    rendered.container.querySelector('[data-slate-zero-width]')
  ).toBeTruthy()
})

test('Editable falls back to React updates while composing', async () => {
  const editor = withReact(createEditor())

  Editor.replace(editor, {
    children: [
      {
        type: 'paragraph',
        children: [{ text: 'alpha' }],
      },
    ],
    selection: {
      anchor: { path: [0, 0], offset: 5 },
      focus: { path: [0, 0], offset: 5 },
    },
  })

  const rendered = render(
    <Editable
      editor={editor}
      id="large-document-composition-dom-sync"
      largeDocument={{
        activeRadius: 0,
        enabled: true,
        islandSize: 2,
        threshold: 1,
      }}
    />
  )

  IS_COMPOSING.set(editor, true)

  await act(async () => {
    editor.update(() => {
      editor.insertText('!')
    })
  })

  expect(didSyncTextPathToDOM(editor, [0, 0])).toBe(false)
  expect(rendered.container.textContent).toContain('alpha!')

  IS_COMPOSING.set(editor, false)
})

test('Editable largeDocument promotes a shelled island on mouse down', async () => {
  const editor = withReact(createEditor())

  Editor.replace(editor, {
    children: Array.from({ length: 6 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `block-${index + 1}` }],
    })),
    selection: null,
  })

  const rendered = render(
    <Editable
      editor={editor}
      id="large-document-promotion"
      largeDocument={{
        activeRadius: 0,
        enabled: true,
        islandSize: 2,
        threshold: 1,
      }}
    />
  )

  const targetShell = rendered.container.querySelector(
    '[data-slate-large-document-shell="true"][data-slate-large-document-island="1"]'
  )

  expect(
    targetShell instanceof
      rendered.container.ownerDocument.defaultView!.HTMLElement
  ).toBe(true)

  await act(async () => {
    targetShell!.dispatchEvent(
      new rendered.container.ownerDocument.defaultView!.MouseEvent(
        'mousedown',
        {
          bubbles: true,
        }
      )
    )
  })

  expect(
    rendered.container.querySelector(
      '[data-slate-large-document-shell="true"][data-slate-large-document-island="1"]'
    )
  ).toBe(null)
  expect(
    rendered.container.querySelectorAll('[data-slate-node="text"]').length
  ).toBe(1)
  expect(Editor.getSnapshot(editor).selection).toEqual({
    anchor: { offset: 0, path: [2, 0] },
    focus: { offset: 0, path: [2, 0] },
  })
})

test('Editable largeDocument shell focus does not activate or change model selection', async () => {
  const editor = withReact(createEditor())

  Editor.replace(editor, {
    children: Array.from({ length: 6 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `block-${index + 1}` }],
    })),
    selection: null,
  })

  const rendered = render(
    <Editable
      editor={editor}
      id="large-document-focus-promotion"
      largeDocument={{
        activeRadius: 0,
        enabled: true,
        islandSize: 2,
        threshold: 1,
      }}
    />
  )

  const targetShell = rendered.container.querySelector(
    '[data-slate-large-document-shell="true"][data-slate-large-document-island="1"]'
  )

  expect(targetShell).toBeTruthy()

  await act(async () => {
    targetShell!.dispatchEvent(
      new window.FocusEvent('focusin', { bubbles: true })
    )
  })

  expect(
    rendered.container.querySelectorAll('[data-slate-node="text"]').length
  ).toBe(1)
  expect(
    rendered.container.querySelector(
      '[data-slate-large-document-shell="true"][data-slate-large-document-island="1"]'
    )
  ).toBeTruthy()
  expect(Editor.getSnapshot(editor).selection).toBe(null)
})

test('Editable largeDocument promotes a shell with keyboard activation', async () => {
  const editor = withReact(createEditor())

  Editor.replace(editor, {
    children: Array.from({ length: 6 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `block-${index + 1}` }],
    })),
    selection: null,
  })

  const rendered = render(
    <Editable
      editor={editor}
      id="large-document-keyboard-promotion"
      largeDocument={{
        activeRadius: 0,
        enabled: true,
        islandSize: 2,
        threshold: 1,
      }}
    />
  )

  const targetShell = rendered.container.querySelector(
    '[data-slate-large-document-shell="true"][data-slate-large-document-island="1"]'
  ) as HTMLElement | null

  expect(targetShell).toBeTruthy()
  expect(targetShell!.getAttribute('role')).toBe('button')
  expect(targetShell!.getAttribute('tabindex')).toBe('0')
  expect(targetShell!.getAttribute('aria-expanded')).toBe('false')
  expect(targetShell!.getAttribute('aria-label')).toContain(
    'Open document section 2'
  )

  await act(async () => {
    targetShell!.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        bubbles: true,
        key: 'Enter',
      })
    )
  })

  expect(
    rendered.container.querySelector(
      '[data-slate-large-document-shell="true"][data-slate-large-document-island="1"]'
    )
  ).toBe(null)
  expect(Editor.getSnapshot(editor).selection).toEqual({
    anchor: { offset: 0, path: [2, 0] },
    focus: { offset: 0, path: [2, 0] },
  })
})

test('Editable largeDocument promotes a shell with Space keyboard activation', async () => {
  const editor = withReact(createEditor())

  Editor.replace(editor, {
    children: Array.from({ length: 6 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `block-${index + 1}` }],
    })),
    selection: null,
  })

  const rendered = render(
    <Editable
      editor={editor}
      id="large-document-keyboard-space-promotion"
      largeDocument={{
        activeRadius: 0,
        enabled: true,
        islandSize: 2,
        threshold: 1,
      }}
    />
  )

  const targetShell = rendered.container.querySelector(
    '[data-slate-large-document-shell="true"][data-slate-large-document-island="1"]'
  ) as HTMLElement | null

  expect(targetShell).toBeTruthy()
  expect(targetShell!.getAttribute('role')).toBe('button')
  expect(targetShell!.getAttribute('aria-expanded')).toBe('false')

  await act(async () => {
    targetShell!.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        bubbles: true,
        key: ' ',
      })
    )
  })

  expect(
    rendered.container.querySelector(
      '[data-slate-large-document-shell="true"][data-slate-large-document-island="1"]'
    )
  ).toBe(null)
  expect(Editor.getSnapshot(editor).selection).toEqual({
    anchor: { offset: 0, path: [2, 0] },
    focus: { offset: 0, path: [2, 0] },
  })
})

test('Editable largeDocument maps Ctrl+A to a full-document model selection without expanding shells', async () => {
  const editor = withReact(createEditor())

  Editor.replace(editor, {
    children: Array.from({ length: 6 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `block-${index + 1}` }],
    })),
    selection: null,
  })

  const rendered = render(
    <Editable
      editor={editor}
      id="large-document-select-all"
      largeDocument={{
        activeRadius: 0,
        enabled: true,
        islandSize: 2,
        threshold: 1,
      }}
    />
  )

  const root = rendered.container.querySelector(
    '#large-document-select-all'
  ) as HTMLElement | null

  expect(root).toBeTruthy()

  await act(async () => {
    root!.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        bubbles: true,
        ctrlKey: true,
        key: 'a',
      })
    )
  })

  const snapshot = Editor.getSnapshot(editor)

  expect(snapshot.selection).toEqual({
    anchor: Editor.start(editor, []),
    focus: Editor.end(editor, []),
  })
  expect(root!.getAttribute('data-slate-large-document-selection')).toBe(
    'shell-backed'
  )
  expect(
    rendered.container.querySelectorAll(
      '[data-slate-large-document-shell="true"]'
    ).length
  ).toBe(2)
})

test('Editable largeDocument pastes over full-document shell-backed selection through the model', async () => {
  const editor = withReact(createEditor())

  Editor.replace(editor, {
    children: Array.from({ length: 6 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `block-${index + 1}` }],
    })),
    selection: null,
  })

  const rendered = render(
    <Editable
      editor={editor}
      id="large-document-paste-full-doc"
      largeDocument={{
        activeRadius: 0,
        enabled: true,
        islandSize: 2,
        threshold: 1,
      }}
    />
  )

  const root = rendered.container.querySelector(
    '#large-document-paste-full-doc'
  ) as HTMLElement | null

  expect(root).toBeTruthy()

  await act(async () => {
    root!.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        bubbles: true,
        ctrlKey: true,
        key: 'a',
      })
    )
  })

  await act(async () => {
    root!.dispatchEvent(
      Object.assign(
        new window.Event('paste', { bubbles: true, cancelable: true }),
        {
          clipboardData: {
            types: ['text/plain'],
            getData: (type = 'text/plain') =>
              type === 'text/plain' ? 'replacement marker' : '',
          },
        }
      )
    )
  })

  expect(rendered.container.textContent?.includes('replacement marker')).toBe(
    true
  )
  expect(
    rendered.container.querySelectorAll(
      '[data-slate-large-document-shell="true"]'
    ).length
  ).toBe(0)
  expect(Editor.string(editor, [])).toBe('replacement marker')
})

test('Editable largeDocument preserves Slate fragment data for shell-backed paste', async () => {
  const editor = withReact(createEditor())

  Editor.replace(editor, {
    children: Array.from({ length: 6 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `block-${index + 1}` }],
    })),
    selection: null,
  })

  const rendered = render(
    <Editable
      editor={editor}
      id="large-document-paste-fragment"
      largeDocument={{
        activeRadius: 0,
        enabled: true,
        islandSize: 2,
        threshold: 1,
      }}
    />
  )

  const root = rendered.container.querySelector(
    '#large-document-paste-fragment'
  ) as HTMLElement | null

  expect(root).toBeTruthy()

  await act(async () => {
    root!.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        bubbles: true,
        ctrlKey: true,
        key: 'a',
      })
    )
  })

  const encodedFragment = window.btoa(
    encodeURIComponent(
      JSON.stringify([
        {
          type: 'paragraph',
          children: [{ text: 'fragment marker' }],
        },
      ])
    )
  )

  await act(async () => {
    root!.dispatchEvent(
      Object.assign(
        new window.Event('paste', { bubbles: true, cancelable: true }),
        {
          clipboardData: {
            types: ['application/x-slate-fragment', 'text/plain'],
            getData: (type = 'text/plain') =>
              type === 'application/x-slate-fragment'
                ? encodedFragment
                : type === 'text/plain'
                  ? 'plain fallback'
                  : '',
          },
        }
      )
    )
  })

  expect(Editor.string(editor, [])).toBe('fragment marker')
})

test('Editable forwards scrollSelectionIntoView to app-owned code', async () => {
  const editor = withReact(createEditor())
  const seen: string[] = []

  Editor.replace(editor, {
    children: [
      {
        type: 'paragraph',
        children: [{ text: 'alpha' }],
      },
      {
        type: 'paragraph',
        children: [{ text: 'beta' }],
      },
    ] as Descendant[],
    selection: null,
  })

  const rendered = render(
    <Editable
      editor={editor}
      id="scroll-forwarding"
      scrollSelectionIntoView={(_editor, domRange) => {
        seen.push(domRange.toString())
      }}
    />
  )

  await act(async () => {
    editor.update(() => {
      editor.select({
        anchor: { path: [1, 0], offset: 1 },
        focus: { path: [1, 0], offset: 4 },
      })
    })
  })

  expect(seen).toEqual(['eta'])
  rendered.unmount()
})
