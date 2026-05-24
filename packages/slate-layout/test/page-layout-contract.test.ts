import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, renderHook } from '@testing-library/react'
import { createEditor, defineStateField } from 'slate'

import {
  createEstimatedPageLayoutEngine,
  createSlateLayout,
  createSlatePage,
  createSlatePageLayout,
  getSlatePageLayoutDecorations,
  getSlatePageLayoutGeometry,
  getSlatePageLayoutProjection,
  paginateSlatePageLayoutBlocks,
  pretextPageLayoutEngine,
  type SlateLayoutSnapshot,
  type SlatePageSettings,
} from '../src'
import { useSlateLayout } from '../src/react'

const registeredDom = typeof document === 'undefined'

if (registeredDom) {
  GlobalRegistrator.register()
}

afterAll(() => {
  if (registeredDom) {
    GlobalRegistrator.unregister()
  }
})

class TestCanvasRenderingContext2D {
  font = ''

  measureText(text: string): { width: number } {
    const fontSize = Number(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 16)
    const textWidth = /700/.test(this.font)
      ? fontSize * 0.65
      : /Menlo|monospace/.test(this.font)
        ? fontSize * 0.7
        : fontSize * 0.6
    let width = 0

    for (const character of text) {
      width += character === ' ' ? fontSize * 0.33 : textWidth
    }

    return { width }
  }
}

class TestOffscreenCanvas {
  getContext(_kind: string): TestCanvasRenderingContext2D {
    return new TestCanvasRenderingContext2D()
  }
}

const pageSettings = defineStateField<SlatePageSettings>({
  key: 'layout.page',
  collab: 'shared',
  history: 'push',
  initial: () => ({ margins: 96, preset: 'a4' }),
  persist: true,
})

describe('createSlatePageLayout', () => {
  it('keeps equivalent inline page settings from retriggering React layout refreshes', async () => {
    Reflect.set(globalThis, 'OffscreenCanvas', TestOffscreenCanvas)
    const editor = createEditor({
      initialValue: [
        {
          type: 'paragraph',
          children: [{ text: 'Stable inline page settings.' }],
        },
      ],
    })
    const createPage = (margins: number) =>
      ({ margins, preset: 'letter' }) as const
    const { result, rerender, unmount } = renderHook(
      ({ page }) => useSlateLayout(editor, { page }),
      { initialProps: { page: createPage(72) } }
    )
    const layout = result.current

    await act(async () => {})
    const composeCount = layout.getMetrics().composeCount

    await act(async () => {
      rerender({ page: createPage(72) })
    })

    expect(result.current).toBe(layout)
    expect(layout.getMetrics().composeCount).toBe(composeCount)

    await act(async () => {
      rerender({ page: createPage(96) })
    })

    expect(layout.getMetrics().composeCount).toBeGreaterThan(composeCount)

    unmount()
  })

  it('exports Pretext as the built-in page layout engine', () => {
    Reflect.set(globalThis, 'OffscreenCanvas', TestOffscreenCanvas)
    const settings = { margins: 96, preset: 'a4' } as const
    const page = createSlatePage(settings)

    const output = pretextPageLayoutEngine().compose({
      blocks: [
        {
          element: {
            type: 'paragraph',
            children: [{ text: 'Text   ' }],
          },
          lineHeight: 24,
          path: [0],
          spacingAfter: 12,
          text: 'Text   ',
          textStyle: {
            font: '400 16px Arial',
            letterSpacing: 0,
          },
        },
      ],
      page,
      settings,
      version: 1,
    })

    expect(output.fragments[0]!.lines[0]).toMatchObject({
      end: 'Text   '.length,
      start: 0,
      text: 'Text   ',
    })
  })

  it('uses rich-inline fragments for normal whitespace mixed runs', () => {
    Reflect.set(globalThis, 'OffscreenCanvas', TestOffscreenCanvas)
    const settings = { margins: 358, preset: 'letter' } as const
    const page = createSlatePage(settings)
    const output = pretextPageLayoutEngine({ whiteSpace: 'normal' }).compose({
      blocks: [
        {
          element: {
            type: 'paragraph',
            children: [
              { text: 'alpha ' },
              { text: 'beta', bold: true },
              { text: ' code', code: true },
            ],
          },
          lineHeight: 24,
          path: [0],
          runs: [
            {
              id: '0.0:0-6',
              path: [0, 0],
              range: { end: 6, start: 0 },
              text: 'alpha ',
              textStyle: {
                font: '400 16px Arial',
                letterSpacing: 0,
              },
            },
            {
              id: '0.1:6-10',
              path: [0, 1],
              range: { end: 10, start: 6 },
              text: 'beta',
              textStyle: {
                font: '700 16px Arial',
                letterSpacing: 0,
              },
            },
            {
              id: '0.2:10-15',
              path: [0, 2],
              range: { end: 15, start: 10 },
              text: ' code',
              textStyle: {
                font: '400 16px Menlo, monospace',
                letterSpacing: 0,
              },
            },
          ],
          spacingAfter: 12,
          text: 'alpha beta code',
          textStyle: {
            font: '400 16px Arial',
            letterSpacing: 0,
          },
        },
      ],
      page,
      settings,
      version: 1,
    })
    const lines = output.fragments[0]!.lines

    expect(lines).toHaveLength(2)
    expect(lines[0]!.text).toBe('alpha beta')
    expect(lines[0]!.runs).toEqual([
      expect.objectContaining({
        leafRange: { end: 5, start: 0 },
        left: 0,
        path: [0, 0],
        range: { end: 5, start: 0 },
        text: 'alpha',
      }),
      expect.objectContaining({
        leafRange: { end: 6, start: 5 },
        left: 48,
        path: [0, 0],
        range: { end: 6, start: 5 },
        text: ' ',
      }),
      expect.objectContaining({
        leafRange: { end: 4, start: 0 },
        path: [0, 1],
        range: { end: 10, start: 6 },
        text: 'beta',
      }),
    ])
    expect(lines[0]!.runs![0]!.width).toBeCloseTo(48)
    expect(lines[0]!.runs![1]!.width).toBeCloseTo(5.28)
    expect(lines[0]!.runs![2]!.left).toBeCloseTo(53.28)

    expect(lines[1]!.text).toBe('code')
    expect(lines[1]!.runs).toEqual([
      expect.objectContaining({
        leafRange: { end: 5, start: 1 },
        left: 0,
        path: [0, 2],
        range: { end: 15, start: 11 },
        text: 'code',
      }),
    ])
  })

  it('projects collapsed rich-inline whitespace at style boundaries', () => {
    Reflect.set(globalThis, 'OffscreenCanvas', TestOffscreenCanvas)
    const editor = createEditor({
      initialValue: [
        {
          type: 'paragraph',
          children: [{ text: 'alpha ' }, { text: 'beta', bold: true }],
        },
      ],
    })
    const layout = createSlatePageLayout(editor, () => ({
      engine: pretextPageLayoutEngine({ whiteSpace: 'normal' }),
      page: pageSettings,
    }))
    const rects = layout.projectRange({
      anchor: { path: [0, 0], offset: 5 },
      focus: { path: [0, 0], offset: 6 },
    })

    expect(rects).toHaveLength(1)
    expect(rects[0]!.width).toBeGreaterThan(0)

    layout.destroy()
  })

  it('exposes the generic layout API without an engine at the call site', () => {
    Reflect.set(globalThis, 'OffscreenCanvas', TestOffscreenCanvas)
    const editor = createEditor({
      initialValue: [
        {
          type: 'paragraph',
          children: [{ text: 'Generic layout call site.' }],
        },
      ],
    })
    const layout = createSlateLayout(editor, () => ({
      page: { margins: 72, preset: 'letter' },
    }))
    const snapshot: SlateLayoutSnapshot = layout.getSnapshot()

    expect(snapshot.settings).toEqual({ margins: 72, preset: 'letter' })
    expect(snapshot.page.width).toBe(816)
    expect(snapshot.blocks[0]!.text).toBe('Generic layout call site.')

    layout.destroy()
  })

  it('keeps the generic layout API usable without browser canvas measurement', () => {
    const previousOffscreenCanvas = Reflect.get(globalThis, 'OffscreenCanvas')
    const hadOffscreenCanvas = Reflect.has(globalThis, 'OffscreenCanvas')

    Reflect.deleteProperty(globalThis, 'OffscreenCanvas')

    try {
      const editor = createEditor({
        initialValue: [
          {
            type: 'paragraph',
            children: [{ text: 'Headless layout call site.' }],
          },
        ],
      })
      const layout = createSlateLayout(editor, () => ({
        page: { margins: 72, preset: 'letter' },
      }))
      const snapshot = layout.getSnapshot()

      expect(snapshot.settings).toEqual({ margins: 72, preset: 'letter' })
      expect(snapshot.blocks[0]!.text).toBe('Headless layout call site.')
      expect(layout.getMetrics().pageCount).toBe(1)

      layout.destroy()
    } finally {
      if (hadOffscreenCanvas) {
        Reflect.set(globalThis, 'OffscreenCanvas', previousOffscreenCanvas)
      } else {
        Reflect.deleteProperty(globalThis, 'OffscreenCanvas')
      }
    }
  })

  it('keeps page settings in state fields and layout output in the derived store', () => {
    const editor = createEditor({
      extensions: [pageSettings],
      initialValue: {
        children: [
          {
            type: 'paragraph',
            children: [{ text: 'One '.repeat(5000) }],
          },
        ],
        state: {
          [pageSettings.key]: { margins: 72, preset: 'letter' },
        },
      },
    })
    const layout = createSlatePageLayout(editor, () => ({
      engine: createEstimatedPageLayoutEngine(),
      page: pageSettings,
    }))

    expect(layout.getSnapshot().settings).toEqual({
      margins: 72,
      preset: 'letter',
    })
    expect(layout.getSnapshot().pages.length).toBeGreaterThan(1)
    expect(editor.read((state) => state.getField(pageSettings))).toEqual({
      margins: 72,
      preset: 'letter',
    })

    layout.destroy()
  })

  it('refreshes subscribers after editor text changes', () => {
    const editor = createEditor({
      extensions: [pageSettings],
      initialValue: [
        {
          type: 'paragraph',
          children: [{ text: 'Short paragraph.' }],
        },
      ],
    })
    const layout = createSlatePageLayout(editor, () => ({
      engine: createEstimatedPageLayoutEngine(),
      page: pageSettings,
    }))
    let wakeCount = 0
    const unsubscribe = layout.subscribe(() => {
      wakeCount++
    })

    editor.update((tx) => {
      tx.text.insert(' Added text.', {
        at: { path: [0, 0], offset: 'Short paragraph.'.length },
      })
    })

    expect(wakeCount).toBe(1)
    expect(layout.getMetrics().composeCount).toBe(2)

    unsubscribe()
    layout.destroy()
  })

  it('binds extracted blocks and projected ranges to the layout root', () => {
    const headerText = 'Header '.repeat(160)
    const mainText = 'Main '.repeat(12)
    const editor = createEditor({
      initialValue: {
        roots: {
          header: [
            {
              type: 'paragraph',
              children: [{ text: headerText }],
            },
          ],
          main: [
            {
              type: 'paragraph',
              children: [{ text: mainText }],
            },
          ],
        },
      },
    })
    const layout = createSlatePageLayout(editor, () => ({
      engine: createEstimatedPageLayoutEngine(),
      root: 'header',
      page: pageSettings,
    }))

    expect(layout.getSnapshot().root).toBe('header')
    expect(layout.getSnapshot().blocks).toHaveLength(1)
    expect(layout.getSnapshot().blocks[0]!.text).toBe(headerText)
    expect(
      layout.projectRange({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 6 },
      }).length
    ).toBeGreaterThan(0)
    expect(
      layout.projectRange({
        anchor: { path: [0, 0], offset: 0, root: 'header' },
        focus: { path: [0, 0], offset: 6, root: 'header' },
      }).length
    ).toBeGreaterThan(0)
    expect(
      layout.projectRange({
        anchor: { path: [0, 0], offset: 0, root: 'main' },
        focus: { path: [0, 0], offset: 4, root: 'main' },
      })
    ).toEqual([])
    expect(
      layout.projectRange({
        anchor: { path: [0, 0], offset: 0, root: 'header' },
        focus: { path: [0, 0], offset: 4, root: 'main' },
      })
    ).toEqual([])

    layout.destroy()
  })

  it('projects ranges through the requested page geometry', () => {
    const text = 'Long '.repeat(6000)
    const editor = createEditor({
      initialValue: [
        {
          type: 'paragraph',
          children: [{ text }],
        },
      ],
    })
    const layout = createSlatePageLayout(editor, () => ({
      engine: createEstimatedPageLayoutEngine(),
      page: pageSettings,
    }))
    const snapshot = layout.getSnapshot()

    expect(snapshot.pages.length).toBeGreaterThan(1)

    const singleRects = layout.projectRange(
      {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: text.length },
      },
      { pageGap: 24, pageLayoutMode: 'single' }
    )
    const spreadRects = layout.projectRange(
      {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: text.length },
      },
      { pageGap: 24, pageLayoutMode: 'spread' }
    )
    const firstSingleSecondPageRect = singleRects.find(
      (rect) => rect.top >= snapshot.pages[0]!.height
    )
    const firstSpreadSecondPageRect = spreadRects.find(
      (rect) => rect.left >= snapshot.pages[0]!.width
    )

    expect(firstSingleSecondPageRect?.top).toBe(
      snapshot.pages[0]!.height + 24 + snapshot.pages[1]!.content.top
    )
    expect(firstSpreadSecondPageRect?.left).toBe(
      snapshot.pages[0]!.width + 24 + snapshot.pages[1]!.content.left
    )
    expect(firstSpreadSecondPageRect?.top).toBe(snapshot.pages[1]!.content.top)

    layout.destroy()
  })

  it('projects only the requested partial range and collapsed caret', () => {
    const editor = createEditor({
      initialValue: [
        {
          type: 'paragraph',
          children: [{ text: 'Alpha beta' }],
        },
      ],
    })
    const layout = createSlatePageLayout(editor, () => ({
      engine: createEstimatedPageLayoutEngine(),
      page: pageSettings,
    }))

    const partialRects = layout.projectRange({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 5 },
    })
    const caretRects = layout.projectRange({
      anchor: { path: [0, 0], offset: 5 },
      focus: { path: [0, 0], offset: 5 },
    })

    expect(partialRects).toHaveLength(1)
    expect(partialRects[0]!.left).toBe(
      layout.getSnapshot().pages[0]!.content.left
    )
    expect(partialRects[0]!.width).toBe(40)
    expect(caretRects).toEqual([
      {
        height: layout.getSnapshot().blocks[0]!.lineHeight,
        left: layout.getSnapshot().pages[0]!.content.left + 40,
        top: layout.getSnapshot().pages[0]!.content.top,
        width: 0,
      },
    ])

    layout.destroy()
  })

  it('projects spanning ranges without leaking unrelated blocks', () => {
    const editor = createEditor({
      initialValue: [
        {
          type: 'paragraph',
          children: [{ text: 'First block' }],
        },
        {
          type: 'paragraph',
          children: [{ text: 'Second block' }],
        },
        {
          type: 'paragraph',
          children: [{ text: 'Third block' }],
        },
      ],
    })
    const layout = createSlatePageLayout(editor, () => ({
      engine: createEstimatedPageLayoutEngine(),
      page: pageSettings,
    }))
    const rects = layout.projectRange({
      anchor: { path: [0, 0], offset: 6 },
      focus: { path: [1, 0], offset: 6 },
    })

    expect(rects).toHaveLength(2)
    expect(rects.map((rect) => rect.width)).toEqual([40, 48])
    expect(rects[1]!.top).toBeGreaterThan(rects[0]!.top)

    layout.destroy()
  })

  it('extracts leaf runs with block offsets and projects placed runs on lines', () => {
    const editor = createEditor({
      initialValue: [
        {
          type: 'paragraph',
          children: [
            { text: 'Bold ', bold: true },
            { text: 'code', code: true },
          ],
        },
      ],
    })
    const layout = createSlatePageLayout(editor, () => ({
      engine: createEstimatedPageLayoutEngine(),
      page: pageSettings,
      typography: {
        text({ leaf }) {
          if (leaf.code) {
            return { font: '400 16px Mono', letterSpacing: 0 }
          }

          if (leaf.bold) {
            return { font: '700 16px Inter', letterSpacing: 0 }
          }

          return { font: '400 16px Inter', letterSpacing: 0 }
        },
      },
    }))
    const snapshot = layout.getSnapshot()
    const block = snapshot.blocks[0]!
    const projection = getSlatePageLayoutProjection(snapshot)

    expect(block.text).toBe('Bold code')
    expect(
      block.runs.map((run) => ({
        path: run.path,
        range: run.range,
        text: run.text,
        textStyle: run.textStyle,
      }))
    ).toEqual([
      {
        path: [0, 0],
        range: { end: 5, start: 0 },
        text: 'Bold ',
        textStyle: { font: '700 16px Inter', letterSpacing: 0 },
      },
      {
        path: [0, 1],
        range: { end: 9, start: 5 },
        text: 'code',
        textStyle: { font: '400 16px Mono', letterSpacing: 0 },
      },
    ])
    expect(
      projection.lines[0]!.runs.map((run) => ({
        left: run.left,
        path: run.path,
        range: run.range,
        text: run.text,
        width: run.width,
      }))
    ).toEqual([
      {
        left: 0,
        path: [0, 0],
        range: { end: 5, start: 0 },
        text: 'Bold ',
        width: 40,
      },
      {
        left: 40,
        path: [0, 1],
        range: { end: 9, start: 5 },
        text: 'code',
        width: 32,
      },
    ])

    layout.destroy()
  })

  it('extracts block-local boxes for structured Markdown nodes', () => {
    const editor = createEditor({
      initialValue: [
        {
          type: 'code-block',
          children: [{ text: 'one\ntwo' }],
        },
        {
          type: 'thematic-break',
          children: [{ text: '' }],
        },
        {
          type: 'image',
          url: 'https://example.com/image.png',
          children: [{ text: '' }],
        },
        {
          type: 'table',
          children: [
            {
              type: 'table-row',
              children: [
                { type: 'table-cell', children: [{ text: 'A' }] },
                { type: 'table-cell', children: [{ text: 'B' }] },
              ],
            },
            {
              type: 'table-row',
              children: [
                { type: 'table-cell', children: [{ text: '1' }] },
                { type: 'table-cell', children: [{ text: '2' }] },
              ],
            },
          ],
        },
      ],
    })
    const layout = createSlatePageLayout(editor, () => ({
      engine: createEstimatedPageLayoutEngine(),
      page: pageSettings,
    }))
    const boxes = layout
      .getSnapshot()
      .blocks.flatMap((block) => block.boxes ?? [])
      .map((box) => ({
        kind: box.kind,
        path: box.path,
        rect: box.rect,
        split: box.split,
      }))

    expect(boxes).toEqual([
      {
        kind: 'block',
        path: [0],
        rect: { height: 48, left: 0, top: 0, width: 0 },
        split: 'avoid',
      },
      {
        kind: 'code-line',
        path: [0, 0],
        rect: { height: 24, left: 0, top: 0, width: 0 },
        split: 'line',
      },
      {
        kind: 'code-line',
        path: [0, 0],
        rect: { height: 24, left: 0, top: 24, width: 0 },
        split: 'line',
      },
      {
        kind: 'thematic-break',
        path: [1],
        rect: { height: 24, left: 0, top: 0, width: 0 },
        split: 'avoid',
      },
      {
        kind: 'image',
        path: [2],
        rect: { height: 24, left: 0, top: 0, width: 0 },
        split: 'avoid',
      },
      {
        kind: 'table',
        path: [3],
        rect: { height: 2, left: 0, top: 0, width: 2 },
        split: 'row',
      },
      {
        kind: 'table-cell',
        path: [3, 0, 0],
        rect: { height: 1, left: 0, top: 0, width: 1 },
        split: 'avoid',
      },
      {
        kind: 'table-cell',
        path: [3, 0, 1],
        rect: { height: 1, left: 1, top: 0, width: 1 },
        split: 'avoid',
      },
      {
        kind: 'table-cell',
        path: [3, 1, 0],
        rect: { height: 1, left: 0, top: 1, width: 1 },
        split: 'avoid',
      },
      {
        kind: 'table-cell',
        path: [3, 1, 1],
        rect: { height: 1, left: 1, top: 1, width: 1 },
        split: 'avoid',
      },
    ])

    layout.destroy()
  })
})

describe('paginateSlatePageLayoutBlocks', () => {
  it('moves overflow fragments to later fixed-size pages', () => {
    const settings = { margins: 96, preset: 'a4' } as const
    const page = createSlatePage(settings)
    const output = paginateSlatePageLayoutBlocks({
      measuredBlocks: [
        {
          blockIndex: 0,
          element: {
            type: 'paragraph',
            children: [{ text: 'Long' }],
          },
          lineCount: Math.ceil(page.content.height / 24) + 4,
          lineHeight: 24,
          path: [0],
          spacingAfter: 12,
          text: 'Long',
          textStyle: { font: '400 16px Inter' },
        },
      ],
      page,
      settings,
      version: 1,
    })

    expect(output.pages).toHaveLength(2)
    expect(output.pages.map((fragmentPage) => fragmentPage.height)).toEqual([
      page.height,
      page.height,
    ])
    expect(output.fragments.map((fragment) => fragment.pageIndex)).toEqual([
      0, 1,
    ])
    expect(output.fragments[1]!.top).toBe(page.content.top)
    expect(output.fragments[0]!.lines[0]!.top).toBe(page.content.top)
    expect(output.fragments[1]!.lines[0]!.top).toBe(page.content.top)
  })

  it('moves avoid-split structured blocks to the next page when they do not fit', () => {
    const settings = { margins: 96, preset: 'a4' } as const
    const page = createSlatePage(settings)
    const output = paginateSlatePageLayoutBlocks({
      measuredBlocks: [
        {
          blockIndex: 0,
          element: {
            type: 'paragraph',
            children: [{ text: 'Filler' }],
          },
          lineCount: 37,
          lineHeight: 24,
          path: [0],
          spacingAfter: 12,
          text: 'Filler',
          textStyle: { font: '400 16px Inter' },
        },
        {
          blockIndex: 1,
          boxes: [
            {
              kind: 'block',
              path: [1],
              rect: { height: 48, left: 0, top: 0, width: 0 },
              split: 'avoid',
            },
          ],
          element: {
            type: 'code-block',
            children: [{ text: 'one\ntwo' }],
          },
          lineCount: 2,
          lineHeight: 24,
          lines: [
            {
              end: 3,
              height: 24,
              start: 0,
              text: 'one',
              width: 24,
            },
            {
              end: 7,
              height: 24,
              start: 4,
              text: 'two',
              width: 24,
            },
          ],
          path: [1],
          spacingAfter: 12,
          text: 'one\ntwo',
          textStyle: { font: '400 16px Inter' },
        },
      ],
      page,
      settings,
      version: 1,
    })

    expect(output.fragments.map((fragment) => fragment.pageIndex)).toEqual([
      0, 1,
    ])
    expect(output.fragments[1]!).toMatchObject({
      blockIndex: 1,
      lineCount: 2,
      pageIndex: 1,
      path: [1],
      top: page.content.top,
    })
  })
})

describe('getSlatePageLayoutProjection', () => {
  it('projects text and native hit rects without changing visual width', () => {
    const settings = { margins: 96, preset: 'a4' } as const
    const page = createSlatePage(settings)
    const measuredBlocks = Array.from({ length: 2 }, (_, blockIndex) => ({
      blockIndex,
      element: {
        type: 'paragraph',
        children: [{ text: blockIndex === 0 ? 'Hi' : 'Next' }],
      },
      lineCount: 1,
      lineHeight: 24,
      lines: [
        {
          end: blockIndex === 0 ? 2 : 4,
          height: 24,
          start: 0,
          text: blockIndex === 0 ? 'Hi' : 'Next',
          width: blockIndex === 0 ? 16 : 32,
        },
      ],
      path: [blockIndex],
      spacingAfter: 12,
      text: blockIndex === 0 ? 'Hi' : 'Next',
      textStyle: { font: '400 16px Inter' },
    }))
    const output = paginateSlatePageLayoutBlocks({
      measuredBlocks,
      page,
      settings,
      version: 1,
    })
    const projection = getSlatePageLayoutProjection(
      {
        blocks: measuredBlocks,
        fragments: output.fragments,
        page,
        pages: output.pages,
        root: 'main',
        settings,
        version: 1,
      },
      { hitTesting: { inlineInset: 2 } }
    )

    expect(projection.lines[0]!.textRect).toEqual({
      height: 24,
      left: page.content.left + 2,
      top: page.content.top,
      width: 16,
    })
    expect(projection.lines[0]!.hitRect).toEqual({
      height: 36,
      left: page.content.left + 2,
      top: page.content.top,
      width: page.content.width - 2,
    })
    expect(projection.lines[1]!.hitRect).toEqual({
      height: 24,
      left: page.content.left + 2,
      top: page.content.top + 36,
      width: page.content.width - 2,
    })
  })

  it('builds per-text decorations from projected layout runs', () => {
    const editor = createEditor({
      initialValue: [
        {
          type: 'paragraph',
          children: [
            { text: 'Bold ', bold: true },
            { text: 'code', code: true },
          ],
        },
      ],
    })
    const layout = createSlatePageLayout(editor, () => ({
      engine: createEstimatedPageLayoutEngine(),
      page: pageSettings,
    }))
    const projection = getSlatePageLayoutProjection(layout.getSnapshot(), {
      hitTesting: { inlineInset: 2 },
    })
    const decorations = getSlatePageLayoutDecorations(projection, {
      data: ({ rects }) => ({
        paginationLine: {
          hitRect: rects.hitRect,
          textRect: rects.textRect,
        },
      }),
      rects: 'block',
    })

    expect(
      [...decorations.entries()].map(([pathKey, pathDecorations]) => [
        pathKey,
        pathDecorations.map((decoration) => ({
          data: decoration.data,
          key: decoration.key,
          range: decoration.range,
        })),
      ])
    ).toEqual([
      [
        '0.0',
        [
          {
            data: {
              paginationLine: {
                hitRect: {
                  height: 24,
                  left: 2,
                  top: 0,
                  width: 40,
                },
                textRect: {
                  height: 24,
                  left: 2,
                  top: 0,
                  width: 40,
                },
              },
            },
            key: `slate-layout:${projection.lines[0]!.fragmentId}:0:0.0:0-5`,
            range: {
              anchor: { path: [0, 0], offset: 0 },
              focus: { path: [0, 0], offset: 5 },
            },
          },
        ],
      ],
      [
        '0.1',
        [
          {
            data: {
              paginationLine: {
                hitRect: {
                  height: 24,
                  left: 42,
                  top: 0,
                  width: projection.blocks[0]!.width - 42,
                },
                textRect: {
                  height: 24,
                  left: 42,
                  top: 0,
                  width: 32,
                },
              },
            },
            key: `slate-layout:${projection.lines[0]!.fragmentId}:0:0.1:0-4`,
            range: {
              anchor: { path: [0, 1], offset: 0 },
              focus: { path: [0, 1], offset: 4 },
            },
          },
        ],
      ],
    ])

    layout.destroy()
  })

  it('projects repeated empty inserted blocks into separate editable boxes', () => {
    const settings = { margins: 96, preset: 'a4' } as const
    const page = createSlatePage(settings)
    const measuredBlocks = Array.from({ length: 4 }, (_, blockIndex) => ({
      blockIndex,
      element: {
        type: 'paragraph',
        children: [{ text: '' }],
      },
      lineCount: 1,
      lineHeight: 24,
      lines: [
        {
          end: 0,
          height: 24,
          start: 0,
          text: '',
          width: 0,
        },
      ],
      path: [blockIndex],
      spacingAfter: 12,
      text: '',
      textStyle: { font: '400 16px Inter' },
    }))
    const output = paginateSlatePageLayoutBlocks({
      measuredBlocks,
      page,
      settings,
      version: 1,
    })
    const projection = getSlatePageLayoutProjection({
      blocks: measuredBlocks,
      fragments: output.fragments,
      page,
      pages: output.pages,
      root: 'main',
      settings,
      version: 1,
    })

    expect(projection.blocks.map((block) => block.path)).toEqual([
      [0],
      [1],
      [2],
      [3],
    ])
    expect(projection.blocks.map((block) => block.top)).toEqual([
      page.content.top,
      page.content.top + 36,
      page.content.top + 72,
      page.content.top + 108,
    ])
    expect(
      projection.blocks.every(
        (block) => block.height === 24 && block.width === page.content.width
      )
    ).toBe(true)
    expect(projection.lines.map((line) => line.path)).toEqual([
      [0],
      [1],
      [2],
      [3],
    ])
    expect(projection.lines.every((line) => line.start === line.end)).toBe(true)
    expect(projection.lines.every((line) => line.width === 0)).toBe(true)
  })
})

describe('getSlatePageLayoutGeometry', () => {
  it('stacks single-page mode without changing page dimensions', () => {
    const settings = { margins: 96, preset: 'a4' } as const
    const pages = [createSlatePage(settings, 0), createSlatePage(settings, 1)]
    const geometry = getSlatePageLayoutGeometry(pages, {
      pageGap: 24,
      pageLayoutMode: 'single',
    })

    expect(geometry.width).toBe(pages[0]!.width)
    expect(geometry.height).toBe(pages[0]!.height * 2 + 24)
    expect(geometry.pagePlacements).toEqual([
      { left: 0, top: 0 },
      { left: 0, top: pages[0]!.height + 24 },
    ])
  })

  it('places facing pages in rows while keeping odd trailing pages on the left', () => {
    const settings = { margins: 96, preset: 'a4' } as const
    const pages = [
      createSlatePage(settings, 0),
      createSlatePage(settings, 1),
      createSlatePage(settings, 2),
    ]
    const geometry = getSlatePageLayoutGeometry(pages, {
      pageGap: 24,
      pageLayoutMode: 'spread',
    })

    expect(geometry.width).toBe(pages[0]!.width * 2 + 24)
    expect(geometry.height).toBe(pages[0]!.height * 2 + 24)
    expect(geometry.pagePlacements).toEqual([
      { left: 0, top: 0 },
      { left: pages[0]!.width + 24, top: 0 },
      { left: 0, top: pages[0]!.height + 24 },
    ])
  })
})
