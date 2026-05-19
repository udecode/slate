import { act, fireEvent, render, waitFor } from '@testing-library/react'
import React from 'react'
import { type Descendant } from 'slate'
import { Editor } from 'slate/internal'
import {
  EDITOR_TO_ELEMENT,
  EDITOR_TO_WINDOW,
  ELEMENT_TO_NODE,
  IS_COMPOSING,
  NODE_TO_ELEMENT,
} from 'slate-dom'
import { DOMCoverage } from 'slate-dom/internal'

import {
  createDecorationSource,
  createReactEditor,
  Editable,
  type EditableRenderingStrategyMetrics,
  Slate,
} from '../src'
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

const getRuntimeId = (
  editor: ReturnType<typeof createReactEditor>,
  path: number[]
) => {
  const runtimeId = Editor.getRuntimeId(editor, path)

  if (!runtimeId) {
    throw new Error(`Missing runtime id at ${path.join('.')}`)
  }

  return runtimeId
}

const fireEditorSelectAll = (root: HTMLElement) => {
  Object.defineProperty(root, 'isContentEditable', {
    configurable: true,
    value: true,
  })
  fireEvent.keyDown(root, {
    bubbles: true,
    ctrlKey: true,
    key: 'a',
  })
}

const fireEditorPaste = (
  root: HTMLElement,
  clipboardData: {
    getData: (type?: string) => string
    types: string[]
  }
) => {
  Object.defineProperty(root, 'isContentEditable', {
    configurable: true,
    value: true,
  })
  fireEvent.paste(root, { clipboardData })
}

test('Editable renderingStrategy shells far segments without mounting editable descendants', async () => {
  const editor = createReactEditor()

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
      id="rendering-strategy-shells"
      renderingStrategy={{
        overscan: 0,
        type: 'shell',
        segmentSize: 2,
        threshold: 1,
      }}
    />
  )

  expect(
    rendered.container.querySelectorAll(
      '[data-slate-rendering-strategy-shell="true"]'
    ).length
  ).toBe(2)
  expect(
    rendered.container.querySelectorAll('[data-slate-node="text"]').length
  ).toBe(2)
  expect(
    rendered.container
      .querySelector(
        '[data-slate-rendering-strategy-shell="true"][data-slate-rendering-strategy-segment="1"]'
      )
      ?.textContent?.includes('block-3')
  ).toBe(true)

  const shellBoundaries = DOMCoverage.getBoundaries(editor).filter(
    (boundary) => boundary.reason === 'shell-aggressive'
  )

  expect(shellBoundaries.map((boundary) => boundary.boundaryId)).toEqual([
    'shell-aggressive:1',
    'shell-aggressive:2',
  ])
  expect(DOMCoverage.getBoundary(editor, 'shell-aggressive:1')).toMatchObject({
    copyPolicy: 'include-model',
    coveredPathRanges: [{ anchor: [2], focus: [3] }],
    coveredRuntimeRanges: [
      {
        anchor: getRuntimeId(editor, [2]),
        focus: getRuntimeId(editor, [3]),
      },
    ],
    findPolicy: 'not-native-until-mounted',
    ownerPath: [],
    ownerRuntimeId: null,
    reason: 'shell-aggressive',
    selectionPolicy: 'model-backed',
    state: 'virtualized',
  })
  expect(DOMCoverage.getBoundary(editor, 'shell-aggressive:2')).toMatchObject({
    coveredPathRanges: [{ anchor: [4], focus: [5] }],
    reason: 'shell-aggressive',
    selectionPolicy: 'model-backed',
    state: 'virtualized',
  })
  expect(
    rendered.container
      .querySelector(
        '[data-slate-rendering-strategy-shell="true"][data-slate-rendering-strategy-segment="1"]'
      )
      ?.getAttribute('data-slate-dom-coverage-boundary')
  ).toBe('shell-aggressive:1')
})

test('Editable renderingStrategy mounts active radius corridor segments', async () => {
  const editor = createReactEditor()

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
      id="rendering-strategy-active-corridor"
      renderingStrategy={{
        overscan: 1,
        type: 'shell',
        segmentSize: 2,
        threshold: 1,
      }}
    />
  )

  expect(
    rendered.container.querySelectorAll('[data-slate-node="text"]').length
  ).toBe(4)
  expect(
    rendered.container.querySelector(
      '[data-slate-rendering-strategy-shell="true"][data-slate-rendering-strategy-segment="1"]'
    )
  ).toBe(null)
  expect(
    rendered.container.querySelectorAll(
      '[data-slate-rendering-strategy-shell="true"]'
    ).length
  ).toBe(1)
  expect(
    rendered.container
      .querySelector(
        '[data-slate-rendering-strategy-shell="true"][data-slate-rendering-strategy-segment="2"]'
      )
      ?.textContent?.includes('block-5')
  ).toBe(true)
})

test('Editable renderingStrategy experimental virtualized mode uses viewport DOM coverage and materializes selected segments', async () => {
  const editor = createReactEditor()

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
      id="rendering-strategy-virtualized"
      renderingStrategy={{
        estimatedBlockSize: 24,
        overscan: 0,
        type: 'virtualized',
        threshold: 1,
      }}
      style={{ height: 48, overflowY: 'auto' }}
    />
  )

  await waitFor(() =>
    expect(
      rendered.container.querySelector(
        '[data-slate-rendering-strategy-virtualizer="true"]'
      )
    ).toBeTruthy()
  )
  expect(
    rendered.container.querySelectorAll(
      '[data-slate-rendering-strategy-shell="true"]'
    ).length
  ).toBe(0)
  const initialVirtualizedBoundary = DOMCoverage.getBoundaries(editor).find(
    (boundary) => boundary.reason === 'viewport-virtualization'
  )

  expect(initialVirtualizedBoundary).toMatchObject({
    copyPolicy: 'include-model',
    findPolicy: 'not-native-until-mounted',
    reason: 'viewport-virtualization',
    selectionPolicy: 'materialize',
    state: 'virtualized',
  })

  await act(async () => {
    editor.update((tx) => {
      tx.selection.set({
        anchor: { offset: 0, path: [2, 0] },
        focus: { offset: 0, path: [2, 0] },
      })
    })
  })

  expect(
    rendered.container.querySelector(
      '[data-slate-rendering-strategy-shell="true"][data-slate-rendering-strategy-segment="1"]'
    )
  ).toBe(null)
  expect(
    DOMCoverage.getBoundaryForPoint(editor, { offset: 0, path: [2, 0] })
  ).toBe(null)
  expect(
    DOMCoverage.getBoundaries(editor).some(
      (boundary) => boundary.reason === 'viewport-virtualization'
    )
  ).toBe(true)
  expect(
    DOMCoverage.getBoundaries(editor).find(
      (boundary) => boundary.reason === 'viewport-virtualization'
    )
  ).toMatchObject({
    reason: 'viewport-virtualization',
    selectionPolicy: 'materialize',
    state: 'virtualized',
  })
})

test('Editable renderingStrategy experimental virtualized mode keeps broad selections model-backed', async () => {
  const editor = createReactEditor()

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
      id="rendering-strategy-virtualized-select-all"
      renderingStrategy={{
        estimatedBlockSize: 24,
        overscan: 0,
        type: 'virtualized',
        threshold: 1,
      }}
      style={{ height: 48, overflowY: 'auto' }}
    />
  )

  const root = rendered.container.querySelector(
    '#rendering-strategy-virtualized-select-all'
  ) as HTMLElement | null

  expect(root).toBeTruthy()

  await act(async () => {
    fireEditorSelectAll(root!)
  })

  expect(Editor.getSnapshot(editor).selection).toEqual({
    anchor: Editor.point(editor, [], { edge: 'start' }),
    focus: Editor.point(editor, [], { edge: 'end' }),
  })
  expect(root!.getAttribute('data-slate-rendering-strategy-selection')).toBe(
    'shell-backed'
  )
  expect(
    DOMCoverage.getBoundariesForRange(editor, Editor.range(editor, []))
      .filter((boundary) => boundary.reason === 'viewport-virtualization')
      .every((boundary) => boundary.copyPolicy === 'include-model')
  ).toBe(true)
})

test('Editable reports renderingStrategy metrics for experimental virtualized surfaces', async () => {
  const editor = createReactEditor()
  const recordedMetrics: EditableRenderingStrategyMetrics[] = []

  Editor.replace(editor, {
    children: Array.from({ length: 6 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `block-${index + 1}` }],
    })),
    selection: null,
  })

  render(
    <TestEditorSurface
      editor={editor}
      id="rendering-strategy-virtualized-metrics"
      onRenderingStrategyMetrics={(metric) => {
        recordedMetrics.push(metric)
      }}
      renderingStrategy={{
        estimatedBlockSize: 24,
        overscan: 0,
        type: 'virtualized',
        threshold: 1,
      }}
      style={{ height: 48, overflowY: 'auto' }}
    />
  )

  await waitFor(() => expect(recordedMetrics.length).toBeGreaterThan(0))

  const latest = recordedMetrics.at(-1)!

  expect(latest).toMatchObject({
    activeSegmentIndex: null,
    overscan: 0,
    cohort: 'normal',
    degradationMode: 'virtualized',
    documentSize: 6,
    effectiveStrategy: 'virtualized',
    estimatedBlockSize: 24,
    segmentSize: null,
    nativeSurfaceComplete: false,
    requestedStrategy: 'virtualized',
    shellCount: 0,
    threshold: 1,
    viewportVirtualizationBoundaryCount: 1,
  })
  expect(latest.mountedTopLevelCount).toBeGreaterThanOrEqual(0)
  expect(latest.pendingTopLevelCount).toBe(
    latest.documentSize - latest.mountedTopLevelCount
  )
  expect(latest.virtualizerMeasuredCount).toBeGreaterThanOrEqual(0)
  expect(latest.domCoverageBoundaryCount).toBeGreaterThanOrEqual(1)
  expect(latest.domCoverageBoundaryElementCount).toBe(1)
  expect(latest.domNodeCount).toBeGreaterThan(0)
  expect(latest.editableDescendantCount).toBeGreaterThanOrEqual(0)
})

test('Editable reports renderingStrategy metrics for staged DOM-present surfaces', async () => {
  const editor = createReactEditor()
  const recordedMetrics: EditableRenderingStrategyMetrics[] = []

  Editor.replace(editor, {
    children: Array.from({ length: 1001 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `block-${index + 1}` }],
    })),
    selection: null,
  })

  render(
    <TestEditorSurface
      editor={editor}
      id="rendering-strategy-staged-metrics"
      onRenderingStrategyMetrics={(metric) => {
        recordedMetrics.push(metric)
      }}
      renderingStrategy="staged"
    />
  )

  await waitFor(() => expect(recordedMetrics.length).toBeGreaterThan(0))

  const latest = recordedMetrics.at(-1)!

  expect(latest).toMatchObject({
    cohort: 'medium',
    degradationMode: 'staged-warmup',
    documentSize: 1001,
    effectiveStrategy: 'staged',
    mountedGroupCount: 1,
    mountedTopLevelCount: 16,
    nativeSurfaceComplete: false,
    pendingGroupCount: 62,
    pendingTopLevelCount: 985,
    requestedStrategy: 'staged',
  })
  expect(latest.renderingStrategyStagedBoundaryCount).toBeGreaterThan(0)
  expect(latest.domCoverageBoundaryElementCount).toBeGreaterThan(0)
  expect(latest.domNodeCount).toBeGreaterThan(0)
  expect(latest.editableDescendantCount).toBeGreaterThan(0)
})

test('Editable reports renderingStrategy degradation mode for plain and shell surfaces', async () => {
  const plainEditor = createReactEditor()
  const shellEditor = createReactEditor()
  const plainMetrics: EditableRenderingStrategyMetrics[] = []
  const shellMetrics: EditableRenderingStrategyMetrics[] = []

  const children = Array.from({ length: 6 }, (_, index) => ({
    type: 'paragraph',
    children: [{ text: `block-${index + 1}` }],
  }))

  Editor.replace(plainEditor, {
    children,
    selection: null,
  })
  Editor.replace(shellEditor, {
    children,
    selection: null,
  })

  render(
    <>
      <TestEditorSurface
        editor={plainEditor}
        id="rendering-strategy-plain-metrics"
        onRenderingStrategyMetrics={(metric) => {
          plainMetrics.push(metric)
        }}
      />
      <TestEditorSurface
        editor={shellEditor}
        id="rendering-strategy-shell-metrics"
        onRenderingStrategyMetrics={(metric) => {
          shellMetrics.push(metric)
        }}
        renderingStrategy={{
          overscan: 0,
          type: 'shell',
          segmentSize: 2,
          threshold: 1,
        }}
      />
    </>
  )

  await waitFor(() => expect(plainMetrics.length).toBeGreaterThan(0))
  await waitFor(() => expect(shellMetrics.length).toBeGreaterThan(0))

  expect(plainMetrics.at(-1)).toMatchObject({
    degradationMode: 'none',
    effectiveStrategy: 'plain',
    nativeSurfaceComplete: true,
  })
  expect(shellMetrics.at(-1)).toMatchObject({
    degradationMode: 'shell',
    effectiveStrategy: 'shell',
    nativeSurfaceComplete: false,
  })
})

test('Editable marks only default plain text as DOM-sync capable', async () => {
  const editor = createReactEditor()

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
      id="rendering-strategy-default-dom-sync"
      renderingStrategy={{
        overscan: 0,
        type: 'shell',
        segmentSize: 2,
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
  const editor = createReactEditor()

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
      id="rendering-strategy-custom-render-text"
      renderingStrategy={{
        overscan: 0,
        type: 'shell',
        segmentSize: 2,
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
  const leafEditor = createReactEditor()
  const segmentEditor = createReactEditor()

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
      id="rendering-strategy-custom-render-leaf"
      renderingStrategy={{
        overscan: 0,
        type: 'shell',
        segmentSize: 2,
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
      id="rendering-strategy-custom-render-segment"
      renderingStrategy={{
        overscan: 0,
        type: 'shell',
        segmentSize: 2,
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
  const editor = createReactEditor()

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
        id="rendering-strategy-projection-dom-sync"
        renderingStrategy={{
          overscan: 0,
          type: 'shell',
          segmentSize: 2,
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
  const editor = createReactEditor()

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
      id="rendering-strategy-empty-dom-sync"
      placeholder="Write something"
      renderingStrategy={{
        overscan: 0,
        type: 'shell',
        segmentSize: 2,
        threshold: 1,
      }}
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
  const editor = createReactEditor()

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
      id="rendering-strategy-composition-dom-sync"
      renderingStrategy={{
        overscan: 0,
        type: 'shell',
        segmentSize: 2,
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

test('Editable staged full-document replacement removes stale far DOM immediately', async () => {
  const editor = createReactEditor()

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
      id="rendering-strategy-staged-replace"
      renderingStrategy="staged"
    />
  )

  expect(rendered.container.textContent).toContain('line 15')
  expect(rendered.container.textContent).not.toContain('line 16')
  expect(
    rendered.container.querySelector(
      '[data-slate-rendering-strategy-shell="true"]'
    )
  ).toBe(null)

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 750))
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
    rendered.container.querySelector(
      '[data-slate-rendering-strategy-shell="true"]'
    )
  ).toBe(null)
})

test('Editable staged full-document replacement resets staged coverage without stale far DOM', async () => {
  const editor = createReactEditor()

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
      id="rendering-strategy-staged-large-replace"
      renderingStrategy="staged"
    />
  )

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 750))
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
  expect(rendered.container.textContent).toContain('fresh line 15')
  expect(rendered.container.textContent).not.toContain('fresh line 16')
  expect(rendered.container.textContent).not.toContain('fresh line 1000')
  expect(rendered.container.textContent).not.toContain('old line 1000')
  expect(
    rendered.container.querySelector(
      '[data-slate-rendering-strategy-shell="true"]'
    )
  ).toBe(null)

  const [boundary] = DOMCoverage.getBoundaries(editor)

  expect(boundary).toMatchObject({
    copyPolicy: 'materialize',
    findPolicy: 'not-native-until-mounted',
    ownerPath: [],
    ownerRuntimeId: null,
    reason: 'rendering-staged',
    selectionPolicy: 'materialize',
    state: 'pending-mount',
  })
  expect(boundary?.coveredPathRanges).toEqual([{ anchor: [16], focus: [1000] }])
})

test('Editable staged stages far root groups without shell placeholders', async () => {
  const editor = createReactEditor()

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
      id="rendering-strategy-staged-staged"
      renderingStrategy="staged"
    />
  )

  expect(rendered.container.textContent).toContain('line 0')
  expect(rendered.container.textContent).toContain('line 15')
  expect(rendered.container.textContent).not.toContain('line 16')
  expect(
    rendered.container.querySelector(
      '[data-slate-rendering-strategy-shell="true"]'
    )
  ).toBe(null)
  expect(
    rendered.container.querySelectorAll(
      '[data-slate-root-group-state="pending-mount"]'
    ).length
  ).toBe(1)

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 750))
  })

  expect(rendered.container.textContent).toContain('line 1000')
  expect(
    rendered.container.querySelectorAll(
      '[data-slate-root-group-state="pending-mount"]'
    ).length
  ).toBe(0)
})

test('Editable staged registers pending root groups as DOM coverage boundaries', async () => {
  const editor = createReactEditor()

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
      id="rendering-strategy-staged-coverage"
      renderingStrategy="staged"
    />
  )

  const [boundary] = DOMCoverage.getBoundaries(editor)

  expect(boundary).toMatchObject({
    copyPolicy: 'materialize',
    findPolicy: 'not-native-until-mounted',
    ownerPath: [],
    ownerRuntimeId: null,
    reason: 'rendering-staged',
    selectionPolicy: 'materialize',
    state: 'pending-mount',
  })
  expect(boundary?.coveredPathRanges).toEqual([{ anchor: [16], focus: [1000] }])

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 750))
  })

  expect(DOMCoverage.getBoundaries(editor)).toHaveLength(0)
})

test('Editable staged selection export consults DOM coverage before raw DOM lookup', () => {
  const editor = createReactEditor()
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
      boundaryId: 'rendering-staged:pending',
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
      reason: 'rendering-staged',
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

    expect(materialized).toEqual(['rendering-staged:pending:selection'])
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

test('Editable staged materializes pending root groups through DOM coverage', async () => {
  const editor = createReactEditor()

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
      id="rendering-strategy-staged-coverage-materialize"
      renderingStrategy="staged"
    />
  )

  const [boundary] = DOMCoverage.getBoundaries(editor)

  expect(rendered.container.textContent).not.toContain('line 1000')
  expect(boundary?.reason).toBe('rendering-staged')

  await act(async () => {
    expect(
      DOMCoverage.materializeBoundary(editor, boundary!.boundaryId, 'selection')
    ).toMatchObject({ status: 'handled' })
  })

  expect(rendered.container.textContent).toContain('line 1000')
  expect(DOMCoverage.getBoundaries(editor)).toHaveLength(0)
})

test('Editable staged materializes the selected root group urgently', async () => {
  const editor = createReactEditor()

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
      id="rendering-strategy-staged-select"
      renderingStrategy="staged"
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
    rendered.container.querySelector(
      '[data-slate-rendering-strategy-shell="true"]'
    )
  ).toBe(null)
})

test('Editable renderingStrategy promotes a shelled segment on mouse down', async () => {
  const editor = createReactEditor()

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
      id="rendering-strategy-promotion"
      renderingStrategy={{
        overscan: 0,
        type: 'shell',
        segmentSize: 2,
        threshold: 1,
      }}
    />
  )

  const targetShell = rendered.container.querySelector(
    '[data-slate-rendering-strategy-shell="true"][data-slate-rendering-strategy-segment="1"]'
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
      '[data-slate-rendering-strategy-shell="true"][data-slate-rendering-strategy-segment="1"]'
    )
  ).toBe(null)
  expect(DOMCoverage.getBoundary(editor, 'shell-aggressive:1')).toBe(null)
  expect(DOMCoverage.getBoundary(editor, 'shell-aggressive:2')).toMatchObject({
    reason: 'shell-aggressive',
    selectionPolicy: 'model-backed',
    state: 'virtualized',
  })
  expect(
    rendered.container.querySelectorAll('[data-slate-node="text"]').length
  ).toBe(2)
  expect(Editor.getSnapshot(editor).selection).toEqual({
    anchor: { offset: 0, path: [2, 0] },
    focus: { offset: 0, path: [2, 0] },
  })
})

test('Editable renderingStrategy shell focus does not activate or change model selection', async () => {
  const editor = createReactEditor()

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
      id="rendering-strategy-focus-promotion"
      renderingStrategy={{
        overscan: 0,
        type: 'shell',
        segmentSize: 2,
        threshold: 1,
      }}
    />
  )

  const targetShell = rendered.container.querySelector(
    '[data-slate-rendering-strategy-shell="true"][data-slate-rendering-strategy-segment="1"]'
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
      '[data-slate-rendering-strategy-shell="true"][data-slate-rendering-strategy-segment="1"]'
    )
  ).toBeTruthy()
  expect(Editor.getSnapshot(editor).selection).toBe(null)
})

test('Editable renderingStrategy shell interaction does not promote during composition', async () => {
  const editor = createReactEditor()

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
      id="rendering-strategy-composition-promotion"
      renderingStrategy={{
        overscan: 0,
        type: 'shell',
        segmentSize: 2,
        threshold: 1,
      }}
    />
  )

  const targetShell = rendered.container.querySelector(
    '[data-slate-rendering-strategy-shell="true"][data-slate-rendering-strategy-segment="1"]'
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
        '[data-slate-rendering-strategy-shell="true"][data-slate-rendering-strategy-segment="1"]'
      )
    ).toBeTruthy()
    expect(Editor.getSnapshot(editor).selection).toBe(null)
  } finally {
    IS_COMPOSING.set(editor, false)
  }
})

test('Editable renderingStrategy promotes a shell with keyboard activation', async () => {
  const editor = createReactEditor()

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
      id="rendering-strategy-keyboard-promotion"
      renderingStrategy={{
        overscan: 0,
        type: 'shell',
        segmentSize: 2,
        threshold: 1,
      }}
    />
  )

  const targetShell = rendered.container.querySelector(
    '[data-slate-rendering-strategy-shell="true"][data-slate-rendering-strategy-segment="1"]'
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
      '[data-slate-rendering-strategy-shell="true"][data-slate-rendering-strategy-segment="1"]'
    )
  ).toBe(null)
  expect(Editor.getSnapshot(editor).selection).toEqual({
    anchor: { offset: 0, path: [2, 0] },
    focus: { offset: 0, path: [2, 0] },
  })
})

test('Editable renderingStrategy promotes a shell with Space keyboard activation', async () => {
  const editor = createReactEditor()

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
      id="rendering-strategy-keyboard-space-promotion"
      renderingStrategy={{
        overscan: 0,
        type: 'shell',
        segmentSize: 2,
        threshold: 1,
      }}
    />
  )

  const targetShell = rendered.container.querySelector(
    '[data-slate-rendering-strategy-shell="true"][data-slate-rendering-strategy-segment="1"]'
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
      '[data-slate-rendering-strategy-shell="true"][data-slate-rendering-strategy-segment="1"]'
    )
  ).toBe(null)
  expect(Editor.getSnapshot(editor).selection).toEqual({
    anchor: { offset: 0, path: [2, 0] },
    focus: { offset: 0, path: [2, 0] },
  })
})

test('Editable renderingStrategy maps Ctrl+A to a full-document model selection without expanding shells', async () => {
  const editor = createReactEditor()

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
      id="rendering-strategy-select-all"
      renderingStrategy={{
        overscan: 0,
        type: 'shell',
        segmentSize: 2,
        threshold: 1,
      }}
    />
  )

  const root = rendered.container.querySelector(
    '#rendering-strategy-select-all'
  ) as HTMLElement | null

  expect(root).toBeTruthy()

  await act(async () => {
    fireEditorSelectAll(root!)
  })

  const snapshot = Editor.getSnapshot(editor)

  expect(snapshot.selection).toEqual({
    anchor: Editor.point(editor, [], { edge: 'start' }),
    focus: Editor.point(editor, [], { edge: 'end' }),
  })
  expect(root!.getAttribute('data-slate-rendering-strategy-selection')).toBe(
    'shell-backed'
  )
  expect(
    rendered.container.querySelectorAll(
      '[data-slate-rendering-strategy-shell="true"]'
    ).length
  ).toBe(2)
})

test('Editable renderingStrategy derives shell-backed state for programmatic broad selections', async () => {
  const editor = createReactEditor()

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
      id="rendering-strategy-programmatic-shell-selection"
      renderingStrategy={{
        overscan: 0,
        type: 'shell',
        segmentSize: 2,
        threshold: 1,
      }}
    />
  )

  const root = rendered.container.querySelector(
    '#rendering-strategy-programmatic-shell-selection'
  ) as HTMLElement | null

  expect(root).toBeTruthy()
  expect(root!.getAttribute('data-slate-rendering-strategy-selection')).toBe(
    null
  )

  await act(async () => {
    editor.update((tx) => {
      tx.selection.set({
        anchor: Editor.point(editor, [], { edge: 'start' }),
        focus: Editor.point(editor, [], { edge: 'end' }),
      })
    })
  })

  expect(root!.getAttribute('data-slate-rendering-strategy-selection')).toBe(
    'shell-backed'
  )
})

test('Editable renderingStrategy keeps broad select-all from replanning the active segment', async () => {
  const editor = createReactEditor()
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
        id="rendering-strategy-broad-select-all"
        renderingStrategy={{
          overscan: 0,
          type: 'shell',
          segmentSize: 2,
          threshold: 1,
        }}
      />
    )

    const root = rendered.container.querySelector(
      '#rendering-strategy-broad-select-all'
    ) as HTMLElement | null

    expect(root).toBeTruthy()
    counter.reset()

    await act(async () => {
      fireEditorSelectAll(root!)
    })

    const snapshot = Editor.getSnapshot(editor)

    expect(snapshot.selection).toEqual({
      anchor: Editor.point(editor, [], { edge: 'start' }),
      focus: Editor.point(editor, [], { edge: 'end' }),
    })
    expect(root!.getAttribute('data-slate-rendering-strategy-selection')).toBe(
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

test('Editable renderingStrategy preserves multiline plain text over a full-document shell-backed selection', async () => {
  const editor = createReactEditor()

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
      id="rendering-strategy-paste-full-doc"
      renderingStrategy={{
        overscan: 0,
        type: 'shell',
        segmentSize: 2,
        threshold: 1,
      }}
    />
  )

  const root = rendered.container.querySelector(
    '#rendering-strategy-paste-full-doc'
  ) as HTMLElement | null

  expect(root).toBeTruthy()

  await act(async () => {
    fireEditorSelectAll(root!)
  })

  await act(async () => {
    fireEditorPaste(root!, {
      types: ['text/plain'],
      getData: (type = 'text/plain') =>
        type === 'text/plain' ? 'one\ntwo' : '',
    })
  })

  expect(rendered.container.textContent?.includes('one')).toBe(true)
  expect(rendered.container.textContent?.includes('two')).toBe(true)
  expect(
    rendered.container.querySelectorAll(
      '[data-slate-rendering-strategy-shell="true"]'
    ).length
  ).toBe(0)
  expect(Editor.getSnapshot(editor).children).toEqual([
    {
      type: 'paragraph',
      children: [{ text: 'one' }],
    },
    {
      type: 'paragraph',
      children: [{ text: 'two' }],
    },
  ])
})

test('Editable renderingStrategy preserves Slate fragment data for shell-backed paste', async () => {
  const editor = createReactEditor()

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
      id="rendering-strategy-paste-fragment"
      renderingStrategy={{
        overscan: 0,
        type: 'shell',
        segmentSize: 2,
        threshold: 1,
      }}
    />
  )

  const root = rendered.container.querySelector(
    '#rendering-strategy-paste-fragment'
  ) as HTMLElement | null

  expect(root).toBeTruthy()

  await act(async () => {
    fireEditorSelectAll(root!)
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
    fireEditorPaste(root!, {
      types: ['application/x-slate-fragment', 'text/plain'],
      getData: (type = 'text/plain') =>
        type === 'application/x-slate-fragment'
          ? encodedFragment
          : type === 'text/plain'
            ? 'plain fallback'
            : '',
    })
  })

  expect(Editor.string(editor, [])).toBe('fragment marker')
})

test('Editable forwards scrollSelectionIntoView to app-owned code', async () => {
  const editor = createReactEditor()
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
