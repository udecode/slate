import React, { useCallback, useMemo, useState } from 'react'
import { NodeApi, type Element as SlateElement } from 'slate'
import {
  Editable,
  type EditableDOMStrategyMetrics,
  EditableElement,
  type RenderElementProps,
  Slate,
  useSlateEditor,
} from 'slate-react'

type HiddenBlocksState = {
  accordionOpen: boolean
  activeTab: 'details' | 'overview'
  setAccordionOpen: (value: boolean) => void
  setActiveTab: (value: 'details' | 'overview') => void
}

const HiddenBlocksContext = React.createContext<HiddenBlocksState>({
  accordionOpen: false,
  activeTab: 'overview',
  setAccordionOpen: () => {},
  setActiveTab: () => {},
})

const HiddenContentBlocksExample = () => {
  const editor = useSlateEditor({
    initialValue: [
      {
        type: 'paragraph',
        children: [{ text: 'Intro visible before hidden blocks.' }],
      },
      {
        type: 'accordion-block',
        children: [
          {
            type: 'paragraph',
            children: [{ text: 'Accordion secret alpha' }],
          },
          {
            type: 'paragraph',
            children: [{ text: 'Accordion secret beta' }],
          },
        ],
      },
      {
        type: 'tabs-block',
        children: [
          {
            tab: 'overview',
            type: 'tab-panel',
            children: [{ text: 'Overview tab visible text' }],
          },
          {
            tab: 'details',
            type: 'tab-panel',
            children: [{ text: 'Details tab hidden text' }],
          },
        ],
      },
      {
        type: 'paragraph',
        children: [{ text: 'Outro visible after hidden blocks.' }],
      },
    ] as SlateElement[],
  })
  const [accordionOpen, setAccordionOpen] = useState(false)
  const [activeTab, setActiveTab] =
    useState<HiddenBlocksState['activeTab']>('overview')
  const [copyPreview, setCopyPreview] = useState('')
  const [metrics, setMetrics] = useState<EditableDOMStrategyMetrics | null>(
    null
  )
  const state = useMemo(
    () => ({
      accordionOpen,
      activeTab,
      setAccordionOpen,
      setActiveTab,
    }),
    [accordionOpen, activeTab]
  )

  const selectAndCopy = useCallback(
    (path: number[]) => {
      editor.update((tx) => {
        const [node] = editor.read((readState) => readState.nodes.get(path))
        const text = node ? NodeApi.string(node) : ''

        tx.selection.set({
          anchor: { offset: 0, path },
          focus: { offset: text.length, path },
        })
      })

      const data = new DataTransfer()

      editor.api.clipboard.writeSelection(data)
      setCopyPreview(data.getData('text/plain'))
    },
    [editor]
  )

  return (
    <HiddenBlocksContext.Provider value={state}>
      <div style={styles.page}>
        <div contentEditable={false} style={styles.toolbar}>
          <button
            data-test-id="toggle-accordion"
            onClick={() => setAccordionOpen(!accordionOpen)}
          >
            Accordion
          </button>
          <button
            data-test-id="select-copy-accordion"
            onClick={() => selectAndCopy([1, 0, 0])}
          >
            Copy accordion body
          </button>
          <button
            data-test-id="select-copy-details"
            onClick={() => selectAndCopy([2, 1, 0])}
          >
            Copy details tab
          </button>
        </div>

        <Slate editor={editor}>
          <Editable
            aria-label="Hidden content blocks editor"
            id="hidden-content-blocks-editor"
            onDOMStrategyMetrics={setMetrics}
            placeholder="Write around hidden blocks..."
            renderElement={Element}
            spellCheck
            style={styles.editor}
          />
        </Slate>

        <div contentEditable={false} style={styles.status}>
          <output data-test-id="hidden-content-copy-preview">
            {copyPreview || 'copy payload appears here'}
          </output>
          <output data-test-id="hidden-content-boundary-count">
            {metrics?.domCoverageBoundaryElementCount ?? 0}
          </output>
          <output data-test-id="hidden-content-native-surface">
            {(metrics?.domCoverageBoundaryElementCount ?? 0) > 0
              ? 'degraded'
              : 'complete'}
          </output>
        </div>
      </div>
    </HiddenBlocksContext.Provider>
  )
}

const Element = ({ children, element, slots }: RenderElementProps) => {
  const { accordionOpen, activeTab, setAccordionOpen, setActiveTab } =
    React.useContext(HiddenBlocksContext)
  const childNodes = React.Children.toArray(children)

  switch (element.type) {
    case 'accordion-block':
      return (
        <EditableElement>
          <div contentEditable={false} style={styles.blockChrome}>
            <button
              aria-expanded={accordionOpen}
              data-test-id="accordion-trigger"
              onClick={() => setAccordionOpen(!accordionOpen)}
            >
              Accordion body
            </button>
          </div>
          <slots.contentBoundary
            copyPolicy="include-model"
            mounted={accordionOpen}
            onMaterialize={() => setAccordionOpen(true)}
            renderPlaceholder={({ materialize }) => (
              <button
                contentEditable={false}
                data-test-id="accordion-materialize"
                onClick={materialize}
                style={styles.placeholderButton}
              >
                Open hidden accordion body
              </button>
            )}
            scope={{ from: 0, to: childNodes.length - 1, type: 'children' }}
            selectionPolicy="materialize"
          />
        </EditableElement>
      )
    case 'tabs-block':
      return (
        <EditableElement>
          <div contentEditable={false} role="tablist" style={styles.tabsList}>
            <button
              aria-selected={activeTab === 'overview'}
              data-test-id="tab-overview"
              onClick={() => setActiveTab('overview')}
              role="tab"
            >
              Overview
            </button>
            <button
              aria-selected={activeTab === 'details'}
              data-test-id="tab-details"
              onClick={() => setActiveTab('details')}
              role="tab"
            >
              Details
            </button>
          </div>
          {childNodes.map((child, index) => {
            const tab = index === 0 ? 'overview' : 'details'

            if (activeTab === tab) {
              return <React.Fragment key={tab}>{child}</React.Fragment>
            }

            return (
              <slots.contentBoundary
                copyPolicy="include-model"
                key={tab}
                mounted={false}
                onMaterialize={() => setActiveTab(tab)}
                renderPlaceholder={({ materialize }) => (
                  <button
                    contentEditable={false}
                    data-test-id={`tab-${tab}-materialize`}
                    onClick={materialize}
                    style={styles.placeholderButton}
                  >
                    Open {tab} tab
                  </button>
                )}
                scope={{ from: index, type: 'children' }}
                selectionPolicy="materialize"
              />
            )
          })}
        </EditableElement>
      )
    case 'tab-panel':
      return <EditableElement>{children}</EditableElement>
    default:
      return <EditableElement>{children}</EditableElement>
  }
}

const styles = {
  blockChrome: {
    display: 'flex',
    gap: 8,
    margin: '8px 0',
  },
  editor: {
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    minHeight: 220,
    padding: 14,
  },
  page: {
    display: 'grid',
    gap: 14,
  },
  placeholderButton: {
    background: '#f8fafc',
    border: '1px dashed #64748b',
    borderRadius: 6,
    color: '#334155',
    margin: '6px 0',
    padding: '4px 8px',
  },
  status: {
    display: 'grid',
    gap: 8,
  },
  tabsList: {
    display: 'flex',
    gap: 8,
    margin: '10px 0',
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
} satisfies Record<string, React.CSSProperties>

export default HiddenContentBlocksExample
