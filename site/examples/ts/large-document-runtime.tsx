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
import { withHistory } from 'slate-history'
import {
  createDecorationSource,
  Editable,
  type EditableProps,
  type ReactEditor,
  Slate,
  type SlateDecorationSource,
  type SlateProjection,
  withReact,
} from 'slate-react'

const largeDocumentOptions = {
  activeRadius: 0,
  mode: 'shell',
  islandSize: 2,
  previewChars: 48,
  threshold: 1,
} as const

const editorStyle: CSSProperties = {
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  minHeight: 80,
  padding: 12,
}

const sectionStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  marginBottom: 24,
}

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

const getRuntimeSearchParams = () =>
  typeof document === 'undefined'
    ? new URLSearchParams()
    : new URLSearchParams(document.location.search)

const createRuntimeEditor = (children: Value) => {
  const editor = withHistory(withReact(createEditor()))

  editor.update((tx) => {
    tx.value.replace({
      children,
      selection: null,
    })
  })

  return editor
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
    name: 'large-document-runtime',
    elements: [
      { inline: true, type: 'runtime-link' },
      { type: 'runtime-void', void: 'block' },
    ],
  })

  return editor
}

const withRuntimeHtml = (editor: ReturnType<typeof createRuntimeEditor>) => {
  editor.extend({
    capabilities: {
      'dom.clipboard.insertData': (_editor: unknown, data: DataTransfer) =>
        insertRuntimeHtmlData(editor, data),
    },
    name: 'large-document-runtime-html',
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
      id="large-document-runtime-shadow"
      largeDocument={largeDocumentOptions}
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
      <section data-runtime-editor="dom-present-native" style={sectionStyle}>
        <h2>Large Document DOM Present Native Input</h2>
        <RuntimeEditable
          editor={editor}
          id="large-document-runtime-dom-present-native"
          largeDocument="dom-present"
          style={editorStyle}
        />
      </section>
    </div>
  )
}

const LargeDocumentRuntimeExample = () => {
  const runtimeMode = getRuntimeSearchParams().get('runtime_mode')

  if (runtimeMode === 'dom-present-native-input') {
    return <DomPresentNativeInputRuntime />
  }

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

  const projectionSource = useMemo(
    () =>
      createDecorationSource(projectionEditor, {
        id: 'large-document-runtime-projection',
        read: ({ snapshot }) => collectProjectionProbes(snapshot),
      }),
    [projectionEditor]
  )

  useEffect(() => () => projectionSource.destroy(), [projectionSource])

  return (
    <div style={{ padding: 24 }}>
      <section data-runtime-editor="default" style={sectionStyle}>
        <h2>Large Document Runtime Default</h2>
        <RuntimeEditable
          editor={defaultEditor}
          id="large-document-runtime-default"
          largeDocument={largeDocumentOptions}
          style={editorStyle}
        />
      </section>

      <section data-runtime-editor="custom" style={sectionStyle}>
        <h2>Large Document Runtime Custom Text</h2>
        <RuntimeEditable
          editor={customEditor}
          id="large-document-runtime-custom"
          largeDocument={largeDocumentOptions}
          renderText={renderCustomText}
          style={editorStyle}
        />
      </section>

      <section data-runtime-editor="leaf" style={sectionStyle}>
        <h2>Large Document Runtime Custom Leaf</h2>
        <RuntimeEditable
          editor={leafEditor}
          id="large-document-runtime-leaf"
          largeDocument={largeDocumentOptions}
          renderLeaf={renderCustomLeaf}
          style={editorStyle}
        />
      </section>

      <section data-runtime-editor="rich" style={sectionStyle}>
        <h2>Large Document Runtime Rich Paste</h2>
        <RuntimeEditable
          editor={richEditor}
          id="large-document-runtime-rich"
          largeDocument={largeDocumentOptions}
          renderLeaf={renderCustomLeaf}
          style={editorStyle}
        />
      </section>

      <section data-runtime-editor="mixed" style={sectionStyle}>
        <h2>Large Document Runtime Mixed Nodes</h2>
        <RuntimeEditable
          editor={mixedEditor}
          id="large-document-runtime-mixed"
          largeDocument={largeDocumentOptions}
          renderElement={renderMixedElement}
          renderVoid={renderMixedVoid}
          style={editorStyle}
        />
      </section>

      <section data-runtime-editor="void" style={sectionStyle}>
        <h2>Large Document Runtime Void</h2>
        <RuntimeEditable
          editor={voidEditor}
          id="large-document-runtime-void"
          largeDocument={largeDocumentOptions}
          renderElement={renderMixedElement}
          renderVoid={renderMixedVoid}
          style={editorStyle}
        />
      </section>

      <section data-runtime-editor="table" style={sectionStyle}>
        <h2>Large Document Runtime Table</h2>
        <RuntimeEditable
          editor={tableEditor}
          id="large-document-runtime-table"
          largeDocument={largeDocumentOptions}
          renderElement={renderMixedElement}
          style={editorStyle}
        />
      </section>

      <section data-runtime-editor="shadow" style={sectionStyle}>
        <h2>Large Document Runtime Shadow DOM</h2>
        <ShadowRuntimeHost />
      </section>

      <section data-runtime-editor="projection" style={sectionStyle}>
        <h2>Large Document Runtime Projection</h2>
        <RuntimeEditable
          decorationSources={[projectionSource]}
          editor={projectionEditor}
          id="large-document-runtime-projection"
          largeDocument={largeDocumentOptions}
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

export default LargeDocumentRuntimeExample
