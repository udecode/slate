import { faker } from '@faker-js/faker'
import React, {
  type CSSProperties,
  type Dispatch,
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { Editor, Value } from 'slate'
import {
  createReactEditor,
  Editable,
  type EditableProps,
  type EditableRenderingStrategyMetrics,
  type RenderElementProps,
  Slate,
  useElementSelected,
} from 'slate-react'

import type { HeadingElement, ParagraphElement } from './custom-types.d'

const SUPPORTS_EVENT_TIMING =
  typeof window !== 'undefined' && 'PerformanceEventTiming' in window

const SUPPORTS_LOAF_TIMING =
  typeof window !== 'undefined' &&
  'PerformanceLongAnimationFrameTiming' in window

interface Config {
  blocks: number
  contentVisibilityMode: 'none' | 'element'
  editorHeight: number
  renderingStrategyMode: 'auto' | 'full' | 'staged' | 'shell' | 'virtualized'
  renderingStrategyOverscan: number
  renderingStrategyPreviewChars: number
  renderingStrategySegmentSize: number
  renderingStrategyThreshold: number
  showSelectedHeadings: boolean
  strictMode: boolean
  virtualizedEstimatedBlockSize: number
}

type RenderConfig = {
  contentVisibility: boolean
  showSelectedHeadings: boolean
}

const RenderConfigContext = React.createContext<RenderConfig>({
  contentVisibility: false,
  showSelectedHeadings: false,
})

const blocksOptions = [
  2, 1000, 2500, 5000, 7500, 10_000, 15_000, 20_000, 25_000, 30_000, 40_000,
  50_000, 100_000, 200_000,
]

const searchParams =
  typeof document === 'undefined'
    ? null
    : new URLSearchParams(document.location.search)

const parseNumber = (key: string, defaultValue: number) => {
  const parsed = Number.parseInt(searchParams?.get(key) ?? '', 10)
  return Number.isFinite(parsed) ? parsed : defaultValue
}

const parseBoolean = (key: string, defaultValue: boolean) => {
  const value = searchParams?.get(key)
  if (value) return value === 'true'
  return defaultValue
}

const parseEnum = <T extends string>(
  key: string,
  options: T[],
  defaultValue: T
): T => {
  const value = searchParams?.get(key) as T | null | undefined
  if (value && options.includes(value)) return value
  return defaultValue
}

const toContentVisibilityMode = (
  value: string
): Config['contentVisibilityMode'] => (value === 'element' ? 'element' : 'none')

const initialConfig: Config = {
  blocks: parseNumber('blocks', 10_000),
  contentVisibilityMode: parseEnum(
    'content_visibility',
    ['none', 'element'],
    'element'
  ),
  editorHeight: parseNumber('editor_height', 420),
  renderingStrategyMode: parseEnum(
    'strategy',
    ['auto', 'full', 'staged', 'shell', 'virtualized'],
    'auto'
  ),
  renderingStrategyOverscan: parseNumber('overscan', 0),
  renderingStrategyPreviewChars: parseNumber('preview_chars', 96),
  renderingStrategySegmentSize: parseNumber('segment_size', 100),
  renderingStrategyThreshold: parseNumber('threshold', 2000),
  showSelectedHeadings: parseBoolean('selected_headings', false),
  strictMode: parseBoolean('strict', false),
  virtualizedEstimatedBlockSize: parseNumber('estimated_block_size', 48),
}

const setSearchParams = (config: Config) => {
  if (searchParams) {
    searchParams.set('blocks', config.blocks.toString())
    searchParams.set('content_visibility', config.contentVisibilityMode)
    searchParams.set('editor_height', config.editorHeight.toString())
    searchParams.set('strategy', config.renderingStrategyMode)
    searchParams.set('overscan', config.renderingStrategyOverscan.toString())
    searchParams.set(
      'preview_chars',
      config.renderingStrategyPreviewChars.toString()
    )
    searchParams.set(
      'segment_size',
      config.renderingStrategySegmentSize.toString()
    )
    searchParams.set('threshold', config.renderingStrategyThreshold.toString())
    searchParams.set(
      'selected_headings',
      config.showSelectedHeadings ? 'true' : 'false'
    )
    searchParams.set('strict', config.strictMode ? 'true' : 'false')
    searchParams.set(
      'estimated_block_size',
      config.virtualizedEstimatedBlockSize.toString()
    )
    history.replaceState({}, '', `?${searchParams.toString()}`)
  }
}

const cachedInitialValue: Value = []

const getInitialValue = (blocks: number) => {
  if (cachedInitialValue.length >= blocks) {
    return cachedInitialValue.slice(0, blocks)
  }

  faker.seed(1)

  for (let i = cachedInitialValue.length; i < blocks; i++) {
    if (i % 100 === 0) {
      const heading: HeadingElement = {
        type: 'heading-one',
        children: [{ text: faker.lorem.sentence() }],
      }
      cachedInitialValue.push(heading)
    } else {
      const paragraph: ParagraphElement = {
        type: 'paragraph',
        children: [{ text: faker.lorem.paragraph() }],
      }
      cachedInitialValue.push(paragraph)
    }
  }

  return cachedInitialValue.slice()
}

const fallbackInitialValue: Value = [
  {
    type: 'paragraph',
    children: [{ text: '' }],
  },
]

const initialInitialValue: Value =
  typeof window === 'undefined'
    ? fallbackInitialValue
    : getInitialValue(initialConfig.blocks)

const createEditor = (_config: Config, initialValue: Value) =>
  createReactEditor({ initialValue })

const toRenderingStrategy = (
  config: Config
): EditableProps['renderingStrategy'] => {
  switch (config.renderingStrategyMode) {
    case 'full':
    case 'staged':
    case 'auto':
      return config.renderingStrategyMode
    case 'shell':
      return {
        overscan: config.renderingStrategyOverscan,
        previewChars: config.renderingStrategyPreviewChars,
        segmentSize: config.renderingStrategySegmentSize,
        threshold: config.renderingStrategyThreshold,
        type: 'shell',
      }
    case 'virtualized':
      return {
        estimatedBlockSize: config.virtualizedEstimatedBlockSize,
        overscan: config.renderingStrategyOverscan,
        threshold: config.renderingStrategyThreshold,
        type: 'virtualized',
      }
  }
}

const toVirtualizedEditableStyle = (
  config: Config
): CSSProperties | undefined =>
  config.renderingStrategyMode === 'virtualized'
    ? {
        border: '1px solid #ddd',
        height: config.editorHeight,
        overflowY: 'auto',
        padding: 12,
      }
    : undefined

const formatMetric = (value: boolean | number | string | null | undefined) =>
  value ?? '-'

const HugeDocumentExample = () => {
  const [rendering, setRendering] = useState(false)
  const [config, baseSetConfig] = useState<Config>(initialConfig)
  const [editor, setEditor] = useState(() =>
    createEditor(config, initialInitialValue)
  )
  const [editorVersion, setEditorVersion] = useState(0)
  const [renderingStrategyMetrics, setRenderingStrategyMetrics] =
    useState<EditableRenderingStrategyMetrics | null>(null)

  const setConfig = useCallback(
    (partialConfig: Partial<Config>) => {
      const newConfig = { ...config, ...partialConfig }

      setRendering(true)
      setRenderingStrategyMetrics(null)
      baseSetConfig(newConfig)
      setSearchParams(newConfig)

      setTimeout(() => {
        const nextInitialValue = getInitialValue(newConfig.blocks)

        setRendering(false)
        setEditor(createEditor(newConfig, nextInitialValue))
        setEditorVersion((n) => n + 1)
      })
    },
    [config]
  )

  const renderingStrategy = useMemo(() => toRenderingStrategy(config), [config])

  const editableStyle = useMemo(
    () => toVirtualizedEditableStyle(config),
    [config]
  )

  const renderConfig = useMemo(
    () => ({
      contentVisibility: config.contentVisibilityMode === 'element',
      showSelectedHeadings: config.showSelectedHeadings,
    }),
    [config.contentVisibilityMode, config.showSelectedHeadings]
  )

  const editable = rendering ? (
    <div>Rendering&hellip;</div>
  ) : (
    <RenderConfigContext.Provider value={renderConfig}>
      <Slate editor={editor} key={editorVersion}>
        <Editable
          autoFocus
          id="huge-document-editor"
          onRenderingStrategyMetrics={setRenderingStrategyMetrics}
          placeholder="Enter some text…"
          renderElement={Element}
          renderingStrategy={renderingStrategy}
          spellCheck
          style={editableStyle}
        />
      </Slate>
    </RenderConfigContext.Provider>
  )

  const editableWithStrictMode = config.strictMode ? (
    <StrictMode>{editable}</StrictMode>
  ) : (
    editable
  )

  return (
    <>
      <PerformanceControls
        config={config}
        editor={editor}
        renderingStrategyMetrics={renderingStrategyMetrics}
        setConfig={setConfig}
      />

      {editableWithStrictMode}
    </>
  )
}

const Heading = ({
  style: styleProp,
  showSelectedHeadings = false,
  ref,
  ...props
}: React.ComponentProps<'h1'> & {
  showSelectedHeadings: boolean
  ref?: React.Ref<HTMLHeadingElement>
}) => {
  // Fine since the editor is remounted if the config changes
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const selected = showSelectedHeadings ? useElementSelected() : false
  const style = { ...styleProp, color: selected ? 'green' : undefined }
  return <h1 ref={ref} {...props} aria-selected={selected} style={style} />
}

const Paragraph = 'p'

const Element = ({ attributes, children, element }: RenderElementProps) => {
  const { contentVisibility, showSelectedHeadings } =
    React.useContext(RenderConfigContext)
  const style = {
    contentVisibility: contentVisibility ? 'auto' : undefined,
  } satisfies CSSProperties

  switch (element.type) {
    case 'heading-one':
      return (
        <Heading
          {...attributes}
          showSelectedHeadings={showSelectedHeadings}
          style={style}
        >
          {children}
        </Heading>
      )
    default:
      return (
        <Paragraph {...attributes} style={style}>
          {children}
        </Paragraph>
      )
  }
}

const PerformanceControls = ({
  editor,
  config,
  renderingStrategyMetrics,
  setConfig,
}: {
  editor: Editor
  config: Config
  renderingStrategyMetrics: EditableRenderingStrategyMetrics | null
  setConfig: Dispatch<Partial<Config>>
}) => {
  const [configurationOpen, setConfigurationOpen] = useState(true)
  const [keyPressDurations, setKeyPressDurations] = useState<number[]>([])
  const [lastLongAnimationFrameDuration, setLastLongAnimationFrameDuration] =
    useState<number | null>(null)

  const lastKeyPressDuration: number | null = keyPressDurations[0] ?? null

  const averageKeyPressDuration =
    keyPressDurations.length === 10
      ? Math.round(keyPressDurations.reduce((total, d) => total + d) / 10)
      : null

  useEffect(() => {
    if (!SUPPORTS_EVENT_TIMING) return

    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        if (entry.name === 'keypress') {
          const duration = Math.round(
            // @ts-expect-error Entry type is missing processingStart and processingEnd
            entry.processingEnd - entry.processingStart
          )
          setKeyPressDurations((durations) => [
            duration,
            ...durations.slice(0, 9),
          ])
        }
      })
    })

    // @ts-expect-error Options type is missing durationThreshold
    observer.observe({ type: 'event', durationThreshold: 16 })

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!SUPPORTS_LOAF_TIMING) return

    let afterOperation = false
    const unsubscribe = editor.subscribe((_snapshot, change) => {
      if (change?.operations.length) {
        afterOperation = true
      }
    })

    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        if (afterOperation) {
          setLastLongAnimationFrameDuration(Math.round(entry.duration))
          afterOperation = false
        }
      })
    })

    // Register the observer for events
    observer.observe({ type: 'long-animation-frame' })

    return () => {
      observer.disconnect()
      unsubscribe()
    }
  }, [editor])

  return (
    <div className="performance-controls">
      <p>
        <label>
          Blocks:{' '}
          <select
            onChange={(event) =>
              setConfig({
                blocks: Number.parseInt(event.target.value, 10),
              })
            }
            value={config.blocks}
          >
            {blocksOptions.map((blocks) => (
              <option key={blocks} value={blocks}>
                {blocks.toString().replace(/(\d{3})$/, ',$1')}
              </option>
            ))}
          </select>
        </label>
      </p>

      <details
        onToggle={(event) => setConfigurationOpen(event.currentTarget.open)}
        open={configurationOpen}
      >
        <summary>Configuration</summary>

        <p>
          <label>
            Set <code>content-visibility: auto</code> on:{' '}
            <select
              onChange={(event) =>
                setConfig({
                  contentVisibilityMode: toContentVisibilityMode(
                    event.target.value
                  ),
                })
              }
              value={config.contentVisibilityMode}
            >
              <option value="none">None</option>
              <option value="element">Elements</option>
            </select>
          </label>
        </p>

        <p>
          <label>
            Rendering strategy:{' '}
            <select
              onChange={(event) =>
                setConfig({
                  renderingStrategyMode: event.target
                    .value as Config['renderingStrategyMode'],
                })
              }
              value={config.renderingStrategyMode}
            >
              <option value="auto">Auto</option>
              <option value="full">Full</option>
              <option value="staged">Staged</option>
              <option value="shell">Shell</option>
              <option value="virtualized">Virtualized</option>
            </select>
          </label>
        </p>

        {config.renderingStrategyMode === 'shell' && (
          <>
            <p>
              <label>
                Segment size:{' '}
                <input
                  min={1}
                  onChange={(event) =>
                    setConfig({
                      renderingStrategySegmentSize: Number.parseInt(
                        event.target.value,
                        10
                      ),
                    })
                  }
                  type="number"
                  value={config.renderingStrategySegmentSize}
                />
              </label>
            </p>

            <p>
              <label>
                Preview characters:{' '}
                <input
                  min={16}
                  onChange={(event) =>
                    setConfig({
                      renderingStrategyPreviewChars: Number.parseInt(
                        event.target.value,
                        10
                      ),
                    })
                  }
                  type="number"
                  value={config.renderingStrategyPreviewChars}
                />
              </label>
            </p>
          </>
        )}

        {(config.renderingStrategyMode === 'shell' ||
          config.renderingStrategyMode === 'virtualized') && (
          <>
            <p>
              <label>
                Overscan:{' '}
                <input
                  min={0}
                  onChange={(event) =>
                    setConfig({
                      renderingStrategyOverscan: Number.parseInt(
                        event.target.value,
                        10
                      ),
                    })
                  }
                  type="number"
                  value={config.renderingStrategyOverscan}
                />
              </label>
            </p>

            <p>
              <label>
                Threshold:{' '}
                <input
                  min={1}
                  onChange={(event) =>
                    setConfig({
                      renderingStrategyThreshold: Number.parseInt(
                        event.target.value,
                        10
                      ),
                    })
                  }
                  type="number"
                  value={config.renderingStrategyThreshold}
                />
              </label>
            </p>
          </>
        )}

        {config.renderingStrategyMode === 'virtualized' && (
          <>
            <p>
              <label>
                Estimated block size:{' '}
                <input
                  min={1}
                  onChange={(event) =>
                    setConfig({
                      virtualizedEstimatedBlockSize: Number.parseInt(
                        event.target.value,
                        10
                      ),
                    })
                  }
                  type="number"
                  value={config.virtualizedEstimatedBlockSize}
                />
              </label>
            </p>

            <p>
              <label>
                Editor height:{' '}
                <input
                  min={120}
                  onChange={(event) =>
                    setConfig({
                      editorHeight: Number.parseInt(event.target.value, 10),
                    })
                  }
                  type="number"
                  value={config.editorHeight}
                />
              </label>
            </p>
          </>
        )}

        <p>
          <label>
            <input
              checked={config.showSelectedHeadings}
              onChange={(event) =>
                setConfig({
                  showSelectedHeadings: event.target.checked,
                })
              }
              type="checkbox"
            />{' '}
            Call <code>useElementSelected</code> in each heading
          </label>
        </p>

        <p>
          <label>
            <input
              checked={config.strictMode}
              onChange={(event) =>
                setConfig({
                  strictMode: event.target.checked,
                })
              }
              type="checkbox"
            />{' '}
            React strict mode (only works in localhost)
          </label>
        </p>
      </details>

      <details>
        <summary>Statistics</summary>

        <p>
          Last keypress (ms):{' '}
          {SUPPORTS_EVENT_TIMING
            ? (lastKeyPressDuration ?? '-')
            : 'Not supported'}
        </p>

        <p>
          Average of last 10 keypresses (ms):{' '}
          {SUPPORTS_EVENT_TIMING
            ? (averageKeyPressDuration ?? '-')
            : 'Not supported'}
        </p>

        <p>
          Last long animation frame (ms):{' '}
          {SUPPORTS_LOAF_TIMING
            ? (lastLongAnimationFrameDuration ?? '-')
            : 'Not supported'}
        </p>

        <p>
          Requested rendering strategy:{' '}
          <output data-test-id="huge-document-requested-strategy">
            {formatMetric(renderingStrategyMetrics?.requestedStrategy)}
          </output>
        </p>

        <p>
          Effective rendering strategy:{' '}
          <output data-test-id="huge-document-effective-strategy">
            {formatMetric(renderingStrategyMetrics?.effectiveStrategy)}
          </output>
        </p>

        <p>
          Mounted top-level blocks:{' '}
          <output data-test-id="huge-document-mounted-top-level-count">
            {formatMetric(renderingStrategyMetrics?.mountedTopLevelCount)}
          </output>
        </p>

        <p>
          Pending top-level blocks:{' '}
          <output data-test-id="huge-document-pending-top-level-count">
            {formatMetric(renderingStrategyMetrics?.pendingTopLevelCount)}
          </output>
        </p>

        <p>
          Shell placeholders:{' '}
          <output data-test-id="huge-document-shell-count">
            {formatMetric(renderingStrategyMetrics?.shellCount)}
          </output>
        </p>

        <p>
          DOM coverage boundaries:{' '}
          <output data-test-id="huge-document-dom-coverage-boundary-count">
            {formatMetric(renderingStrategyMetrics?.domCoverageBoundaryCount)}
          </output>
        </p>

        <p>
          DOM nodes:{' '}
          <output data-test-id="huge-document-dom-node-count">
            {formatMetric(renderingStrategyMetrics?.domNodeCount)}
          </output>
        </p>

        <p>
          Virtualized viewport boundaries:{' '}
          <output data-test-id="huge-document-viewport-boundary-count">
            {formatMetric(
              renderingStrategyMetrics?.viewportVirtualizationBoundaryCount
            )}
          </output>
        </p>

        {SUPPORTS_EVENT_TIMING && lastKeyPressDuration === null && (
          <p>Events shorter than 16ms may not be detected.</p>
        )}
      </details>
    </div>
  )
}

export default HugeDocumentExample
