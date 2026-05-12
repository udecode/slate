import {
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createEditor, type EditorSnapshot, type Value } from 'slate'
import type { DOMClipboardInsertDataHandler } from 'slate-dom'
import { withHistory } from 'slate-history'
import {
  Editable,
  type EditableProps,
  type ReactEditor,
  Slate,
  type SlateDecorationSource,
  type SlateProjection,
  useSlateDecorationSource,
  withReact,
} from 'slate-react'

const renderingStrategyOptions = {
  overscan: 0,
  type: 'shell',
  segmentSize: 2,
  previewChars: 48,
  threshold: 1,
} as const

const editorStyle = {
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  minHeight: 80,
  padding: 12,
} satisfies CSSProperties

const virtualizedEditorStyle = {
  ...editorStyle,
  height: 360,
  overflowY: 'auto',
} satisfies CSSProperties

const virtualizedControlsStyle = {
  alignItems: 'end',
  display: 'grid',
  gap: 12,
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  marginBottom: 8,
} satisfies CSSProperties

const virtualizedLabelStyle = {
  display: 'grid',
  gap: 4,
} satisfies CSSProperties

const virtualizedInputStyle = {
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  font: 'inherit',
  padding: '6px 8px',
} satisfies CSSProperties

const virtualizedButtonRowStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
} satisfies CSSProperties

const virtualizedButtonStyle = {
  border: '1px solid #94a3b8',
  borderRadius: 4,
  cursor: 'pointer',
  font: 'inherit',
  padding: '6px 10px',
} satisfies CSSProperties

const virtualizedSummaryStyle = {
  display: 'grid',
  gap: 8,
  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
} satisfies CSSProperties

const virtualizedMetricStyle = {
  border: '1px solid #e2e8f0',
  borderRadius: 4,
  padding: 8,
} satisfies CSSProperties

const virtualizedBadgeStyle = {
  background: '#fef3c7',
  border: '1px solid #f59e0b',
  borderRadius: 4,
  color: '#92400e',
  display: 'inline-block',
  fontSize: 13,
  fontWeight: 700,
  padding: '4px 8px',
} satisfies CSSProperties

const sectionStyle = {
  display: 'grid',
  gap: 8,
  marginBottom: 24,
} satisfies CSSProperties

const createBlocks = (prefix: string): Value =>
  Array.from({ length: 6 }, (_, index) => ({
    type: 'paragraph',
    children: [{ text: `${prefix} block ${index + 1}` }],
  }))

const createSizedBlocks = (prefix: string, blocks: number): Value =>
  Array.from({ length: blocks }, (_, index) => ({
    type: 'paragraph',
    children: [{ text: `${prefix} block ${index + 1}` }],
  }))

const getVirtualizedMetricSnapshot = (metrics: Record<string, unknown>) => ({
  boundaryCount: metrics.viewportVirtualizationBoundaryCount,
  degradationMode: metrics.degradationMode,
  documentSize: metrics.documentSize,
  domNodeCount: metrics.domNodeCount,
  effectiveStrategy: metrics.effectiveStrategy,
  mountedTopLevelCount: metrics.mountedTopLevelCount,
  virtualizerMeasuredCount: metrics.virtualizerMeasuredCount,
})

const clampInteger = (
  value: number,
  {
    fallback,
    max,
    min,
  }: {
    fallback: number
    max: number
    min: number
  }
) => {
  if (!Number.isFinite(value)) {
    return fallback
  }

  return Math.min(max, Math.max(min, Math.round(value)))
}

const getRuntimeSearchParams = () =>
  typeof document === 'undefined'
    ? new URLSearchParams()
    : new URLSearchParams(document.location.search)

const createRuntimeEditor = (children: Value) => {
  return withHistory(withReact(createEditor({ initialValue: children })))
}

const createMixedBlocks = (): Value =>
  [
    {
      type: 'paragraph',
      children: [
        { text: 'mixed inline ' },
        {
          type: 'runtime-link',
          url: 'https://example.com',
          children: [{ text: 'link' }],
        },
        { text: ' block 1' },
      ],
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `mixed block ${index + 2}` }],
    })),
  ] as Value

const createVoidBlocks = (): Value =>
  [
    {
      type: 'runtime-void',
      children: [{ text: '' }],
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `void block ${index + 2}` }],
    })),
  ] as Value

const createTableBlocks = (): Value =>
  [
    {
      type: 'runtime-table',
      children: [
        {
          type: 'runtime-table-row',
          children: [
            {
              type: 'runtime-table-cell',
              children: [{ text: 'table cell 1' }],
            },
            {
              type: 'runtime-table-cell',
              children: [{ text: 'table cell 2' }],
            },
          ],
        },
      ],
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `table block ${index + 2}` }],
    })),
  ] as Value

const withMixedRuntime = (editor: ReturnType<typeof createRuntimeEditor>) => {
  editor.extend({
    name: 'rendering-strategy-runtime',
    elements: [
      { inline: true, type: 'runtime-link' },
      { type: 'runtime-void', void: 'block' },
    ],
  })

  return editor
}

const withRuntimeHtml = (editor: ReturnType<typeof createRuntimeEditor>) => {
  const insertData: DOMClipboardInsertDataHandler = (_domEditor, data) =>
    insertRuntimeHtmlData(editor, data)

  editor.extend({
    capabilities: {
      'dom.clipboard.insertData': insertData,
    },
    name: 'rendering-strategy-runtime-html',
  })

  return editor
}

const insertRuntimeHtmlData = (editor: ReactEditor, data: DataTransfer) => {
  const html = data.getData('text/html')

  if (!html) {
    return false
  }

  const document = new DOMParser().parseFromString(html, 'text/html')
  const text = document.body.textContent ?? ''
  const isBold = !!document.body.querySelector('strong,b')

  editor.update((tx) => {
    tx.fragment.insert([
      {
        type: 'paragraph',
        children: [
          isBold
            ? {
                bold: true,
                text,
              }
            : { text },
        ],
      },
    ])
  })
  return true
}

const collectProjectionProbes = (
  snapshot: EditorSnapshot
): SlateProjection<{ source: string }>[] => {
  const firstBlock = snapshot.children[0]

  if (
    !firstBlock ||
    !('children' in firstBlock) ||
    !firstBlock.children[0] ||
    !('text' in firstBlock.children[0])
  ) {
    return []
  }

  return [
    {
      data: { source: 'projection' },
      key: 'runtime-projection',
      range: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 10 },
      },
    },
  ]
}

const renderCustomText = ({
  attributes,
  children,
}: NonNullable<ComponentProps<typeof Editable>['renderText']> extends (
  props: infer TProps
) => unknown
  ? TProps
  : never) => (
  <span {...attributes} data-runtime-custom-text="true">
    {children}
  </span>
)

const renderCustomLeaf = ({
  attributes,
  children,
  leaf,
}: NonNullable<ComponentProps<typeof Editable>['renderLeaf']> extends (
  props: infer TProps
) => unknown
  ? TProps
  : never) => (
  <span
    {...attributes}
    data-runtime-bold={(leaf as { bold?: boolean }).bold ? 'true' : undefined}
    data-runtime-custom-leaf="true"
  >
    {children}
  </span>
)

const renderMixedElement = ({
  attributes,
  children,
  element,
}: {
  attributes: Record<string, any>
  children: ReactNode
  element: { type?: string; url?: string }
}) => {
  switch ((element as { type?: string }).type) {
    case 'runtime-link':
      return (
        <a {...attributes} data-runtime-inline="true" href={element.url}>
          {children}
        </a>
      )
    case 'runtime-table':
      return (
        <table data-runtime-table="true">
          <tbody {...attributes}>{children}</tbody>
        </table>
      )
    case 'runtime-table-row':
      return <tr {...attributes}>{children}</tr>
    case 'runtime-table-cell':
      return <td {...attributes}>{children}</td>
    default:
      return <p {...attributes}>{children}</p>
  }
}

const renderMixedVoid = ({
  element,
}: {
  element: { type?: string; url?: string }
}) => {
  switch (element.type) {
    case 'runtime-void':
      return (
        <div data-runtime-void="true">
          <span>void card</span>
        </div>
      )
    default:
      return null
  }
}

type RuntimeEditableProps = EditableProps & {
  decorationSources?: readonly SlateDecorationSource[]
  editor: ReactEditor
}

const RuntimeEditable = ({
  decorationSources,
  editor,
  ...props
}: RuntimeEditableProps) => (
  <Slate decorationSources={decorationSources} editor={editor}>
    <Editable {...props} />
  </Slate>
)

const ShadowRuntimeEditor = () => {
  const [editor] = useState(() => createRuntimeEditor(createBlocks('shadow')))

  return (
    <RuntimeEditable
      editor={editor}
      id="rendering-strategy-runtime-shadow"
      renderingStrategy={renderingStrategyOptions}
      style={editorStyle}
    />
  )
}

const ShadowRuntimeHost = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<Root | null>(null)

  useEffect(() => {
    const container = containerRef.current

    if (!container || rootRef.current) {
      return
    }

    const shadowRoot = container.attachShadow({ mode: 'open' })
    const mount = document.createElement('div')
    shadowRoot.appendChild(mount)
    rootRef.current = createRoot(mount)
    rootRef.current.render(<ShadowRuntimeEditor />)

    return () => {
      rootRef.current?.unmount()
      rootRef.current = null
    }
  }, [])

  return <div data-runtime-shadow-host="true" ref={containerRef} />
}

const DomPresentNativeInputRuntime = () => {
  const searchParams = getRuntimeSearchParams()
  const blocks = Number.parseInt(searchParams.get('blocks') ?? '', 10) || 1200
  const [editor] = useState(() =>
    createRuntimeEditor(createSizedBlocks('dom-native', blocks))
  )

  return (
    <div style={{ padding: 24 }}>
      <section data-runtime-editor="staged-native" style={sectionStyle}>
        <h2>Rendering Strategy Staged Native Input</h2>
        <RuntimeEditable
          editor={editor}
          id="rendering-strategy-runtime-staged-native"
          renderingStrategy="staged"
          style={editorStyle}
        />
      </section>
    </div>
  )
}

export const VirtualizedFullRuntime = () => {
  const searchParams = getRuntimeSearchParams()
  const initialBlocks = clampInteger(
    Number.parseInt(searchParams.get('blocks') ?? '', 10),
    {
      fallback: 1000,
      max: 20_000,
      min: 100,
    }
  )
  const initialEstimatedBlockSize = clampInteger(
    Number.parseInt(searchParams.get('estimatedBlockSize') ?? '', 10),
    {
      fallback: 32,
      max: 160,
      min: 16,
    }
  )
  const initialOverscan = clampInteger(
    Number.parseInt(searchParams.get('overscan') ?? '', 10),
    {
      fallback: 4,
      max: 40,
      min: 0,
    }
  )
  const initialHeight = clampInteger(
    Number.parseInt(searchParams.get('height') ?? '', 10),
    {
      fallback: 360,
      max: 900,
      min: 220,
    }
  )
  const [appliedBlockCount, setAppliedBlockCount] = useState(initialBlocks)
  const [blockCount, setBlockCount] = useState(initialBlocks)
  const [editorHeight, setEditorHeight] = useState(initialHeight)
  const [estimatedBlockSize, setEstimatedBlockSize] = useState(
    initialEstimatedBlockSize
  )
  const [metrics, setMetrics] = useState<Record<string, unknown> | null>(null)
  const [overscan, setOverscan] = useState(initialOverscan)
  const [editor] = useState(() =>
    createRuntimeEditor(createSizedBlocks('virtualized', initialBlocks))
  )
  const metricsSignatureRef = useRef<string | null>(null)
  const virtualizedRootRef = useRef<HTMLDivElement>(null)
  const renderingStrategy = useMemo(
    () =>
      ({
        estimatedBlockSize,
        overscan,
        type: 'virtualized',
        threshold: 1,
      }) as const,
    [estimatedBlockSize, overscan]
  )
  const editableStyle = useMemo(
    () => ({
      ...virtualizedEditorStyle,
      height: editorHeight,
    }),
    [editorHeight]
  )
  const metricEntries: [label: string, value: unknown][] = [
    ['Blocks', metrics?.documentSize ?? appliedBlockCount],
    ['Mounted', metrics?.mountedTopLevelCount ?? 'pending'],
    ['Pending', metrics?.pendingTopLevelCount ?? 'pending'],
    ['Boundaries', metrics?.viewportVirtualizationBoundaryCount ?? 'pending'],
    ['Measured', metrics?.virtualizerMeasuredCount ?? 'pending'],
    ['Strategy', metrics?.effectiveStrategy ?? 'pending'],
  ]
  const replaceBlocks = (nextBlockCount: number) => {
    const normalizedBlockCount = clampInteger(nextBlockCount, {
      fallback: appliedBlockCount,
      max: 20_000,
      min: 100,
    })

    editor.update((tx) => {
      tx.value.replace({
        children: createSizedBlocks('virtualized', normalizedBlockCount),
        selection: null,
      })
    })
    setAppliedBlockCount(normalizedBlockCount)
    setBlockCount(normalizedBlockCount)
    metricsSignatureRef.current = null
    setMetrics(null)
  }
  const handleRenderingStrategyMetrics = (
    nextMetrics: Record<string, unknown>
  ) => {
    const signature = JSON.stringify(getVirtualizedMetricSnapshot(nextMetrics))

    if (metricsSignatureRef.current === signature) {
      return
    }

    metricsSignatureRef.current = signature
    setMetrics(nextMetrics)
  }
  const scrollEditor = (position: 'end' | 'start') => {
    const editorElement = virtualizedRootRef.current?.querySelector(
      '[data-slate-editor="true"]'
    )

    if (!(editorElement instanceof HTMLElement)) {
      return
    }

    editorElement.scrollTo({
      top: position === 'end' ? editorElement.scrollHeight : 0,
      behavior: 'smooth',
    })
    editorElement.dispatchEvent(new Event('scroll', { bubbles: true }))
  }

  return (
    <div ref={virtualizedRootRef} style={{ padding: 24 }}>
      <section data-runtime-editor="virtualized-full" style={sectionStyle}>
        <h2>Experimental Virtualized Rendering</h2>
        <div style={virtualizedBadgeStyle}>
          Experimental. Not production-ready.
        </div>
        <form
          data-runtime-virtualized-controls="true"
          onSubmit={(event) => {
            event.preventDefault()
            replaceBlocks(blockCount)
          }}
          style={virtualizedControlsStyle}
        >
          <label style={virtualizedLabelStyle}>
            Blocks
            <input
              aria-label="Blocks"
              max={20_000}
              min={100}
              onChange={(event) =>
                setBlockCount(
                  clampInteger(Number.parseInt(event.currentTarget.value, 10), {
                    fallback: appliedBlockCount,
                    max: 20_000,
                    min: 100,
                  })
                )
              }
              step={100}
              style={virtualizedInputStyle}
              type="number"
              value={blockCount}
            />
          </label>
          <label style={virtualizedLabelStyle}>
            Overscan
            <input
              aria-label="Overscan"
              max={40}
              min={0}
              onChange={(event) =>
                setOverscan(
                  clampInteger(Number.parseInt(event.currentTarget.value, 10), {
                    fallback: initialOverscan,
                    max: 40,
                    min: 0,
                  })
                )
              }
              style={virtualizedInputStyle}
              type="number"
              value={overscan}
            />
          </label>
          <label style={virtualizedLabelStyle}>
            Estimated block height
            <input
              aria-label="Estimated block height"
              max={160}
              min={16}
              onChange={(event) =>
                setEstimatedBlockSize(
                  clampInteger(Number.parseInt(event.currentTarget.value, 10), {
                    fallback: initialEstimatedBlockSize,
                    max: 160,
                    min: 16,
                  })
                )
              }
              style={virtualizedInputStyle}
              type="number"
              value={estimatedBlockSize}
            />
          </label>
          <label style={virtualizedLabelStyle}>
            Editor height
            <input
              aria-label="Editor height"
              max={900}
              min={220}
              onChange={(event) =>
                setEditorHeight(
                  clampInteger(Number.parseInt(event.currentTarget.value, 10), {
                    fallback: initialHeight,
                    max: 900,
                    min: 220,
                  })
                )
              }
              step={20}
              style={virtualizedInputStyle}
              type="number"
              value={editorHeight}
            />
          </label>
          <div style={virtualizedButtonRowStyle}>
            <button style={virtualizedButtonStyle} type="submit">
              Apply blocks
            </button>
            {[1000, 5000, 10_000].map((preset) => (
              <button
                key={preset}
                onClick={() => replaceBlocks(preset)}
                style={virtualizedButtonStyle}
                type="button"
              >
                {preset.toLocaleString()} blocks
              </button>
            ))}
            <button
              onClick={() => scrollEditor('start')}
              style={virtualizedButtonStyle}
              type="button"
            >
              Top
            </button>
            <button
              onClick={() => scrollEditor('end')}
              style={virtualizedButtonStyle}
              type="button"
            >
              End
            </button>
          </div>
        </form>
        <RuntimeEditable
          editor={editor}
          id="rendering-strategy-runtime-virtualized-full"
          onRenderingStrategyMetrics={handleRenderingStrategyMetrics}
          renderingStrategy={renderingStrategy}
          style={editableStyle}
        />
        <div
          data-runtime-virtualized-summary="true"
          style={virtualizedSummaryStyle}
        >
          {metricEntries.map(([label, value]) => (
            <div key={label} style={virtualizedMetricStyle}>
              <strong>{label}</strong>
              <div>{String(value)}</div>
            </div>
          ))}
        </div>
        <pre data-runtime-virtualized-metrics="true">
          {metrics
            ? JSON.stringify(getVirtualizedMetricSnapshot(metrics), null, 2)
            : 'Collecting metrics...'}
        </pre>
      </section>
    </div>
  )
}

const DefaultRenderingStrategyRuntime = () => {
  const [defaultEditor] = useState(() =>
    createRuntimeEditor(createBlocks('default'))
  )
  const [customEditor] = useState(() =>
    createRuntimeEditor(createBlocks('custom'))
  )
  const [leafEditor] = useState(() => createRuntimeEditor(createBlocks('leaf')))
  const [richEditor] = useState(() =>
    withRuntimeHtml(createRuntimeEditor(createBlocks('rich')))
  )
  const [mixedEditor] = useState(() =>
    withMixedRuntime(createRuntimeEditor(createMixedBlocks()))
  )
  const [voidEditor] = useState(() =>
    withMixedRuntime(createRuntimeEditor(createVoidBlocks()))
  )
  const [tableEditor] = useState(() =>
    withMixedRuntime(createRuntimeEditor(createTableBlocks()))
  )
  const [projectionEditor] = useState(() =>
    createRuntimeEditor(createBlocks('projection'))
  )

  const projectionSource = useSlateDecorationSource(projectionEditor, {
    id: 'rendering-strategy-runtime-projection',
    read: ({ snapshot }) => collectProjectionProbes(snapshot),
  })

  return (
    <div style={{ padding: 24 }}>
      <section data-runtime-editor="default" style={sectionStyle}>
        <h2>Rendering Strategy Runtime Default</h2>
        <RuntimeEditable
          editor={defaultEditor}
          id="rendering-strategy-runtime-default"
          renderingStrategy={renderingStrategyOptions}
          style={editorStyle}
        />
      </section>

      <section data-runtime-editor="custom" style={sectionStyle}>
        <h2>Rendering Strategy Runtime Custom Text</h2>
        <RuntimeEditable
          editor={customEditor}
          id="rendering-strategy-runtime-custom"
          renderingStrategy={renderingStrategyOptions}
          renderText={renderCustomText}
          style={editorStyle}
        />
      </section>

      <section data-runtime-editor="leaf" style={sectionStyle}>
        <h2>Rendering Strategy Runtime Custom Leaf</h2>
        <RuntimeEditable
          editor={leafEditor}
          id="rendering-strategy-runtime-leaf"
          renderingStrategy={renderingStrategyOptions}
          renderLeaf={renderCustomLeaf}
          style={editorStyle}
        />
      </section>

      <section data-runtime-editor="rich" style={sectionStyle}>
        <h2>Rendering Strategy Runtime Rich Paste</h2>
        <RuntimeEditable
          editor={richEditor}
          id="rendering-strategy-runtime-rich"
          renderingStrategy={renderingStrategyOptions}
          renderLeaf={renderCustomLeaf}
          style={editorStyle}
        />
      </section>

      <section data-runtime-editor="mixed" style={sectionStyle}>
        <h2>Rendering Strategy Runtime Mixed Nodes</h2>
        <RuntimeEditable
          editor={mixedEditor}
          id="rendering-strategy-runtime-mixed"
          renderElement={renderMixedElement}
          renderingStrategy={renderingStrategyOptions}
          renderVoid={renderMixedVoid}
          style={editorStyle}
        />
      </section>

      <section data-runtime-editor="void" style={sectionStyle}>
        <h2>Rendering Strategy Runtime Void</h2>
        <RuntimeEditable
          editor={voidEditor}
          id="rendering-strategy-runtime-void"
          renderElement={renderMixedElement}
          renderingStrategy={renderingStrategyOptions}
          renderVoid={renderMixedVoid}
          style={editorStyle}
        />
      </section>

      <section data-runtime-editor="table" style={sectionStyle}>
        <h2>Rendering Strategy Runtime Table</h2>
        <RuntimeEditable
          editor={tableEditor}
          id="rendering-strategy-runtime-table"
          renderElement={renderMixedElement}
          renderingStrategy={renderingStrategyOptions}
          style={editorStyle}
        />
      </section>

      <section data-runtime-editor="shadow" style={sectionStyle}>
        <h2>Rendering Strategy Runtime Shadow DOM</h2>
        <ShadowRuntimeHost />
      </section>

      <section data-runtime-editor="projection" style={sectionStyle}>
        <h2>Rendering Strategy Runtime Projection</h2>
        <RuntimeEditable
          decorationSources={[projectionSource]}
          editor={projectionEditor}
          id="rendering-strategy-runtime-projection"
          renderingStrategy={renderingStrategyOptions}
          renderSegment={(segment, children) =>
            segment.slices.length > 0 ? (
              <span data-runtime-projection="true">{children}</span>
            ) : (
              children
            )
          }
          style={editorStyle}
        />
      </section>
    </div>
  )
}

const RenderingStrategyRuntimeExample = () => {
  const runtimeMode = getRuntimeSearchParams().get('runtime_mode')

  if (runtimeMode === 'staged-native-input') {
    return <DomPresentNativeInputRuntime />
  }

  if (runtimeMode === 'virtualized-full') {
    return <VirtualizedFullRuntime />
  }

  return <DefaultRenderingStrategyRuntime />
}

export default RenderingStrategyRuntimeExample
