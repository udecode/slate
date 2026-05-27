import React, { useCallback, useMemo, useState } from 'react'
import { NodeApi, type Element as SlateElement } from 'slate'
import { DOMCoverage } from 'slate-dom/internal'
import {
  Editable,
  EditableElement,
  type RenderElementProps,
  Slate,
  useSlateEditor,
} from 'slate-react'
import { Button } from '@/components/ui/button'

const hiddenBodyPath = [2, 1, 0]

type HiddenBoundaryState = {
  deepHidden: boolean
  footerHidden: boolean
  headerHidden: boolean
  innerHidden: boolean
  outerHidden: boolean
}

const HiddenBoundaryContext = React.createContext<HiddenBoundaryState>({
  deepHidden: true,
  footerHidden: true,
  headerHidden: true,
  innerHidden: true,
  outerHidden: true,
})

const DomCoverageBoundariesExample = () => {
  const editor = useSlateEditor({
    initialValue: [
      {
        type: 'header',
        children: [{ text: 'Hidden header text' }],
      },
      {
        type: 'paragraph',
        children: [
          { text: 'Visible introduction before the collapsed section.' },
        ],
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
    ] as SlateElement[],
  })
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
            NodeApi.string(state.runtime.snapshot().children[4])
          ).length,
          path: [4, 0],
        },
      })
    })
    refreshTrace()
  }, [editor, refreshTrace])

  const copySelection = useCallback(() => {
    const data = new DataTransfer()

    editor.api.clipboard.writeSelection(data)
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

  const hiddenBoundaries = useMemo(
    () => ({
      deepHidden,
      footerHidden,
      headerHidden,
      innerHidden,
      outerHidden,
    }),
    [deepHidden, footerHidden, headerHidden, innerHidden, outerHidden]
  )

  const boundaries = DOMCoverage.getBoundaries(editor)

  return (
    <div className="slate-dom-coverage-page">
      <div className="slate-dom-coverage-toolbar">
        <Button
          onClick={() => setHeaderHidden((value) => !value)}
          type="button"
          variant="outline"
        >
          Header
        </Button>
        <Button
          onClick={() => setOuterHidden((value) => !value)}
          type="button"
          variant="outline"
        >
          Outer
        </Button>
        <Button
          onClick={() => setInnerHidden((value) => !value)}
          type="button"
          variant="outline"
        >
          Nested
        </Button>
        <Button
          onClick={() => setDeepHidden((value) => !value)}
          type="button"
          variant="outline"
        >
          Deep
        </Button>
        <Button
          onClick={() => setFooterHidden((value) => !value)}
          type="button"
          variant="outline"
        >
          Footer
        </Button>
        <Button onClick={updateHiddenBody} type="button" variant="outline">
          Update hidden body
        </Button>
        <Button onClick={selectHiddenBody} type="button" variant="outline">
          Select hidden body
        </Button>
        <Button onClick={selectAll} type="button" variant="outline">
          Select all
        </Button>
        <Button onClick={copySelection} type="button" variant="outline">
          Copy
        </Button>
      </div>

      <div className="slate-dom-coverage-editor-wrap">
        <HiddenBoundaryContext.Provider value={hiddenBoundaries}>
          <Slate editor={editor}>
            <Editable
              autoFocus
              className="slate-dom-coverage-editor"
              placeholder="Try toggles, selection, and copy"
              renderElement={Element}
              spellCheck
            />
          </Slate>
        </HiddenBoundaryContext.Provider>
      </div>

      <pre className="slate-dom-coverage-debug">
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

      <pre className="slate-dom-coverage-copy">
        {copyPreview || 'copy payload appears here'}
      </pre>
    </div>
  )
}

const Element = ({ children, element, slots }: RenderElementProps) => {
  const { deepHidden, footerHidden, headerHidden, innerHidden, outerHidden } =
    React.useContext(HiddenBoundaryContext)
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
          <div className="slate-dom-coverage-summary" contentEditable={false}>
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
          <div className="slate-dom-coverage-summary" contentEditable={false}>
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
          <div className="slate-dom-coverage-summary" contentEditable={false}>
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
  <span
    aria-label={label}
    className="slate-dom-coverage-placeholder"
    role="note"
  >
    {children}
  </span>
)

export default DomCoverageBoundariesExample
