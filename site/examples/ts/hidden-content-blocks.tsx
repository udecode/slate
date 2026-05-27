import React, { useCallback, useMemo, useState } from 'react'
import { NodeApi, type Element as SlateElement } from 'slate'
import type {
  DOMCoverageCopyPolicy,
  DOMCoverageFindPolicy,
  DOMCoverageSelectionPolicy,
} from 'slate-dom/internal'
import {
  Editable,
  type EditableDOMStrategyMetrics,
  EditableElement,
  type RenderElementProps,
  Slate,
  useSlateEditor,
} from 'slate-react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type HiddenBlocksState = {
  accordionOpen: boolean
  activeTab: 'details' | 'overview'
  collapsibleOpen: boolean
  copyPolicy: DOMCoverageCopyPolicy
  findPolicy: DOMCoverageFindPolicy
  selectionPolicy: DOMCoverageSelectionPolicy
  setAccordionOpen: (value: boolean) => void
  setActiveTab: (value: 'details' | 'overview') => void
  setCollapsibleOpen: (value: boolean) => void
}

const selectionPolicyOptions: DOMCoverageSelectionPolicy[] = [
  'boundary',
  'model-backed',
  'materialize',
]
const copyPolicyOptions: DOMCoverageCopyPolicy[] = [
  'include-model',
  'summary-only',
  'exclude',
  'materialize',
]
const findPolicyOptions: DOMCoverageFindPolicy[] = [
  'not-native-until-mounted',
  'native',
  'custom',
]

const HiddenBlocksContext = React.createContext<HiddenBlocksState>({
  accordionOpen: false,
  activeTab: 'overview',
  collapsibleOpen: false,
  copyPolicy: 'include-model',
  findPolicy: 'not-native-until-mounted',
  selectionPolicy: 'boundary',
  setAccordionOpen: () => {},
  setActiveTab: () => {},
  setCollapsibleOpen: () => {},
})

const PolicyControls = <T extends string>({
  label,
  onChange,
  options,
  testId,
  value,
}: {
  label: string
  onChange: (value: T) => void
  options: readonly T[]
  testId: string
  value: T
}) => (
  <div className="flex flex-wrap items-center gap-1">
    <span className="mr-1 text-sm font-medium text-muted-foreground">
      {label}
    </span>
    {options.map((option) => (
      <Button
        aria-pressed={value === option}
        data-test-id={`${testId}-${option}`}
        key={option}
        onClick={() => onChange(option)}
        size="sm"
        type="button"
        variant={value === option ? 'default' : 'outline'}
      >
        {option}
      </Button>
    ))}
  </div>
)

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
        type: 'collapsible-block',
        children: [
          {
            type: 'paragraph',
            children: [{ text: 'Collapsible hidden note' }],
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
  const [collapsibleOpen, setCollapsibleOpen] = useState(false)
  const [activeTab, setActiveTab] =
    useState<HiddenBlocksState['activeTab']>('overview')
  const [selectionPolicy, setSelectionPolicy] =
    useState<DOMCoverageSelectionPolicy>('boundary')
  const [copyPolicy, setCopyPolicy] =
    useState<DOMCoverageCopyPolicy>('include-model')
  const [findPolicy, setFindPolicy] = useState<DOMCoverageFindPolicy>(
    'not-native-until-mounted'
  )
  const [copyPreview, setCopyPreview] = useState('')
  const [metrics, setMetrics] = useState<EditableDOMStrategyMetrics | null>(
    null
  )
  const state = useMemo(
    () => ({
      accordionOpen,
      activeTab,
      collapsibleOpen,
      copyPolicy,
      findPolicy,
      selectionPolicy,
      setAccordionOpen,
      setActiveTab,
      setCollapsibleOpen,
    }),
    [
      accordionOpen,
      activeTab,
      collapsibleOpen,
      copyPolicy,
      findPolicy,
      selectionPolicy,
    ]
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
      <div className="flex flex-col gap-4">
        <Card contentEditable={false}>
          <CardHeader>
            <CardTitle>Hidden editor content</CardTitle>
            <CardDescription>
              Shadcn Accordion, Collapsible, and Tabs shells keep their UI
              mounted while Slate owns hidden editable descendants.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Button
              data-test-id="toggle-accordion"
              onClick={() => setAccordionOpen(!accordionOpen)}
              size="sm"
              variant="outline"
            >
              Accordion
            </Button>
            <Button
              data-test-id="toggle-collapsible"
              onClick={() => setCollapsibleOpen(!collapsibleOpen)}
              size="sm"
              variant="outline"
            >
              Collapsible
            </Button>
            <Separator className="h-6" orientation="vertical" />
            <Button
              data-test-id="select-copy-accordion"
              onClick={() => selectAndCopy([1, 0, 0])}
              size="sm"
              variant="secondary"
            >
              Copy accordion
            </Button>
            <Button
              data-test-id="select-copy-collapsible"
              onClick={() => selectAndCopy([3, 0, 0])}
              size="sm"
              variant="secondary"
            >
              Copy collapsible
            </Button>
            <Button
              data-test-id="select-copy-details"
              onClick={() => selectAndCopy([2, 1, 0])}
              size="sm"
              variant="secondary"
            >
              Copy details tab
            </Button>
            <Separator className="h-6" orientation="vertical" />
            <PolicyControls
              label="Selection"
              onChange={setSelectionPolicy}
              options={selectionPolicyOptions}
              testId="policy-selection"
              value={selectionPolicy}
            />
            <PolicyControls
              label="Copy"
              onChange={setCopyPolicy}
              options={copyPolicyOptions}
              testId="policy-copy"
              value={copyPolicy}
            />
            <PolicyControls
              label="Find"
              onChange={setFindPolicy}
              options={findPolicyOptions}
              testId="policy-find"
              value={findPolicy}
            />
          </CardContent>
        </Card>

        <Slate editor={editor}>
          <Editable
            aria-label="Hidden content blocks editor"
            className="min-h-[220px] rounded-lg border border-border bg-background p-3"
            id="hidden-content-blocks-editor"
            onDOMStrategyMetrics={setMetrics}
            placeholder="Write around hidden blocks..."
            renderElement={Element}
            spellCheck
          />
        </Slate>

        <div
          className="flex flex-wrap items-center gap-2"
          contentEditable={false}
        >
          <Badge variant="outline">
            <output data-test-id="hidden-content-copy-preview">
              {copyPreview || 'copy payload appears here'}
            </output>
          </Badge>
          <Badge variant="secondary">
            boundaries:{' '}
            <output data-test-id="hidden-content-boundary-count">
              {metrics?.domCoverageBoundaryElementCount ?? 0}
            </output>
          </Badge>
          <Badge variant="secondary">
            native:{' '}
            <output data-test-id="hidden-content-native-surface">
              {(metrics?.domCoverageBoundaryElementCount ?? 0) > 0
                ? 'degraded'
                : 'complete'}
            </output>
          </Badge>
          <Badge variant="outline">
            selection:{' '}
            <output data-test-id="hidden-content-selection-policy">
              {selectionPolicy}
            </output>
          </Badge>
          <Badge variant="outline">
            copy:{' '}
            <output data-test-id="hidden-content-copy-policy">
              {copyPolicy}
            </output>
          </Badge>
          <Badge variant="outline">
            find:{' '}
            <output data-test-id="hidden-content-find-policy">
              {findPolicy}
            </output>
          </Badge>
        </div>
      </div>
    </HiddenBlocksContext.Provider>
  )
}

const Element = ({ children, element, slots }: RenderElementProps) => {
  const {
    accordionOpen,
    activeTab,
    collapsibleOpen,
    setAccordionOpen,
    setActiveTab,
    setCollapsibleOpen,
    copyPolicy,
    findPolicy,
    selectionPolicy,
  } = React.useContext(HiddenBlocksContext)
  const childNodes = React.Children.toArray(children)

  switch (element.type) {
    case 'accordion-block':
      return (
        <EditableElement>
          <Accordion
            collapsible
            onValueChange={(value) => setAccordionOpen(value === 'body')}
            type="single"
            value={accordionOpen ? 'body' : ''}
          >
            <AccordionItem value="body">
              <div contentEditable={false}>
                <AccordionTrigger data-test-id="accordion-trigger">
                  Accordion body
                </AccordionTrigger>
              </div>
              <AccordionContent forceMount>
                <slots.contentBoundary
                  copyPolicy={copyPolicy}
                  findPolicy={findPolicy}
                  mounted={accordionOpen}
                  onMaterialize={() => setAccordionOpen(true)}
                  scope={{
                    from: 0,
                    to: childNodes.length - 1,
                    type: 'children',
                  }}
                  selectionPolicy={selectionPolicy}
                />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </EditableElement>
      )
    case 'collapsible-block':
      return (
        <EditableElement>
          <Collapsible onOpenChange={setCollapsibleOpen} open={collapsibleOpen}>
            <div contentEditable={false}>
              <CollapsibleTrigger asChild>
                <Button
                  className="my-2"
                  data-test-id="collapsible-trigger"
                  variant="outline"
                >
                  Collapsible note
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent forceMount>
              <slots.contentBoundary
                copyPolicy={copyPolicy}
                findPolicy={findPolicy}
                mounted={collapsibleOpen}
                onMaterialize={() => setCollapsibleOpen(true)}
                scope={{ from: 0, to: childNodes.length - 1, type: 'children' }}
                selectionPolicy={selectionPolicy}
              />
            </CollapsibleContent>
          </Collapsible>
        </EditableElement>
      )
    case 'tabs-block':
      return (
        <EditableElement>
          <Tabs
            onValueChange={(value) =>
              setActiveTab(value as HiddenBlocksState['activeTab'])
            }
            value={activeTab}
          >
            <div contentEditable={false}>
              <TabsList>
                <TabsTrigger data-test-id="tab-overview" value="overview">
                  Overview
                </TabsTrigger>
                <TabsTrigger data-test-id="tab-details" value="details">
                  Details
                </TabsTrigger>
              </TabsList>
            </div>
            {childNodes.map((child, index) => {
              const tab = index === 0 ? 'overview' : 'details'

              return (
                <TabsContent forceMount key={tab} value={tab}>
                  {activeTab === tab ? (
                    child
                  ) : (
                    <slots.contentBoundary
                      copyPolicy={copyPolicy}
                      findPolicy={findPolicy}
                      mounted={false}
                      onMaterialize={() => setActiveTab(tab)}
                      scope={{ from: index, type: 'children' }}
                      selectionPolicy={selectionPolicy}
                    />
                  )}
                </TabsContent>
              )
            })}
          </Tabs>
        </EditableElement>
      )
    case 'tab-panel':
      return <EditableElement>{children}</EditableElement>
    default:
      return <EditableElement>{children}</EditableElement>
  }
}

export default HiddenContentBlocksExample
