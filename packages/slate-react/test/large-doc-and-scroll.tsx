import { act, render } from '@testing-library/react'
import React from 'react'
import { createEditor, type Descendant } from 'slate'
import { Editor } from 'slate/internal'
import {
  EDITOR_TO_ELEMENT,
  EDITOR_TO_WINDOW,
  ELEMENT_TO_NODE,
  IS_COMPOSING,
  NODE_TO_ELEMENT,
} from 'slate-dom'
import { DOMCoverage } from 'slate-dom/internal'

import { createDecorationSource, Editable, Slate, withReact } from '../src'
import { syncEditableDOMSelectionToEditor } from '../src/editable/selection-controller'
import { didSyncTextPathToDOM } from '../src/hooks/use-slate-node-ref'
import { createSlateReactRenderCounter } from '../src/render-profiler'

const TestEditorSurface = ({
  editor,
  ...props
}: React.ComponentProps<typeof Editable> & {
  editor: React.ComponentProps<typeof Slate>['editor']
}) => (
  <Slate editor={editor}>
    <Editable {...props} />
  </Slate>
)

const getRuntimeId = (editor: ReturnType<typeof withReact>, path: number[]) => {
  const runtimeId = Editor.getRuntimeId(editor, path)

  if (!runtimeId) {
    throw new Error(`Missing runtime id at ${path.join('.')}`)
  }

  return runtimeId
}

test('Editable largeDocument shells far islands without mounting editable descendants', async () => {
  const editor = withReact(createEditor())

  Editor.replace(editor, {
    children: Array.from({ length: 6 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `block-${index + 1}` }],
    })),
    selection: null,
  })

  const rendered = render(
    <TestEditorSurface
      editor={editor}
      id="large-document-shells"
      largeDocument={{
        activeRadius: 0,
        mode: 'shell',
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
  ).toBe(2)
  expect(
    rendered.container
      .querySelector(
        '[data-slate-large-document-shell="true"][data-slate-large-document-island="1"]'
      )
      ?.textContent?.includes('block-3')
  ).toBe(true)
})

test('Editable largeDocument mounts active radius corridor islands', async () => {
  const editor = withReact(createEditor())

  Editor.replace(editor, {
    children: Array.from({ length: 6 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `block-${index + 1}` }],
    })),
    selection: null,
  })

  const rendered = render(
    <TestEditorSurface
      editor={editor}
      id="large-document-active-corridor"
      largeDocument={{
        activeRadius: 1,
        mode: 'shell',
        islandSize: 2,
        threshold: 1,
      }}
    />
  )

  expect(
    rendered.container.querySelectorAll('[data-slate-node="text"]').length
  ).toBe(4)
  expect(
    rendered.container.querySelector(
      '[data-slate-large-document-shell="true"][data-slate-large-document-island="1"]'
    )
  ).toBe(null)
  expect(
    rendered.container.querySelectorAll(
      '[data-slate-large-document-shell="true"]'
    ).length
  ).toBe(1)
  expect(
    rendered.container
      .querySelector(
        '[data-slate-large-document-shell="true"][data-slate-large-document-island="2"]'
      )
      ?.textContent?.includes('block-5')
  ).toBe(true)
})

test('Editable marks only default plain text as DOM-sync capable', async () => {
  const editor = withReact(createEditor())

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
    <TestEditorSurface
      editor={editor}
      id="large-document-default-dom-sync"
      largeDocument={{
        activeRadius: 0,
        mode: 'shell',
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
  const editor = withReact(createEditor())

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
    <TestEditorSurface
      editor={editor}
      id="large-document-custom-render-text"
      largeDocument={{
        activeRadius: 0,
        mode: 'shell',
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
  const leafEditor = withReact(createEditor())
  const segmentEditor = withReact(createEditor())

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
    <TestEditorSurface
      editor={leafEditor}
      id="large-document-custom-render-leaf"
      largeDocument={{
        activeRadius: 0,
        mode: 'shell',
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
    <TestEditorSurface
      editor={segmentEditor}
      id="large-document-custom-render-segment"
      largeDocument={{
        activeRadius: 0,
        mode: 'shell',
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
  const editor = withReact(createEditor())

  Editor.replace(editor, {
    children: [
      {
        type: 'paragraph',
        children: [{ text: 'alpha' }],
      },
    ],
    selection: null,
  })

  const highlightSource = createDecorationSource(editor, {
    id: 'highlight-alpha',
    read: () => [
      {
        key: 'highlight-alpha',
        range: {
          anchor: { path: [0, 0], offset: 0 },
          focus: { path: [0, 0], offset: 5 },
        },
      },
    ],
  })

  const rendered = render(
    <Slate decorationSources={[highlightSource]} editor={editor}>
      <Editable
        id="large-document-projection-dom-sync"
        largeDocument={{
          activeRadius: 0,
          mode: 'shell',
          islandSize: 2,
          threshold: 1,
        }}
      />
    </Slate>
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

  highlightSource.destroy()
})

test('Editable disables DOM text sync for empty zero-width text', async () => {
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
    <TestEditorSurface
      editor={editor}
      id="large-document-empty-dom-sync"
      largeDocument={{
        activeRadius: 0,
        mode: 'shell',
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
    <TestEditorSurface
      editor={editor}
      id="large-document-composition-dom-sync"
      largeDocument={{
        activeRadius: 0,
        mode: 'shell',
        islandSize: 2,
        threshold: 1,
      }}
    />
  )

  IS_COMPOSING.set(editor, true)

  await act(async () => {
    editor.update((tx) => {
      tx.text.insert('!')
    })
  })

  expect(didSyncTextPathToDOM(editor, [0, 0])).toBe(false)
  expect(rendered.container.textContent).toContain('alpha!')

  IS_COMPOSING.set(editor, false)
})

test('Editable dom-present full-document replacement removes stale far DOM immediately', async () => {
  const editor = withReact(createEditor())

  Editor.replace(editor, {
    children: Array.from({ length: 1001 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `line ${index}` }],
    })),
    selection: null,
  })

  const rendered = render(
    <TestEditorSurface
      editor={editor}
      id="large-document-dom-present-replace"
      largeDocument="dom-present"
    />
  )

  expect(rendered.container.textContent).toContain('line 49')
  expect(rendered.container.textContent).not.toContain('line 50')
  expect(
    rendered.container.querySelector('[data-slate-large-document-shell="true"]')
  ).toBe(null)

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350))
  })

  expect(rendered.container.textContent).toContain('line 1000')

  await act(async () => {
    editor.update((tx) => {
      tx.value.replace({
        children: [
          {
            type: 'paragraph',
            children: [{ text: 'replacement marker' }],
          },
        ],
        selection: {
          anchor: { offset: 'replacement marker'.length, path: [0, 0] },
          focus: { offset: 'replacement marker'.length, path: [0, 0] },
        },
      })
    })
  })

  expect(Editor.string(editor, [])).toBe('replacement marker')
  expect(rendered.container.textContent).toContain('replacement marker')
  expect(rendered.container.textContent).not.toContain('line 1000')
  expect(
    rendered.container.querySelector('[data-slate-large-document-shell="true"]')
  ).toBe(null)
})

test('Editable dom-present full-document replacement resets staged coverage without stale far DOM', async () => {
  const editor = withReact(createEditor())

  Editor.replace(editor, {
    children: Array.from({ length: 1001 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `old line ${index}` }],
    })),
    selection: null,
  })

  const rendered = render(
    <TestEditorSurface
      editor={editor}
      id="large-document-dom-present-large-replace"
      largeDocument="dom-present"
    />
  )

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350))
  })

  expect(rendered.container.textContent).toContain('old line 1000')
  expect(DOMCoverage.getBoundaries(editor)).toHaveLength(0)

  await act(async () => {
    editor.update((tx) => {
      tx.value.replace({
        children: Array.from({ length: 1001 }, (_, index) => ({
          type: 'paragraph',
          children: [{ text: `fresh line ${index}` }],
        })),
        selection: {
          anchor: { offset: 'fresh line 0'.length, path: [0, 0] },
          focus: { offset: 'fresh line 0'.length, path: [0, 0] },
        },
      })
    })
  })

  expect(Editor.string(editor, [])).toContain('fresh line 1000')
  expect(rendered.container.textContent).toContain('fresh line 0')
  expect(rendered.container.textContent).toContain('fresh line 49')
  expect(rendered.container.textContent).not.toContain('fresh line 50')
  expect(rendered.container.textContent).not.toContain('fresh line 1000')
  expect(rendered.container.textContent).not.toContain('old line 1000')
  expect(
    rendered.container.querySelector('[data-slate-large-document-shell="true"]')
  ).toBe(null)

  const [boundary] = DOMCoverage.getBoundaries(editor)

  expect(boundary).toMatchObject({
    copyPolicy: 'materialize',
    findPolicy: 'not-native-until-mounted',
    ownerPath: [],
    ownerRuntimeId: null,
    reason: 'large-document-staged',
    selectionPolicy: 'materialize',
    state: 'pending-mount',
  })
  expect(boundary?.coveredPathRanges).toEqual([{ anchor: [50], focus: [1000] }])
})

test('Editable dom-present stages far root groups without shell placeholders', async () => {
  const editor = withReact(createEditor())

  Editor.replace(editor, {
    children: Array.from({ length: 1001 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `line ${index}` }],
    })),
    selection: null,
  })

  const rendered = render(
    <TestEditorSurface
      editor={editor}
      id="large-document-dom-present-staged"
      largeDocument="dom-present"
    />
  )

  expect(rendered.container.textContent).toContain('line 0')
  expect(rendered.container.textContent).toContain('line 49')
  expect(rendered.container.textContent).not.toContain('line 50')
  expect(
    rendered.container.querySelector('[data-slate-large-document-shell="true"]')
  ).toBe(null)
  expect(
    rendered.container.querySelectorAll(
      '[data-slate-root-group-state="pending-mount"]'
    ).length
  ).toBe(1)

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350))
  })

  expect(rendered.container.textContent).toContain('line 1000')
  expect(
    rendered.container.querySelectorAll(
      '[data-slate-root-group-state="pending-mount"]'
    ).length
  ).toBe(0)
})

test('Editable dom-present registers pending root groups as DOM coverage boundaries', async () => {
  const editor = withReact(createEditor())

  Editor.replace(editor, {
    children: Array.from({ length: 1001 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `line ${index}` }],
    })),
    selection: null,
  })

  render(
    <TestEditorSurface
      editor={editor}
      id="large-document-dom-present-coverage"
      largeDocument="dom-present"
    />
  )

  const [boundary] = DOMCoverage.getBoundaries(editor)

  expect(boundary).toMatchObject({
    copyPolicy: 'materialize',
    findPolicy: 'not-native-until-mounted',
    ownerPath: [],
    ownerRuntimeId: null,
    reason: 'large-document-staged',
    selectionPolicy: 'materialize',
    state: 'pending-mount',
  })
  expect(boundary?.coveredPathRanges).toEqual([{ anchor: [50], focus: [1000] }])

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350))
  })

  expect(DOMCoverage.getBoundaries(editor)).toHaveLength(0)
})

test('Editable dom-present selection export consults DOM coverage before raw DOM lookup', () => {
  const editor = withReact(createEditor())
  const materialized: string[] = []
  const root = document.createElement('div')
  const selection = {
    anchor: { offset: 0, path: [1, 0] },
    focus: { offset: 0, path: [1, 0] },
  }

  Editor.replace(editor, {
    children: [
      {
        type: 'paragraph',
        children: [{ text: 'mounted block' }],
      },
      {
        type: 'paragraph',
        children: [{ text: 'pending block' }],
      },
    ],
    selection,
  })

  root.setAttribute('contenteditable', 'true')
  root.setAttribute('data-slate-editor', 'true')
  document.body.append(root)
  EDITOR_TO_ELEMENT.set(editor, root)
  EDITOR_TO_WINDOW.set(editor, window)
  ELEMENT_TO_NODE.set(root, editor)
  NODE_TO_ELEMENT.set(editor, root)

  try {
    const domSelection = document.getSelection()
    const rootRange = document.createRange()

    rootRange.selectNodeContents(root)
    domSelection?.removeAllRanges()
    domSelection?.addRange(rootRange)

    DOMCoverage.registerBoundary(editor, {
      anchor: { type: 'placeholder', runtimeId: getRuntimeId(editor, [1]) },
      boundaryId: 'large-document-staged:pending',
      copyPolicy: 'materialize',
      coveredPathRanges: [{ anchor: [1], focus: [1] }],
      coveredRuntimeRanges: [
        {
          anchor: getRuntimeId(editor, [1]),
          focus: getRuntimeId(editor, [1]),
        },
      ],
      findPolicy: 'not-native-until-mounted',
      ownerPath: [],
      ownerRuntimeId: null,
      reason: 'large-document-staged',
      selectionPolicy: 'materialize',
      state: 'pending-mount',
      version: 1,
    })
    DOMCoverage.setMaterializeHandler(editor, (boundary, reason) => {
      materialized.push(`${boundary.boundaryId}:${reason}`)
      return true
    })

    syncEditableDOMSelectionToEditor({
      editor,
      scrollSelectionIntoView: () => {},
      shellBackedSelection: false,
      state: {
        isUpdatingSelection: false,
        selectionChangeOrigin: null,
      },
    })

    expect(materialized).toEqual(['large-document-staged:pending:selection'])
    expect(domSelection?.rangeCount).toBe(0)
  } finally {
    DOMCoverage.clear(editor)
    EDITOR_TO_ELEMENT.delete(editor)
    EDITOR_TO_WINDOW.delete(editor)
    ELEMENT_TO_NODE.delete(root)
    NODE_TO_ELEMENT.delete(editor)
    root.remove()
  }
})

test('Editable dom-present materializes pending root groups through DOM coverage', async () => {
  const editor = withReact(createEditor())

  Editor.replace(editor, {
    children: Array.from({ length: 1001 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `line ${index}` }],
    })),
    selection: null,
  })

  const rendered = render(
    <TestEditorSurface
      editor={editor}
      id="large-document-dom-present-coverage-materialize"
      largeDocument="dom-present"
    />
  )

  const [boundary] = DOMCoverage.getBoundaries(editor)

  expect(rendered.container.textContent).not.toContain('line 1000')
  expect(boundary?.reason).toBe('large-document-staged')

  await act(async () => {
    expect(
      DOMCoverage.materializeBoundary(editor, boundary!.boundaryId, 'selection')
    ).toMatchObject({ status: 'handled' })
  })

  expect(rendered.container.textContent).toContain('line 1000')
  expect(DOMCoverage.getBoundaries(editor)).toHaveLength(0)
})

test('Editable dom-present materializes the selected root group urgently', async () => {
  const editor = withReact(createEditor())

  Editor.replace(editor, {
    children: Array.from({ length: 1001 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `line ${index}` }],
    })),
    selection: null,
  })

  const rendered = render(
    <TestEditorSurface
      editor={editor}
      id="large-document-dom-present-select"
      largeDocument="dom-present"
    />
  )

  expect(rendered.container.textContent).not.toContain('line 1000')

  await act(async () => {
    editor.update((tx) => {
      tx.selection.set({
        anchor: { offset: 0, path: [1000, 0] },
        focus: { offset: 0, path: [1000, 0] },
      })
    })
  })

  expect(rendered.container.textContent).toContain('line 1000')
  expect(
    rendered.container.querySelector('[data-slate-large-document-shell="true"]')
  ).toBe(null)
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
    <TestEditorSurface
      editor={editor}
      id="large-document-promotion"
      largeDocument={{
        activeRadius: 0,
        mode: 'shell',
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
  ).toBe(2)
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
    <TestEditorSurface
      editor={editor}
      id="large-document-focus-promotion"
      largeDocument={{
        activeRadius: 0,
        mode: 'shell',
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
  ).toBe(2)
  expect(
    rendered.container.querySelector(
      '[data-slate-large-document-shell="true"][data-slate-large-document-island="1"]'
    )
  ).toBeTruthy()
  expect(Editor.getSnapshot(editor).selection).toBe(null)
})

test('Editable largeDocument shell interaction does not promote during composition', async () => {
  const editor = withReact(createEditor())

  Editor.replace(editor, {
    children: Array.from({ length: 6 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `block-${index + 1}` }],
    })),
    selection: null,
  })

  const rendered = render(
    <TestEditorSurface
      editor={editor}
      id="large-document-composition-promotion"
      largeDocument={{
        activeRadius: 0,
        mode: 'shell',
        islandSize: 2,
        threshold: 1,
      }}
    />
  )

  const targetShell = rendered.container.querySelector(
    '[data-slate-large-document-shell="true"][data-slate-large-document-island="1"]'
  )

  expect(targetShell).toBeTruthy()

  IS_COMPOSING.set(editor, true)

  try {
    await act(async () => {
      targetShell!.dispatchEvent(
        new window.MouseEvent('mousedown', {
          bubbles: true,
        })
      )
    })

    expect(
      rendered.container.querySelector(
        '[data-slate-large-document-shell="true"][data-slate-large-document-island="1"]'
      )
    ).toBeTruthy()
    expect(Editor.getSnapshot(editor).selection).toBe(null)
  } finally {
    IS_COMPOSING.set(editor, false)
  }
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
    <TestEditorSurface
      editor={editor}
      id="large-document-keyboard-promotion"
      largeDocument={{
        activeRadius: 0,
        mode: 'shell',
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
    <TestEditorSurface
      editor={editor}
      id="large-document-keyboard-space-promotion"
      largeDocument={{
        activeRadius: 0,
        mode: 'shell',
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
    <TestEditorSurface
      editor={editor}
      id="large-document-select-all"
      largeDocument={{
        activeRadius: 0,
        mode: 'shell',
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
    anchor: Editor.point(editor, [], { edge: 'start' }),
    focus: Editor.point(editor, [], { edge: 'end' }),
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

test('Editable largeDocument derives shell-backed state for programmatic broad selections', async () => {
  const editor = withReact(createEditor())

  Editor.replace(editor, {
    children: Array.from({ length: 6 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `block-${index + 1}` }],
    })),
    selection: null,
  })

  const rendered = render(
    <TestEditorSurface
      editor={editor}
      id="large-document-programmatic-shell-selection"
      largeDocument={{
        activeRadius: 0,
        mode: 'shell',
        islandSize: 2,
        threshold: 1,
      }}
    />
  )

  const root = rendered.container.querySelector(
    '#large-document-programmatic-shell-selection'
  ) as HTMLElement | null

  expect(root).toBeTruthy()
  expect(root!.getAttribute('data-slate-large-document-selection')).toBe(null)

  await act(async () => {
    editor.update((tx) => {
      tx.selection.set({
        anchor: Editor.point(editor, [], { edge: 'start' }),
        focus: Editor.point(editor, [], { edge: 'end' }),
      })
    })
  })

  expect(root!.getAttribute('data-slate-large-document-selection')).toBe(
    'shell-backed'
  )
})

test('Editable largeDocument keeps broad select-all from replanning the active island', async () => {
  const editor = withReact(createEditor())
  const counter = createSlateReactRenderCounter()
  const previousProfiler = globalThis.__SLATE_REACT_RENDER_PROFILER__
  let rendered: ReturnType<typeof render> | null = null

  Editor.replace(editor, {
    children: Array.from({ length: 200 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `block-${index + 1}` }],
    })),
    selection: null,
  })

  globalThis.__SLATE_REACT_RENDER_PROFILER__ = counter.profiler

  try {
    rendered = render(
      <TestEditorSurface
        editor={editor}
        id="large-document-broad-select-all"
        largeDocument={{
          activeRadius: 0,
          mode: 'shell',
          islandSize: 2,
          threshold: 1,
        }}
      />
    )

    const root = rendered.container.querySelector(
      '#large-document-broad-select-all'
    ) as HTMLElement | null

    expect(root).toBeTruthy()
    counter.reset()

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
      anchor: Editor.point(editor, [], { edge: 'start' }),
      focus: Editor.point(editor, [], { edge: 'end' }),
    })
    expect(root!.getAttribute('data-slate-large-document-selection')).toBe(
      'shell-backed'
    )
    expect(
      counter.snapshot().events.filter((event) => event.kind === 'root-plan')
    ).toHaveLength(0)
  } finally {
    rendered?.unmount()
    globalThis.__SLATE_REACT_RENDER_PROFILER__ = previousProfiler
  }
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
    <TestEditorSurface
      editor={editor}
      id="large-document-paste-full-doc"
      largeDocument={{
        activeRadius: 0,
        mode: 'shell',
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
    <TestEditorSurface
      editor={editor}
      id="large-document-paste-fragment"
      largeDocument={{
        activeRadius: 0,
        mode: 'shell',
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
    <TestEditorSurface
      editor={editor}
      id="scroll-forwarding"
      scrollSelectionIntoView={(_editor, domRange) => {
        seen.push(domRange.toString())
      }}
    />
  )

  await act(async () => {
    editor.update((tx) => {
      tx.selection.set({
        anchor: { path: [1, 0], offset: 1 },
        focus: { path: [1, 0], offset: 4 },
      })
    })
  })

  expect(seen).toEqual(['eta'])
  rendered.unmount()
})
