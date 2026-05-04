import React, { useCallback, useState } from 'react'
import { Node, type Element as SlateElement } from 'slate'
import { DOMCoverage } from 'slate-dom/internal'
import { withHistory } from 'slate-history'
import {
  Editable,
  EditableElement,
  type RenderElementProps,
  Slate,
  useSlateEditor,
} from 'slate-react'

const hiddenBodyPath = [2, 1, 0]

const DomCoverageBoundariesExample = () => {
  const editor = useSlateEditor({ withEditor: withHistory, initialValue })
  const [headerHidden, setHeaderHidden] = useState(true)
  const [footerHidden, setFooterHidden] = useState(true)
  const [outerHidden, setOuterHidden] = useState(true)
  const [innerHidden, setInnerHidden] = useState(true)
  const [deepHidden, setDeepHidden] = useState(true)
  const [copyPreview, setCopyPreview] = useState('')
  const [traceTick, setTraceTick] = useState(0)

  const refreshTrace = useCallback(() => {
    setTimeout(() => setTraceTick((tick) => tick + 1))
  }, [])

  const updateHiddenBody = useCallback(() => {
    editor.update((tx) => {
      const [node] = editor.read((state) => state.nodes.get(hiddenBodyPath))
      const text =
        typeof (node as { text?: unknown }).text === 'string'
          ? (node as { text: string }).text
          : ''

      tx.text.insert(` update-${Date.now().toString().slice(-4)}`, {
        at: { offset: text.length, path: [...hiddenBodyPath] },
      })
    })
    refreshTrace()
  }, [editor, refreshTrace])

  const selectHiddenBody = useCallback(() => {
    editor.update((tx) => {
      const [node] = editor.read((state) => state.nodes.get(hiddenBodyPath))
      const text =
        typeof (node as { text?: unknown }).text === 'string'
          ? (node as { text: string }).text
          : ''

      tx.selection.set({
        anchor: { offset: 0, path: [...hiddenBodyPath] },
        focus: { offset: text.length, path: [...hiddenBodyPath] },
      })
    })
    refreshTrace()
  }, [editor, refreshTrace])

  const selectAll = useCallback(() => {
    editor.update((tx) => {
      tx.selection.set({
        anchor: { offset: 0, path: [0, 0] },
        focus: {
          offset: editor.read((state) =>
            Node.string(state.runtime.snapshot().children[4])
          ).length,
          path: [4, 0],
        },
      })
    })
    refreshTrace()
  }, [editor, refreshTrace])

  const copySelection = useCallback(() => {
    const data = new DataTransfer()

    editor.dom.clipboard.writeSelection(data)
    setCopyPreview(
      [
        `text/plain: ${data.getData('text/plain')}`,
        `text/html: ${data.getData('text/html')}`,
        `fragment: ${
          data.getData('application/x-slate-fragment') ? 'present' : 'missing'
        }`,
      ].join('\n\n')
    )
  }, [editor])

  const renderElement = useCallback(
    (props: RenderElementProps) => (
      <Element
        {...props}
        deepHidden={deepHidden}
        footerHidden={footerHidden}
        headerHidden={headerHidden}
        innerHidden={innerHidden}
        outerHidden={outerHidden}
      />
    ),
    [deepHidden, footerHidden, headerHidden, innerHidden, outerHidden]
  )

  const boundaries = DOMCoverage.getBoundaries(editor)

  return (
    <div style={styles.page}>
      <div style={styles.toolbar}>
        <button onClick={() => setHeaderHidden((value) => !value)}>
          Header
        </button>
        <button onClick={() => setOuterHidden((value) => !value)}>Outer</button>
        <button onClick={() => setInnerHidden((value) => !value)}>
          Nested
        </button>
        <button onClick={() => setDeepHidden((value) => !value)}>Deep</button>
        <button onClick={() => setFooterHidden((value) => !value)}>
          Footer
        </button>
        <button onClick={updateHiddenBody}>Update hidden body</button>
        <button onClick={selectHiddenBody}>Select hidden body</button>
        <button onClick={selectAll}>Select all</button>
        <button onClick={copySelection}>Copy</button>
      </div>

      <div style={styles.editorWrap}>
        <Slate editor={editor}>
          <Editable
            autoFocus
            placeholder="Try toggles, selection, and copy"
            renderElement={renderElement}
            spellCheck
          />
        </Slate>
      </div>

      <pre style={styles.debug}>
        {JSON.stringify(
          boundaries.map((boundary) => ({
            id: boundary.boundaryId,
            copy: boundary.copyPolicy,
            range: boundary.coveredPathRanges,
            reason: boundary.reason,
            selection: boundary.selectionPolicy,
            state: boundary.state,
          })),
          null,
          2
        )}
        {traceTick ? `\ntraceTick: ${traceTick}` : ''}
      </pre>

      <pre style={styles.copy}>
        {copyPreview || 'copy payload appears here'}
      </pre>
    </div>
  )
}

const Element = ({
  children,
  element,
  deepHidden,
  footerHidden,
  headerHidden,
  innerHidden,
  outerHidden,
  slots,
}: RenderElementProps & {
  deepHidden: boolean
  footerHidden: boolean
  headerHidden: boolean
  innerHidden: boolean
  outerHidden: boolean
}) => {
  const childNodes = React.Children.toArray(children)

  switch (element.type) {
    case 'header':
      return (
        <slots.unstableBoundary
          boundaryId="hidden-header"
          mounted={!headerHidden}
          scope={{ type: 'self' }}
        >
          <CoveragePlaceholder label="Hidden header placeholder">
            Header hidden
          </CoveragePlaceholder>
        </slots.unstableBoundary>
      )
    case 'section':
      return (
        <EditableElement>
          <div contentEditable={false} style={styles.summary}>
            Outer section
          </div>
          {childNodes[0]}
          <slots.unstableBoundary
            boundaryId="outer-section-body"
            mounted={!outerHidden}
            scope={{ from: 1, to: childNodes.length - 1, type: 'children' }}
          >
            <CoveragePlaceholder label="Collapsed outer section body">
              Outer body collapsed
            </CoveragePlaceholder>
          </slots.unstableBoundary>
        </EditableElement>
      )
    case 'nested-section':
      return (
        <EditableElement>
          <div contentEditable={false} style={styles.summary}>
            Nested section
          </div>
          {childNodes[0]}
          <slots.unstableBoundary
            boundaryId="nested-section-body"
            mounted={!innerHidden}
            scope={{ from: 1, to: childNodes.length - 1, type: 'children' }}
          >
            <CoveragePlaceholder label="Collapsed nested section body">
              Nested body collapsed
            </CoveragePlaceholder>
          </slots.unstableBoundary>
        </EditableElement>
      )
    case 'deep-section':
      return (
        <EditableElement>
          <div contentEditable={false} style={styles.summary}>
            Deep section
          </div>
          {childNodes[0]}
          <slots.unstableBoundary
            boundaryId="deep-section-body"
            mounted={!deepHidden}
            scope={{ from: 1, to: childNodes.length - 1, type: 'children' }}
          >
            <CoveragePlaceholder label="Collapsed deep section body">
              Deep body collapsed
            </CoveragePlaceholder>
          </slots.unstableBoundary>
        </EditableElement>
      )
    case 'bulleted-list':
      return <ul>{children}</ul>
    case 'list-item':
      return <li>{children}</li>
    case 'footer':
      return (
        <slots.unstableBoundary
          boundaryId="hidden-footer"
          mounted={!footerHidden}
          scope={{ type: 'self' }}
        >
          <CoveragePlaceholder label="Hidden footer placeholder">
            Footer hidden
          </CoveragePlaceholder>
        </slots.unstableBoundary>
      )
    default:
      return <EditableElement>{children}</EditableElement>
  }
}

const CoveragePlaceholder = ({
  children,
  label,
}: {
  children: React.ReactNode
  label: string
}) => (
  <span aria-label={label} role="note" style={styles.placeholder}>
    {children}
  </span>
)

const initialValue = [
  {
    type: 'header',
    children: [{ text: 'Hidden header text' }],
  },
  {
    type: 'paragraph',
    children: [{ text: 'Visible introduction before the collapsed section.' }],
  },
  {
    type: 'section',
    children: [
      {
        type: 'summary',
        children: [{ text: 'Section summary stays mounted.' }],
      },
      {
        type: 'paragraph',
        children: [{ text: 'Hidden alpha' }],
      },
      {
        type: 'nested-section',
        children: [
          {
            type: 'summary',
            children: [{ text: 'Nested summary stays mounted.' }],
          },
          {
            type: 'paragraph',
            children: [{ text: 'Nested hidden body' }],
          },
          {
            type: 'deep-section',
            children: [
              {
                type: 'summary',
                children: [{ text: 'Deep summary stays mounted.' }],
              },
              {
                type: 'paragraph',
                children: [{ text: 'Deep hidden body' }],
              },
            ],
          },
        ],
      },
      {
        type: 'bulleted-list',
        children: [
          {
            type: 'list-item',
            children: [{ text: 'Hidden list item' }],
          },
        ],
      },
    ],
  },
  {
    type: 'paragraph',
    children: [{ text: 'Visible paragraph after the collapsed section.' }],
  },
  {
    type: 'footer',
    children: [{ text: 'Hidden footer text' }],
  },
] as SlateElement[]

const styles = {
  copy: {
    background: '#f8fafc',
    border: '1px solid #cbd5e1',
    minHeight: 80,
    overflow: 'auto',
    padding: 12,
    whiteSpace: 'pre-wrap',
  },
  debug: {
    background: '#0f172a',
    color: '#e2e8f0',
    minHeight: 120,
    overflow: 'auto',
    padding: 12,
  },
  editorWrap: {
    border: '1px solid #cbd5e1',
    padding: 16,
  },
  page: {
    display: 'grid',
    gap: 16,
  },
  placeholder: {
    background: '#fef3c7',
    border: '1px solid #f59e0b',
    display: 'inline-block',
    padding: '2px 6px',
  },
  summary: {
    color: '#475569',
    fontSize: 12,
    fontWeight: 600,
    textTransform: 'uppercase',
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
} satisfies Record<string, React.CSSProperties>

export default DomCoverageBoundariesExample
