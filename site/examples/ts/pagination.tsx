import {
  type ChangeEvent,
  type CSSProperties,
  createContext,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { defineStateField, NodeApi, type Value } from 'slate'
import {
  createSlatePage,
  getSlatePageLayoutDecorations,
  getSlatePageLayoutGeometry,
  getSlatePageLayoutPathKey,
  getSlatePageLayoutProjection,
  type SlateNodeLayoutProvider,
  type SlatePageLayoutDecorationRects,
  type SlatePageLayoutProjectedBlock,
  type SlatePageLayoutTypography,
  type SlatePagePreset,
  type SlatePageRect,
  type SlatePageSettings,
} from 'slate-layout'
import {
  PagedEditable,
  type PagedEditablePageLayoutMode,
  type SlateLayoutRenderedFragment,
  useSlateLayout,
  useSlateLayoutFragments,
  useSlateLayoutSnapshot,
} from 'slate-layout/react'
import {
  type EditableDecorate,
  type EditableDOMStrategyMetrics,
  type EditableProps,
  type RenderElementProps,
  type RenderLeafProps,
  Slate,
  useEditor,
  useElementPath,
  useSetStateField,
  useSlateEditor,
} from 'slate-react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/utils/cn'

const pageSettings = defineStateField<SlatePageSettings>({
  key: 'layout.page',
  collab: 'shared',
  history: 'push',
  initial: () => ({ margins: 96, preset: 'a4' }),
  persist: true,
})

type DOMStrategyMode = 'full' | 'staged' | 'virtualized'

const PAGE_GAP = 24
const PAGE_CONTENT_INLINE_INSET = 2
const PAGE_STACK_SAFE_INLINE = 72
const PAGE_TEXT_FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif'
const DEFAULT_MEDIA_HEIGHT = 240
const DEFAULT_TABLE_ROW_HEIGHT = 36
const DEFAULT_TABLE_ROWS = 40
const MAX_MEDIA_HEIGHT = 1200
const MAX_TABLE_ROWS = 1000

const richImageSvg =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 640 240%22%3E%3Crect width=%22640%22 height=%22240%22 fill=%22%23f8fafc%22/%3E%3Cpath d=%22M0 190 150 94l90 62 116-86 284 120v50H0z%22 fill=%22%23bfdbfe%22/%3E%3Ccircle cx=%22518%22 cy=%2262%22 r=%2238%22 fill=%22%23f59e0b%22/%3E%3Ctext x=%2232%22 y=%2250%22 font-family=%22Arial%22 font-size=%2228%22 fill=%22%23111827%22%3EMarkdown asset%3C/text%3E%3C/svg%3E'

type ElementSize = {
  height: number
  width: number
}

type PaginationLineDecorationData = {
  paginationLine?: SlatePageLayoutDecorationRects
}

const flowProjectedTypes = new Set(['image', 'table', 'thematic-break'])

const isFlowProjectedType = (type: unknown) =>
  typeof type === 'string' && flowProjectedTypes.has(type)

type PaginationTableLayout = {
  left: number
  top: number
}

const PaginationTableLayoutContext =
  createContext<PaginationTableLayout | null>(null)

const getFragmentUnitBounds = (
  fragments: readonly SlateLayoutRenderedFragment[]
): SlatePageRect | null => {
  const units = fragments.flatMap((fragment) => fragment.units ?? [])

  if (units.length === 0) {
    return null
  }

  const left = Math.min(...units.map((unit) => unit.rect.left))
  const top = Math.min(...units.map((unit) => unit.rect.top))
  const right = Math.max(
    ...units.map((unit) => unit.rect.left + unit.rect.width)
  )
  const bottom = Math.max(
    ...units.map((unit) => unit.rect.top + unit.rect.height)
  )

  return {
    height: bottom - top,
    left,
    top,
    width: right - left,
  }
}

const clampNumber = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

const useElementSize = <T extends HTMLElement>(): [
  RefObject<T | null>,
  ElementSize,
] => {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState<ElementSize>({ height: 0, width: 0 })

  useEffect(() => {
    const element = ref.current

    if (!element) {
      return
    }

    const update = () => {
      const rect = element.getBoundingClientRect()
      setSize({ height: rect.height, width: rect.width })
    }

    update()

    const observer = new ResizeObserver(update)
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  return [ref, size]
}

const fixtureParagraphs = [
  'Premirror Milestone 1 test document. This paragraph is intentionally long so we can validate word wrapping inside the composed frame. The quick brown fox jumps over the lazy dog while pagination logic tracks run boundaries and maps document ranges to absolute fragment positions.',
  'Second paragraph for wrapping and flow. We expect lines to break naturally at word boundaries and continue on subsequent lines before moving to the next page frame. This should mimic a word-processor style reading flow rather than a single scroll box.',
  'Third paragraph adds more content pressure. Layout metrics should increase pages when required, and each line fragment should remain fully inside the page content rect with no orphan leading character rendered outside its decorated run.',
  'Fourth paragraph repeats structured prose to force pagination. Typography and measured widths from pretext should drive deterministic line breaks. Selection and caret mapping should still align with these visual fragments.',
  'Fifth paragraph: the architecture keeps Slate as source of truth while decorations project fragments into absolute page coordinates. This gives us editable rich text with page-aware rendering behavior.',
  'Sixth paragraph closes the synthetic test fixture. If everything works, we should see multiple pages and no inner frame scrolling. Wrapping should remain stable across refreshes.',
]

const premirrorValue: Value = Array.from({ length: 7 }, (_, index) =>
  fixtureParagraphs.map((text) => ({
    type: 'paragraph',
    children: [{ text: `${text} Section ${index + 1}.` }],
  }))
).flat()

const createPaginationTableRows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    type: 'table-row',
    children: [
      {
        type: 'table-cell',
        children: [{ text: index === 0 ? 'Markdown' : `Row ${index + 1}` }],
      },
      {
        type: 'table-cell',
        children: [
          { text: index === 0 ? 'Slate node' : `Path-aware cell ${index + 1}` },
        ],
      },
      {
        type: 'table-cell',
        children: [
          {
            text: index === 0 ? 'Paged' : `Fragment ${index + 1}`,
          },
        ],
      },
    ],
  }))

const richMarkdownValue: Value = [
  {
    type: 'heading-one',
    children: [{ text: 'Rich Markdown pagination proof' }],
  },
  {
    type: 'paragraph',
    children: [
      { text: 'This mixed block carries ' },
      { text: 'strong', bold: true },
      { text: ', ' },
      { text: 'emphasis', italic: true },
      { text: ', inline ' },
      { text: 'code', code: true },
      { text: ', and strikethrough text for run-aware layout.' },
    ],
  },
  {
    type: 'block-quote',
    children: [
      {
        text: 'Blockquotes should stay inside the page frame while keeping editable text selection native.',
      },
    ],
  },
  {
    type: 'check-list-item',
    checked: true,
    children: [{ text: 'Task list item rendered as rich text.' }],
  },
  {
    type: 'code-block',
    language: 'ts',
    children: [
      {
        text: 'const page = layout.pages[0]\nexpect(page.content.width).toBeGreaterThan(0)',
      },
    ],
  },
  {
    type: 'table',
    children: createPaginationTableRows(MAX_TABLE_ROWS),
  },
  {
    type: 'image',
    url: richImageSvg,
    children: [{ text: '' }],
  },
  {
    type: 'thematic-break',
    children: [{ text: '' }],
  },
  {
    type: 'paragraph',
    children: [
      {
        text: 'Final paragraph after the mixed Markdown fixture keeps following content anchored after structured blocks.',
      },
    ],
  },
]

const initialValue: Value = [...premirrorValue, ...richMarkdownValue]

type PaginationElementProps = RenderElementProps & {
  blockBoxes: ReadonlyMap<string, SlatePageLayoutProjectedBlock>
  debugFrames: boolean
  usesVirtualizedLayout: boolean
}

const getProjectedStyle = ({
  box,
  debugFrames,
  flowElement,
  usesVirtualizedLayout,
}: {
  box: SlatePageRect
  debugFrames: boolean
  flowElement: boolean
  usesVirtualizedLayout: boolean
}): CSSProperties => ({
  boxSizing: 'border-box',
  caretColor: '#111827',
  color: flowElement ? '#111827' : 'transparent',
  height: Math.max(1, box.height),
  left: box.left,
  margin: 0,
  outline: debugFrames ? '1px dotted rgba(239, 68, 68, 0.55)' : undefined,
  overflow: 'visible',
  position: 'absolute',
  top: usesVirtualizedLayout ? 0 : box.top,
  width: Math.max(1, box.width),
})

const PaginationElement = ({
  attributes,
  blockBoxes,
  children,
  debugFrames,
  element,
  usesVirtualizedLayout,
}: PaginationElementProps) => {
  const path = useElementPath()
  const fragments = useSlateLayoutFragments()
  const tableLayout = useContext(PaginationTableLayoutContext)
  const elementType = element.type
  const blockBox = path
    ? blockBoxes.get(getSlatePageLayoutPathKey(path))
    : undefined
  const unitBounds = getFragmentUnitBounds(fragments)
  const box = unitBounds ?? blockBox

  if (elementType === 'table-row') {
    const rowUnit = fragments[0]?.units?.[0]
    const rowIndex = path?.at(-1)

    if (!rowUnit || !tableLayout) {
      return (
        <div
          {...attributes}
          data-pagination-row-index={rowIndex}
          data-testid="pagination-rich-table-row"
          style={{ display: 'none' }}
        >
          {children}
        </div>
      )
    }

    return (
      <div
        {...attributes}
        data-pagination-row-index={rowIndex}
        data-testid="pagination-rich-table-row"
        style={{
          display: 'flex',
          height: rowUnit.rect.height,
          left: rowUnit.rect.left - tableLayout.left,
          position: 'absolute',
          top: rowUnit.rect.top - tableLayout.top,
          width: rowUnit.rect.width,
        }}
      >
        {children}
      </div>
    )
  }

  if (elementType === 'table-cell') {
    return (
      <div
        {...attributes}
        data-pagination-column-index={path?.at(-1)}
        data-pagination-row-index={path?.at(-2)}
        data-testid="pagination-rich-table-cell"
        style={{
          border: '1px solid #cbd5e1',
          display: 'flex',
          flex: '1 1 0',
          flexDirection: 'column',
          fontSize: 13,
          justifyContent: 'center',
          lineHeight: '18px',
          minWidth: 0,
          overflow: 'hidden',
          padding: '5px 8px',
        }}
      >
        {children}
      </div>
    )
  }

  if (!box) {
    return <div {...attributes}>{children}</div>
  }

  const flowElement = isFlowProjectedType(elementType)
  const projectedStyle = getProjectedStyle({
    box,
    debugFrames,
    flowElement,
    usesVirtualizedLayout,
  })

  if (elementType === 'table') {
    return (
      <PaginationTableLayoutContext.Provider
        value={{ left: box.left, top: box.top }}
      >
        <div
          {...attributes}
          data-testid="pagination-rich-table"
          style={{
            ...projectedStyle,
            display: 'block',
          }}
        >
          {children}
        </div>
      </PaginationTableLayoutContext.Provider>
    )
  }

  if (elementType === 'image') {
    return (
      <div
        {...attributes}
        data-testid="pagination-rich-image"
        style={projectedStyle}
      >
        <img
          alt=""
          src={element.url}
          style={{
            border: '1px solid #cbd5e1',
            display: 'block',
            height: '100%',
            objectFit: 'cover',
            width: '100%',
          }}
        />
        {children}
      </div>
    )
  }

  if (elementType === 'thematic-break') {
    return (
      <div
        {...attributes}
        data-testid="pagination-rich-thematic-break"
        style={projectedStyle}
      >
        <hr
          style={{
            border: 0,
            borderTop: '2px solid #cbd5e1',
            margin: '11px 0 0',
          }}
        />
        {children}
      </div>
    )
  }

  return (
    <div
      {...attributes}
      data-testid={
        elementType === 'code-block'
          ? 'pagination-rich-code-block'
          : debugFrames
            ? 'pagination-projected-block'
            : undefined
      }
      style={{
        ...projectedStyle,
        background:
          elementType === 'code-block'
            ? 'rgba(15, 23, 42, 0.04)'
            : elementType === 'block-quote'
              ? 'rgba(37, 99, 235, 0.04)'
              : undefined,
        borderLeft:
          elementType === 'block-quote'
            ? '3px solid rgba(37, 99, 235, 0.35)'
            : undefined,
        paddingLeft: elementType === 'block-quote' ? 12 : undefined,
      }}
    >
      {children}
    </div>
  )
}

const PaginationSurface = () => {
  const editor = useEditor()
  const setSettings = useSetStateField(pageSettings)
  const [domStrategyMode, setDOMStrategyMode] =
    useState<DOMStrategyMode>('staged')
  const [domStrategyMetrics, setDOMStrategyMetrics] =
    useState<EditableDOMStrategyMetrics | null>(null)
  const [pageLayoutMode, setPageLayoutMode] =
    useState<PagedEditablePageLayoutMode>('spread')
  const [debugFrames, setDebugFrames] = useState(false)
  const [tableRows, setTableRows] = useState(DEFAULT_TABLE_ROWS)
  const [tableRowHeight, setTableRowHeight] = useState(DEFAULT_TABLE_ROW_HEIGHT)
  const [mediaHeight, setMediaHeight] = useState(DEFAULT_MEDIA_HEIGHT)
  const [mediaSplit, setMediaSplit] = useState<'avoid' | 'page'>('avoid')
  const [viewportRef, viewportSize] = useElementSize<HTMLDivElement>()
  const typography = useMemo(
    () =>
      ({
        block: ({ element }) => ({
          blockSpacing:
            element.type === 'heading-one' || element.type === 'table'
              ? 18
              : 12,
          lineHeight:
            element.type === 'heading-one'
              ? 34
              : element.type === 'table'
                ? 72
                : element.type === 'image'
                  ? 120
                  : 24,
        }),
        text: ({ leaf }) => ({
          font: `${leaf.bold ? 700 : 400} 16px ${PAGE_TEXT_FONT}`,
          letterSpacing: 0,
        }),
      }) satisfies SlatePageLayoutTypography,
    []
  )
  const nodeLayout = useCallback<SlateNodeLayoutProvider>(
    ({ defaults, element, pageSettings, path }) => {
      const page = createSlatePage(pageSettings)

      if (element.type === 'table') {
        const rows = element.children.filter(
          (child) => NodeApi.isElement(child) && child.type === 'table-row'
        )
        const visibleRows = rows.slice(0, tableRows)

        return {
          boxes: defaults.boxes,
          type: 'units',
          units: visibleRows.map((_, rowIndex) => ({
            key: `row-${rowIndex}`,
            kind: 'table-row',
            path: [...path, rowIndex],
            rect: {
              height: tableRowHeight,
              left: 0,
              top: rowIndex * tableRowHeight,
              width: page.content.width,
            },
            split: 'avoid',
          })),
        }
      }

      if (element.type === 'image') {
        return {
          box: {
            kind: 'image',
            path: [...path],
            rect: {
              height: mediaHeight,
              left: 0,
              top: 0,
              width: page.content.width,
            },
            split: mediaSplit,
          },
          type: 'box',
        }
      }

      return { boxes: defaults.boxes, type: 'text' }
    },
    [mediaHeight, mediaSplit, tableRowHeight, tableRows]
  )
  const layout = useSlateLayout(editor, {
    nodeLayout,
    page: pageSettings,
    root: 'main',
    typography,
  })
  const snapshot = useSlateLayoutSnapshot(layout)
  const settings = snapshot.settings
  const metrics = layout.getMetrics()
  const pageGeometry = useMemo(
    () =>
      getSlatePageLayoutGeometry(snapshot.pages, {
        pageGap: PAGE_GAP,
        pageLayoutMode,
      }),
    [pageLayoutMode, snapshot.pages]
  )
  const layoutProjection = useMemo(
    () =>
      getSlatePageLayoutProjection(snapshot, {
        geometry: pageGeometry,
        hitTesting: { inlineInset: PAGE_CONTENT_INLINE_INSET },
      }),
    [pageGeometry, snapshot]
  )
  const blockBoxes = useMemo(
    () =>
      new Map(
        layoutProjection.blocks.map((block) => [
          getSlatePageLayoutPathKey(block.path),
          block,
        ])
      ),
    [layoutProjection]
  )
  const paginationDecorations = useMemo(
    () =>
      getSlatePageLayoutDecorations<PaginationLineDecorationData>(
        layoutProjection,
        {
          data: ({ line, rects }) =>
            isFlowProjectedType(snapshot.blocks[line.blockIndex]?.element.type)
              ? undefined
              : { paginationLine: rects },
          rects: 'block',
        }
      ),
    [layoutProjection, snapshot.blocks]
  )
  const availableWidth = Math.max(
    0,
    viewportSize.width - PAGE_STACK_SAFE_INLINE * 2
  )
  const pageScale =
    pageGeometry.width > 0 && availableWidth > 0
      ? Math.min(1, availableWidth / pageGeometry.width)
      : 1
  const domStrategy = useMemo<EditableProps['domStrategy']>(
    () =>
      domStrategyMode === 'virtualized'
        ? {
            estimatedBlockSize: 48,
            overscan: 1,
            threshold: 1,
            type: 'virtualized',
          }
        : domStrategyMode,
    [domStrategyMode]
  )
  const usesVirtualizedLayout =
    domStrategyMetrics?.effectiveStrategy === 'virtualized'

  const updatePreset = (event: ChangeEvent<HTMLSelectElement>) => {
    const preset = event.currentTarget.value as SlatePagePreset
    setSettings((previous) => ({ ...previous, preset }))
  }

  const updateMargins = (event: ChangeEvent<HTMLInputElement>) => {
    const margins = Number.parseInt(event.currentTarget.value, 10)
    if (Number.isFinite(margins)) {
      setSettings((previous) => ({ ...previous, margins }))
    }
  }

  const updateDOMStrategy = (event: ChangeEvent<HTMLSelectElement>) => {
    setDOMStrategyMode(event.currentTarget.value as DOMStrategyMode)
  }

  const updateTableRows = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number.parseInt(event.currentTarget.value, 10)

    if (Number.isFinite(value)) {
      setTableRows(clampNumber(value, 8, MAX_TABLE_ROWS))
    }
  }

  const updateTableRowHeight = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number.parseInt(event.currentTarget.value, 10)

    if (Number.isFinite(value)) {
      setTableRowHeight(clampNumber(value, 28, 120))
    }
  }

  const updateMediaHeight = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number.parseInt(event.currentTarget.value, 10)

    if (Number.isFinite(value)) {
      setMediaHeight(clampNumber(value, 120, MAX_MEDIA_HEIGHT))
    }
  }

  const updateMediaSplit = (event: ChangeEvent<HTMLSelectElement>) => {
    setMediaSplit(event.currentTarget.value as 'avoid' | 'page')
  }

  const togglePageLayoutMode = () => {
    setPageLayoutMode((mode) => (mode === 'spread' ? 'single' : 'spread'))
  }
  const decorate = useCallback<EditableDecorate<PaginationLineDecorationData>>(
    ([node, path]) => {
      if (!NodeApi.isText(node)) {
        return []
      }

      return paginationDecorations.get(getSlatePageLayoutPathKey(path)) ?? []
    },
    [paginationDecorations]
  )
  const renderElement = useCallback(
    (props: RenderElementProps) => (
      <PaginationElement
        {...props}
        blockBoxes={blockBoxes}
        debugFrames={debugFrames}
        usesVirtualizedLayout={usesVirtualizedLayout}
      />
    ),
    [blockBoxes, debugFrames, usesVirtualizedLayout]
  )
  const renderLeaf = useCallback(
    ({ attributes, children, segment }: RenderLeafProps) => {
      const line = (
        segment.slices.find(
          (slice) =>
            (slice.data as PaginationLineDecorationData | undefined)
              ?.paginationLine
        )?.data as PaginationLineDecorationData | undefined
      )?.paginationLine

      if (!line) {
        return <span {...attributes}>{children}</span>
      }

      return (
        <span
          {...attributes}
          style={{
            display: 'inline-block',
            fontFamily: segment.marks.code
              ? 'SFMono-Regular, Menlo, monospace'
              : undefined,
            fontStyle: segment.marks.italic ? 'italic' : undefined,
            fontWeight: segment.marks.bold ? 700 : undefined,
            height: line.hitRect.height,
            left: line.textRect.left,
            lineHeight: `${line.textRect.height}px`,
            minWidth: line.textRect.width === 0 ? 1 : undefined,
            position: 'absolute',
            top: line.textRect.top,
            color: '#111827',
            textDecoration: segment.marks.strikethrough
              ? 'line-through'
              : undefined,
            whiteSpace: 'pre',
            width: line.hitRect.width,
          }}
        >
          {children}
        </span>
      )
    },
    []
  )

  return (
    <div className="slate-pagination-shell">
      <div className="slate-pagination-toolbar">
        <div className="slate-pagination-toolbar-group">
          <span className="slate-pagination-label">
            <Label htmlFor="pagination-preset">Preset</Label>
            <NativeSelect
              className="w-24"
              id="pagination-preset"
              onChange={updatePreset}
              value={settings.preset}
            >
              <NativeSelectOption value="a4">A4</NativeSelectOption>
              <NativeSelectOption value="letter">Letter</NativeSelectOption>
            </NativeSelect>
          </span>
          <span className="slate-pagination-label">
            <Label htmlFor="pagination-margins">Margins</Label>
            <Input
              className="w-20"
              id="pagination-margins"
              min={48}
              onChange={updateMargins}
              step={12}
              type="number"
              value={
                typeof settings.margins === 'number'
                  ? settings.margins
                  : settings.margins.top
              }
            />
          </span>
          <span className="slate-pagination-label">
            <Label htmlFor="pagination-dom-strategy">DOM strategy</Label>
            <NativeSelect
              className="w-32"
              id="pagination-dom-strategy"
              onChange={updateDOMStrategy}
              value={domStrategyMode}
            >
              <NativeSelectOption value="staged">Staged</NativeSelectOption>
              <NativeSelectOption value="full">Full</NativeSelectOption>
              <NativeSelectOption value="virtualized">
                Virtualized
              </NativeSelectOption>
            </NativeSelect>
          </span>
          <span className="slate-pagination-label">
            <Label htmlFor="pagination-rows">Rows</Label>
            <Input
              className="w-24"
              id="pagination-rows"
              max={MAX_TABLE_ROWS}
              min={8}
              onChange={updateTableRows}
              type="number"
              value={tableRows}
            />
          </span>
          <span className="slate-pagination-label">
            <Label htmlFor="pagination-row-height">Row px</Label>
            <Input
              className="w-20"
              id="pagination-row-height"
              max={120}
              min={28}
              onChange={updateTableRowHeight}
              step={4}
              type="number"
              value={tableRowHeight}
            />
          </span>
          <span className="slate-pagination-label">
            <Label htmlFor="pagination-media-height">Media px</Label>
            <Input
              className="w-24"
              id="pagination-media-height"
              max={MAX_MEDIA_HEIGHT}
              min={120}
              onChange={updateMediaHeight}
              step={40}
              type="number"
              value={mediaHeight}
            />
          </span>
          <span className="slate-pagination-label">
            <Label htmlFor="pagination-media-split">Media split</Label>
            <NativeSelect
              className="w-24"
              id="pagination-media-split"
              onChange={updateMediaSplit}
              value={mediaSplit}
            >
              <NativeSelectOption value="avoid">Avoid</NativeSelectOption>
              <NativeSelectOption value="page">Page</NativeSelectOption>
            </NativeSelect>
          </span>
        </div>
        <div className="slate-pagination-toolbar-group">
          <Separator className="h-6" orientation="vertical" />
          <span className="slate-pagination-switch-group">
            Facing
            <Switch
              aria-label="Facing"
              checked={pageLayoutMode === 'spread'}
              onCheckedChange={() => togglePageLayoutMode()}
            />
          </span>
          <Separator className="h-6" orientation="vertical" />
          <span className="slate-pagination-switch-group">
            Debug
            <Switch
              aria-label="Debug"
              checked={debugFrames}
              onCheckedChange={setDebugFrames}
            />
          </span>
        </div>
      </div>
      <div className="slate-pagination-title-row">
        <div className="slate-pagination-title">Untitled document</div>
        <div className="slate-pagination-meta">
          pages {snapshot.pages.length} | rows {tableRows} x {tableRowHeight}px
          | media {mediaHeight}px | blocks {metrics.blockCount} | compose{' '}
          {metrics.lastDurationMs.toFixed(1)}ms
        </div>
      </div>
      <div
        className="slate-pagination-viewport"
        data-testid="pagination-viewport"
        ref={viewportRef}
      >
        <div className="slate-pagination-viewport-inner">
          <div
            style={{
              height: pageGeometry.height * pageScale,
              width: pageGeometry.width * pageScale,
            }}
          >
            <div
              className="slate-pagination-scaled-surface"
              style={{
                transform: `scale(${pageScale})`,
                width: pageGeometry.width,
              }}
            >
              <PagedEditable
                className="slate-pagination-editor"
                decorate={decorate}
                domStrategy={domStrategy}
                layout={layout}
                onDOMStrategyMetrics={setDOMStrategyMetrics}
                pageView={{ gap: PAGE_GAP, mode: pageLayoutMode }}
                renderElement={renderElement}
                renderLeaf={renderLeaf}
                renderPage={({ attributes, page }) => (
                  <div
                    {...attributes}
                    className={cn(
                      'slate-pagination-page',
                      debugFrames && 'slate-pagination-page-debug'
                    )}
                    style={{
                      height: page.height,
                      overflow: 'hidden',
                      width: page.width,
                    }}
                  >
                    {debugFrames ? (
                      <>
                        <div
                          className="slate-pagination-content-frame"
                          data-testid="pagination-content-frame"
                          style={{
                            height: page.content.height,
                            left: page.content.left,
                            top: page.content.top,
                            width: page.content.width,
                          }}
                        />
                        <div className="slate-pagination-page-label">
                          page {page.index} | {page.width}x{page.height}px
                        </div>
                      </>
                    ) : null}
                  </div>
                )}
                spellCheck
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const PaginationExample = () => {
  const editor = useSlateEditor({
    extensions: [pageSettings],
    initialValue: {
      children: initialValue,
      state: {
        [pageSettings.key]: { margins: 96, preset: 'a4' },
      },
    },
  })

  return (
    <Slate editor={editor}>
      <PaginationSurface />
    </Slate>
  )
}

export default PaginationExample
