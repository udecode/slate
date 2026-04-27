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
import { createEditor, defineEditorExtension, Editor, type Value } from 'slate'
import { withHistory } from 'slate-history'
import {
  createSlateProjectionStore,
  Editable,
  type SlateProjection,
  withReact,
} from 'slate-react'

const largeDocumentOptions = {
  activeRadius: 0,
  enabled: true,
  islandSize: 2,
  previewChars: 48,
  threshold: 1,
}

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

const createRuntimeEditor = (children: Value) => {
  const editor = withHistory(withReact(createEditor()))

  Editor.replace(editor, {
    children,
    selection: null,
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

const mixedRuntimeExtension = defineEditorExtension<
  ReturnType<typeof createRuntimeEditor>
>({
  name: 'mixed-runtime',
  methods(editor) {
    const nextIsInline = editor.isInline
    const nextIsVoid = editor.isVoid

    return {
      isInline(element) {
        return (
          (element as { type?: string }).type === 'runtime-link' ||
          nextIsInline(element)
        )
      },
      isVoid(element) {
        return (
          (element as { type?: string }).type === 'runtime-void' ||
          nextIsVoid(element)
        )
      },
    }
  },
})

const withMixedRuntime = (editor: ReturnType<typeof createRuntimeEditor>) => {
  editor.extend(mixedRuntimeExtension)
  return editor
}

const runtimeHtmlExtension = defineEditorExtension<
  ReturnType<typeof createRuntimeEditor>
>({
  name: 'runtime-html',
  methods(editor) {
    const nextInsertData = editor.insertData

    return {
      insertData(data) {
        const html = data.getData('text/html')

        if (!html) {
          nextInsertData(data)
          return
        }

        const document = new DOMParser().parseFromString(html, 'text/html')
        const text = document.body.textContent ?? ''
        const isBold = !!document.body.querySelector('strong,b')

        this.insertFragment([
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
      },
    }
  },
})

const withRuntimeHtml = (editor: ReturnType<typeof createRuntimeEditor>) => {
  editor.extend(runtimeHtmlExtension)
  return editor
}

const collectProjectionProbes = (
  snapshot: ReturnType<typeof Editor.getSnapshot>
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
    case 'runtime-void':
      return (
        <div {...attributes} contentEditable={false} data-runtime-void="true">
          <span>void card</span>
          <span style={{ display: 'none' }}>{children}</span>
        </div>
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

const ShadowRuntimeEditor = () => {
  const [editor] = useState(() => createRuntimeEditor(createBlocks('shadow')))

  return (
    <Editable
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

const LargeDocumentRuntimeExample = () => {
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

  const projectionStore = useMemo(
    () => createSlateProjectionStore(projectionEditor, collectProjectionProbes),
    [projectionEditor]
  )

  useEffect(() => () => projectionStore.destroy(), [projectionStore])

  return (
    <div style={{ padding: 24 }}>
      <section data-runtime-editor="default" style={sectionStyle}>
        <h2>Large Document Runtime Default</h2>
        <Editable
          editor={defaultEditor}
          id="large-document-runtime-default"
          largeDocument={largeDocumentOptions}
          style={editorStyle}
        />
      </section>

      <section data-runtime-editor="custom" style={sectionStyle}>
        <h2>Large Document Runtime Custom Text</h2>
        <Editable
          editor={customEditor}
          id="large-document-runtime-custom"
          largeDocument={largeDocumentOptions}
          renderText={renderCustomText}
          style={editorStyle}
        />
      </section>

      <section data-runtime-editor="leaf" style={sectionStyle}>
        <h2>Large Document Runtime Custom Leaf</h2>
        <Editable
          editor={leafEditor}
          id="large-document-runtime-leaf"
          largeDocument={largeDocumentOptions}
          renderLeaf={renderCustomLeaf}
          style={editorStyle}
        />
      </section>

      <section data-runtime-editor="rich" style={sectionStyle}>
        <h2>Large Document Runtime Rich Paste</h2>
        <Editable
          editor={richEditor}
          id="large-document-runtime-rich"
          largeDocument={largeDocumentOptions}
          renderLeaf={renderCustomLeaf}
          style={editorStyle}
        />
      </section>

      <section data-runtime-editor="mixed" style={sectionStyle}>
        <h2>Large Document Runtime Mixed Nodes</h2>
        <Editable
          editor={mixedEditor}
          id="large-document-runtime-mixed"
          largeDocument={largeDocumentOptions}
          renderElement={renderMixedElement}
          style={editorStyle}
        />
      </section>

      <section data-runtime-editor="void" style={sectionStyle}>
        <h2>Large Document Runtime Void</h2>
        <Editable
          editor={voidEditor}
          id="large-document-runtime-void"
          largeDocument={largeDocumentOptions}
          renderElement={renderMixedElement}
          style={editorStyle}
        />
      </section>

      <section data-runtime-editor="table" style={sectionStyle}>
        <h2>Large Document Runtime Table</h2>
        <Editable
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
        <Editable
          editor={projectionEditor}
          id="large-document-runtime-projection"
          largeDocument={largeDocumentOptions}
          projectionStore={projectionStore}
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
