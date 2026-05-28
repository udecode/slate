import { render, waitFor } from '@testing-library/react'
import React from 'react'
import { Editor } from 'slate/internal'

import {
  createReactEditor,
  Editable,
  type EditableDOMStrategyMetrics,
  Slate,
} from '../src'
import { createPageItemIndexesForPath } from '../src/dom-strategy/use-virtualized-root-plan'

type TestEditorSurfaceProps = React.ComponentProps<typeof Editable> & {
  editor: React.ComponentProps<typeof Slate>['editor']
}

const TestEditorSurface = ({ editor, ...props }: TestEditorSurfaceProps) => (
  <Slate editor={editor}>
    <Editable {...props} />
  </Slate>
)

const createPageVirtualizedLayout = (
  count: number,
  options: { visiblePageIndexes?: readonly number[] } = {}
) => {
  const pageItems = Array.from(
    { length: Math.ceil(count / 2) },
    (_, index) => ({
      index,
      key: `page-${index}`,
      pageIndexes: [index],
      size: 100,
      start: index * 100,
      topLevelIndexes: [index * 2, index * 2 + 1].filter(
        (topLevelIndex) => topLevelIndex < count
      ),
    })
  )

  return {
    getVirtualizedPageItems: () => pageItems,
    getVisibleVirtualizedPageItems: options.visiblePageIndexes
      ? () =>
          pageItems.filter((item) =>
            options.visiblePageIndexes!.includes(item.index)
          )
      : undefined,
    getVirtualizedTopLevelItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        size: 20,
        start: index * 20,
      })),
  }
}

const createSplitTableVirtualizedLayout = () => ({
  getVirtualizedPageItems: () =>
    [0, 1, 2].map((index) => ({
      index,
      key: `table-page-${index}`,
      pageIndexes: [index],
      size: 100,
      start: index * 100,
      topLevelIndexes: index === 0 ? [0, 1] : [1],
      unitPaths: [[1, index]],
    })),
  getVirtualizedTopLevelItems: () => [
    {
      index: 0,
      size: 20,
      start: 0,
    },
    {
      index: 1,
      size: 300,
      start: 20,
    },
  ],
})

test('Editable domStrategy virtualized mode uses page layout items as the retained range unit', async () => {
  const editor = createReactEditor()

  Editor.replace(editor, {
    children: Array.from({ length: 6 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `block-${index + 1}` }],
    })),
    selection: {
      anchor: { offset: 0, path: [4, 0] },
      focus: { offset: 0, path: [4, 0] },
    },
  })

  const rendered = render(
    <TestEditorSurface
      domStrategy={{
        estimatedBlockSize: 20,
        overscan: 0,
        threshold: 1,
        type: 'virtualized',
      }}
      editor={editor}
      id="dom-strategy-page-virtualized"
      layout={createPageVirtualizedLayout(6)}
      style={{ height: 100, overflowY: 'auto' }}
    />
  )

  await waitFor(() =>
    expect(
      rendered.container.querySelector(
        '[data-slate-dom-strategy-virtualizer="true"]'
      )
    ).toBeTruthy()
  )

  const virtualizer = rendered.container.querySelector(
    '[data-slate-dom-strategy-virtualizer="true"]'
  ) as HTMLElement | null

  expect(virtualizer?.style.height).toBe('300px')
  await waitFor(() =>
    expect(
      rendered.container.querySelector(
        '[data-slate-dom-strategy-virtual-row="true"][data-index="4"]'
      )
    ).toBeTruthy()
  )
  expect(
    rendered.container.querySelector(
      '[data-slate-dom-strategy-virtual-row="true"][data-index="2"]'
    )
  ).toBe(null)
})

test('Editable domStrategy virtualized mode maps a selected split-table row path to its page item', () => {
  const pageItems =
    createSplitTableVirtualizedLayout().getVirtualizedPageItems()

  expect(createPageItemIndexesForPath(pageItems, [1])).toEqual([0, 1, 2])
  expect(createPageItemIndexesForPath(pageItems, [1, 2, 0, 0])).toEqual([2])
})

test('Editable domStrategy virtualized mode can share a layout-owned visible page window', async () => {
  const editor = createReactEditor()

  Editor.replace(editor, {
    children: Array.from({ length: 6 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `shared-window-block-${index + 1}` }],
    })),
    selection: null,
  })

  const rendered = render(
    <TestEditorSurface
      domStrategy={{
        estimatedBlockSize: 20,
        overscan: 0,
        threshold: 1,
        type: 'virtualized',
      }}
      editor={editor}
      id="dom-strategy-shared-page-window"
      layout={createPageVirtualizedLayout(6, { visiblePageIndexes: [2] })}
      style={{ height: 100, overflowY: 'auto' }}
    />
  )

  await waitFor(() =>
    expect(
      rendered.container.querySelector(
        '[data-slate-dom-strategy-virtualizer="true"]'
      )
    ).toBeTruthy()
  )

  expect(
    rendered.container.querySelector(
      '[data-slate-dom-strategy-virtual-row="true"][data-index="4"]'
    )
  ).toBeTruthy()
  expect(
    rendered.container.querySelector(
      '[data-slate-dom-strategy-virtual-row="true"][data-index="0"]'
    )
  ).toBe(null)
})

test('Editable domStrategy virtualized mode can use an outer scroll container', async () => {
  const editor = createReactEditor()

  Editor.replace(editor, {
    children: Array.from({ length: 4 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `outer-scroll-block-${index + 1}` }],
    })),
    selection: null,
  })

  const rendered = render(
    <div style={{ height: 100, overflowY: 'auto' }}>
      <TestEditorSurface
        domStrategy={{
          estimatedBlockSize: 20,
          overscan: 0,
          threshold: 1,
          type: 'virtualized',
        }}
        editor={editor}
        id="dom-strategy-outer-scroll-virtualized"
        layout={createPageVirtualizedLayout(4)}
      />
    </div>
  )

  await waitFor(() =>
    expect(
      rendered.container.querySelector(
        '[data-slate-dom-strategy-virtualizer="true"]'
      )
    ).toBeTruthy()
  )
})

test('Editable domStrategy metrics do not re-emit unchanged virtualized metrics after consumer state updates', async () => {
  const editor = createReactEditor()
  const metrics: EditableDOMStrategyMetrics[] = []

  Editor.replace(editor, {
    children: Array.from({ length: 4 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `metrics-block-${index + 1}` }],
    })),
    selection: null,
  })

  const MetricsConsumer = () => {
    const [latestMetrics, setLatestMetrics] =
      React.useState<EditableDOMStrategyMetrics | null>(null)

    return (
      <>
        <TestEditorSurface
          domStrategy={{
            estimatedBlockSize: 20,
            overscan: 0,
            threshold: 1,
            type: 'virtualized',
          }}
          editor={editor}
          id="dom-strategy-metrics-loop"
          layout={createPageVirtualizedLayout(4)}
          onDOMStrategyMetrics={(nextMetrics) => {
            metrics.push(nextMetrics)
            setLatestMetrics(nextMetrics)
          }}
          style={{ height: 100, overflowY: 'auto' }}
        />
        <output>{latestMetrics?.effectiveStrategy}</output>
      </>
    )
  }

  const rendered = render(<MetricsConsumer />)

  await waitFor(() =>
    expect(
      rendered.container.querySelector(
        '[data-slate-dom-strategy-virtualizer="true"]'
      )
    ).toBeTruthy()
  )
  await waitFor(() =>
    expect(rendered.container.querySelector('output')?.textContent).toBe(
      'virtualized'
    )
  )
  await new Promise((resolve) => setTimeout(resolve, 25))

  expect(metrics).toHaveLength(1)
})
