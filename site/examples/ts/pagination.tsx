import { css } from '@emotion/css'
import {
  type ChangeEvent,
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { defineStateField, NodeApi, type Value } from 'slate'
import {
  getSlatePageLayoutDecorations,
  getSlatePageLayoutGeometry,
  getSlatePageLayoutPathKey,
  getSlatePageLayoutProjection,
  type SlatePageLayoutDecorationRects,
  type SlatePageLayoutTypography,
  type SlatePagePreset,
  type SlatePageSettings,
} from 'slate-layout'
import {
  PagedEditable,
  type PagedEditablePageLayoutMode,
  useSlateLayout,
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
  useSetStateField,
  useSlateEditor,
} from 'slate-react'

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

const shellCss = css`
  position: fixed;
  inset: 84px 0 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: linear-gradient(180deg, #e8ecf2 0%, #d8dee8 42%, #cfd6e0 100%);
`

const toolbarCss = css`
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
  justify-content: space-between;
  padding: 7px 12px;
  border-bottom: 1px solid #c5ccd6;
  background: #f3f4f6;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
`

const toolbarGroupCss = css`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
`

const labelCss = css`
  display: inline-flex;
  gap: 6px;
  align-items: center;
  color: #4b5563;
  font-size: 12px;
  font-weight: 650;
`

const inputCss = css`
  height: 30px;
  min-width: 84px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: white;
  padding: 0 8px;
  color: #111827;
  font-size: 13px;
`

const toolbarSeparatorCss = css`
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: #d1d5db;
`

const switchGroupCss = css`
  display: inline-flex;
  gap: 6px;
  align-items: center;
  color: #4b5563;
  font-size: 12px;
`

const switchCss = css`
  display: inline-flex;
  align-items: center;
  width: 40px;
  height: 22px;
  border: 1px solid #d1d5db;
  border-radius: 999px;
  background: #e5e7eb;
  padding: 2px;
  cursor: pointer;

  &[aria-checked='true'] {
    border-color: #2563eb;
    background: #bfdbfe;
  }
`

const switchThumbCss = css`
  display: block;
  width: 16px;
  height: 16px;
  border: 1px solid #d1d5db;
  border-radius: 50%;
  background: white;
  transition: transform 0.15s ease;

  ${switchCss}[aria-checked='true'] & {
    transform: translateX(18px);
    border-color: #2563eb;
  }
`

const titleRowCss = css`
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
  justify-content: space-between;
  padding: 10px 16px 8px;
  border-bottom: 1px solid #bfc7d4;
`

const titleCss = css`
  color: #111827;
  font-size: 15px;
  font-weight: 650;
`

const metaCss = css`
  color: #4b5563;
  font-size: 12px;
`

const viewportCss = css`
  flex: 1;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 20px 24px 32px;
`

const viewportInnerCss = css`
  display: flex;
  justify-content: center;
  min-width: 100%;
`

const scaledSurfaceCss = css`
  transform-origin: top left;
`

const editorCss = css`
  min-height: 100%;
  outline: none;
  color: #111827;
  font: 400 16px/24px ${PAGE_TEXT_FONT};
`

const pageCss = css`
  position: relative;
  box-sizing: border-box;
  background: white;
  border: 1px solid #e5e7eb;
  box-shadow: 0 2px 12px rgba(15, 23, 42, 0.12);
`

const pageDebugCss = css`
  background-image:
    linear-gradient(rgba(59, 130, 246, 0.16) 1px, transparent 1px),
    linear-gradient(90deg, rgba(59, 130, 246, 0.16) 1px, transparent 1px);
  background-size: 24px 24px;
`

const contentFrameCss = css`
  position: absolute;
  box-sizing: border-box;
  outline: 1px dashed rgba(59, 130, 246, 0.5);
  background: rgba(59, 130, 246, 0.04);
  pointer-events: none;
`

const pageLabelCss = css`
  position: absolute;
  right: 8px;
  bottom: 6px;
  color: #6b7280;
  font: 11px ui-monospace, SFMono-Regular, Menlo, monospace;
  pointer-events: none;
`

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
    children: [
      {
        type: 'table-row',
        children: [
          { type: 'table-cell', children: [{ text: 'Markdown' }] },
          { type: 'table-cell', children: [{ text: 'Slate node' }] },
          { type: 'table-cell', children: [{ text: 'Paged' }] },
        ],
      },
      {
        type: 'table-row',
        children: [
          { type: 'table-cell', children: [{ text: 'GFM table' }] },
          { type: 'table-cell', children: [{ text: 'table' }] },
          { type: 'table-cell', children: [{ text: 'inside frame' }] },
        ],
      },
    ],
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
  const layout = useSlateLayout(editor, {
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
  const elementBoxes = useMemo(
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
            threshold: 200,
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
    ({ attributes, children, element }: RenderElementProps) => {
      const box = elementBoxes.get(attributes['data-slate-path'])
      const elementType = element.type

      if (!box) {
        if (elementType === 'table-row') {
          return (
            <div {...attributes} style={{ display: 'table-row' }}>
              {children}
            </div>
          )
        }

        if (elementType === 'table-cell') {
          return (
            <div
              {...attributes}
              data-testid="pagination-rich-table-cell"
              style={{
                border: '1px solid #cbd5e1',
                display: 'table-cell',
                fontSize: 13,
                lineHeight: '18px',
                padding: '5px 8px',
                verticalAlign: 'top',
              }}
            >
              {children}
            </div>
          )
        }

        return <div {...attributes}>{children}</div>
      }

      const flowElement = isFlowProjectedType(elementType)
      const projectedStyle: CSSProperties = {
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
      }

      if (elementType === 'table') {
        return (
          <div
            {...attributes}
            data-testid="pagination-rich-table"
            style={{
              ...projectedStyle,
              borderCollapse: 'collapse',
              display: 'table',
              tableLayout: 'fixed',
            }}
          >
            {children}
          </div>
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
    },
    [debugFrames, elementBoxes, usesVirtualizedLayout]
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
    <div className={shellCss}>
      <div className={toolbarCss}>
        <div className={toolbarGroupCss}>
          <label className={labelCss}>
            Preset
            <select
              className={inputCss}
              onChange={updatePreset}
              value={settings.preset}
            >
              <option value="a4">A4</option>
              <option value="letter">Letter</option>
            </select>
          </label>
          <label className={labelCss}>
            Margins
            <input
              className={inputCss}
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
          </label>
          <label className={labelCss}>
            DOM strategy
            <select
              className={inputCss}
              onChange={updateDOMStrategy}
              value={domStrategyMode}
            >
              <option value="staged">Staged</option>
              <option value="full">Full</option>
              <option value="virtualized">Virtualized</option>
            </select>
          </label>
        </div>
        <div className={toolbarGroupCss}>
          <span className={toolbarSeparatorCss} />
          <span className={switchGroupCss}>
            Facing
            <button
              aria-checked={pageLayoutMode === 'spread'}
              aria-label="Facing"
              className={switchCss}
              onClick={togglePageLayoutMode}
              role="switch"
              type="button"
            >
              <span className={switchThumbCss} />
            </button>
          </span>
          <span className={toolbarSeparatorCss} />
          <span className={switchGroupCss}>
            Debug
            <button
              aria-checked={debugFrames}
              aria-label="Debug"
              className={switchCss}
              onClick={() => setDebugFrames((value) => !value)}
              role="switch"
              type="button"
            >
              <span className={switchThumbCss} />
            </button>
          </span>
        </div>
      </div>
      <div className={titleRowCss}>
        <div className={titleCss}>Untitled document</div>
        <div className={metaCss}>
          pages {snapshot.pages.length} | blocks {metrics.blockCount} | compose{' '}
          {metrics.lastDurationMs.toFixed(1)}ms
        </div>
      </div>
      <div
        className={viewportCss}
        data-testid="pagination-viewport"
        ref={viewportRef}
      >
        <div className={viewportInnerCss}>
          <div
            style={{
              height: pageGeometry.height * pageScale,
              width: pageGeometry.width * pageScale,
            }}
          >
            <div
              className={scaledSurfaceCss}
              style={{
                transform: `scale(${pageScale})`,
                width: pageGeometry.width,
              }}
            >
              <PagedEditable
                className={editorCss}
                decorate={decorate}
                domStrategy={domStrategy}
                layout={layout}
                onDOMStrategyMetrics={setDOMStrategyMetrics}
                pageGap={PAGE_GAP}
                pageLayoutMode={pageLayoutMode}
                renderElement={renderElement}
                renderLeaf={renderLeaf}
                renderPage={({ attributes, page }) => (
                  <div
                    {...attributes}
                    className={`${pageCss} ${debugFrames ? pageDebugCss : ''}`}
                    style={{
                      height: page.height,
                      overflow: 'hidden',
                      width: page.width,
                    }}
                  >
                    {debugFrames ? (
                      <>
                        <div
                          className={contentFrameCss}
                          data-testid="pagination-content-frame"
                          style={{
                            height: page.content.height,
                            left: page.content.left,
                            top: page.content.top,
                            width: page.content.width,
                          }}
                        />
                        <div className={pageLabelCss}>
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
