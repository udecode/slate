import { expect, test } from '@playwright/test'
import {
  assertNoIllegalKernelTransitions,
  createSlateBrowserInternalControlGauntlet,
  type EditorSurfaceOptions,
  installSlateReactRenderProfiler,
  openExample,
  type SlateBrowserScenarioStep,
  takeSlateBrowserRenderStateSnapshot,
} from 'slate-browser/playwright'

import {
  createStressArtifact,
  type StressCase,
  type StressFamilyContract,
  stressArtifactPath,
  stressResultPath,
  writeStressArtifact,
} from './stress-utils'

// Focus with STRESS_ROUTES/STRESS_FAMILIES/STRESS_SEED. Replay any emitted
// artifact with STRESS_REPLAY=<artifact.json> bun test:stress:replay.
test.describe.configure({ mode: 'serial' })

const enabledValues = (envName: string) =>
  new Set(
    (process.env[envName] ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  )

const enabledRoutes = enabledValues('STRESS_ROUTES')
const enabledFamilies = enabledValues('STRESS_FAMILIES')
const seed = process.env.STRESS_SEED ?? 'default'

const routeEnabled = (route: string) =>
  enabledRoutes.size === 0 || enabledRoutes.has(route)

const familyEnabled = (family: string) =>
  enabledFamilies.size === 0 || enabledFamilies.has(family)

const operationFamilyContracts = [
  {
    assertions: [
      'model selection lands on the next inline void from both sides',
      'DOM selection stays collapsed at the void boundary',
      'focus remains editor-owned',
      'selection movement stays inside the render budget',
    ],
    family: 'inline-void-boundary-navigation',
    routes: ['mentions'],
  },
  {
    assertions: [
      'markable inline void visible content keeps mark styling',
      'hidden anchor is owned by the runtime shell',
      'model and DOM selections land on the inline void',
      'selection movement stays inside the render budget',
    ],
    family: 'markable-inline-void-formatting',
    routes: ['mentions'],
  },
  {
    assertions: [
      'model and DOM selections enter and leave block voids',
      'visible void content has no hidden-anchor layout gap',
      'focus remains editor-owned',
      'selection movement stays inside the render budget',
    ],
    family: 'block-void-navigation',
    routes: ['images', 'embeds'],
  },
  {
    assertions: [
      'pasted HTML image becomes a runtime-owned block void',
      'visible image content is contentEditable=false',
      'hidden spacer is owned by the runtime shell',
      'focus remains editor-owned after paste',
    ],
    family: 'paste-html-image-void',
    routes: ['paste-html'],
  },
  {
    assertions: [
      'editable island visible content stays inside a runtime-owned block void',
      'internal input focus remains native-owned',
      'outer editor selection is preserved while the native control edits',
      'follow-up editor typing records a legal insert-text transition',
    ],
    family: 'editable-island-native-focus',
    routes: ['editable-voids'],
  },
  {
    assertions: [
      'large-document runtime void uses the same runtime-owned shell',
      'hidden spacer is present without visible layout ownership',
      'scoped runtime editor selection lands on the void text anchor',
      'stress replay preserves the scoped editor surface',
    ],
    family: 'large-document-runtime-void-shell',
    routes: ['large-document-runtime'],
  },
  {
    assertions: [
      'table cell boundary arrows land at offset 0',
      'model and DOM selection agree',
      'focus remains editor-owned',
      'selection movement does not rerender the editable root',
    ],
    family: 'table-cell-boundary-navigation',
    routes: ['tables'],
  },
  {
    assertions: [
      'external decoration refresh updates rendered highlights',
      'search input keeps focus ownership',
      'editor root and element nodes stay inside the render budget',
    ],
    family: 'external-decoration-refresh',
    routes: ['search-highlighting'],
  },
  {
    assertions: [
      'real mouse drag creates native and model selections',
      'hovering toolbar becomes visible',
      'focus remains editor-owned',
      'selection movement does not rerender Slate nodes',
    ],
    family: 'mouse-selection-toolbar',
    routes: ['hovering-toolbar'],
  },
  {
    assertions: [
      'paste normalizes multiline content',
      'follow-up typing commits',
      'undo replays the last edit',
      'artifact can replay the generated steps',
    ],
    family: 'paste-normalize-undo',
    routes: ['richtext', 'plaintext', 'forced-layout'],
  },
  {
    assertions: [
      'composition commits through the browser scenario runner',
      'model text includes the composed text',
      'focus remains editor-owned',
      'artifact can replay the generated steps',
    ],
    family: 'selection-repair-ime',
    routes: ['richtext'],
  },
] satisfies StressFamilyContract[]

const contractByFamily = new Map(
  operationFamilyContracts.map((contract) => [contract.family, contract])
)

const point = (path: number[], offset: number) => ({ path, offset })

const collapsedSelection = (path: number[], offset: number) => ({
  anchor: point(path, offset),
  focus: point(path, offset),
})

const createStressCase = ({
  family,
  route,
  steps,
  surface,
}: {
  family: string
  route: string
  steps: SlateBrowserScenarioStep[]
  surface?: EditorSurfaceOptions
}): StressCase => ({
  contract: contractByFamily.get(family),
  family,
  id: `${seed}-${route}-${family}`,
  route,
  seed,
  surface,
  steps,
})

const pasteNormalizeUndo = (route: string): StressCase =>
  createStressCase({
    family: 'paste-normalize-undo',
    route,
    steps: [
      { kind: 'selectAll', label: 'select-all' },
      {
        kind: 'pasteText',
        label: 'paste-two-lines',
        text: 'Alpha\nBeta',
      },
      {
        kind: 'assertBlockTexts',
        label: 'assert-pasted-blocks',
        texts: ['Alpha', 'Beta'],
      },
      {
        kind: 'assertRenderedDOMShape',
        label: 'assert-first-pasted-block-dom-shape',
        shape: {
          blockIndex: 0,
          innerText: 'Alpha',
          noUnexpectedZeroWidthBreaks: true,
          textContent: 'Alpha',
          zeroWidthBreakCount: 0,
        },
      },
      {
        kind: 'assertRenderedDOMShape',
        label: 'assert-second-pasted-block-dom-shape',
        shape: {
          blockIndex: 1,
          innerText: 'Beta',
          noUnexpectedZeroWidthBreaks: true,
          textContent: 'Beta',
          zeroWidthBreakCount: 0,
        },
      },
      {
        kind: 'assertKernelTrace',
        label: 'assert-paste-command-trace',
        trace: {
          commandKind: 'insert-data',
          transition: { allowed: true },
        },
      },
      { kind: 'assertLastCommit', label: 'assert-paste-commit' },
      { focusOwner: 'editor', kind: 'assertFocusOwner', label: 'assert-focus' },
      { kind: 'type', label: 'type-follow-up', text: '!' },
      {
        kind: 'assertBlockTexts',
        label: 'assert-follow-up-text',
        texts: ['Alpha', 'Beta!'],
      },
      {
        kind: 'assertSelectionLocation',
        label: 'assert-collapsed-follow-up-selection',
        location: { isCollapsed: true },
      },
      { kind: 'undo', label: 'undo-follow-up-type' },
      {
        kind: 'assertBlockTexts',
        label: 'assert-after-undo',
        texts: ['Alpha', 'Beta'],
      },
    ],
  })

const inlineVoidBoundaryNavigation = (): StressCase => {
  const beforeFirstMentionText = 'Try mentioning characters, like '
  const betweenMentionsText = ' or '

  return createStressCase({
    family: 'inline-void-boundary-navigation',
    route: 'mentions',
    steps: [
      {
        kind: 'select',
        label: 'select-before-first-mention',
        selection: collapsedSelection([1, 0], beforeFirstMentionText.length),
      },
      { kind: 'resetRenderProfiler', label: 'reset-render-before-first-right' },
      { key: 'ArrowRight', kind: 'press', label: 'arrow-right-into-r2d2' },
      {
        kind: 'assertSelection',
        label: 'assert-r2d2-selected-from-left',
        selection: collapsedSelection([1, 2], 0),
      },
      {
        kind: 'assertSelectionLocation',
        label: 'assert-r2d2-dom-location',
        location: { anchorOffset: 0, anchorPath: [1, 2], isCollapsed: true },
      },
      { focusOwner: 'editor', kind: 'assertFocusOwner', label: 'assert-focus' },
      {
        budget: { byKind: { editable: 0 }, total: 0 },
        kind: 'assertRenderBudget',
        label: 'assert-first-right-render-budget',
      },
      {
        kind: 'select',
        label: 'select-r2d2-from-right',
        selection: collapsedSelection([1, 2], 0),
      },
      { kind: 'resetRenderProfiler', label: 'reset-render-before-left' },
      { key: 'ArrowLeft', kind: 'press', label: 'arrow-left-before-r2d2' },
      {
        kind: 'assertSelection',
        label: 'assert-before-r2d2',
        selection: collapsedSelection([1, 0], beforeFirstMentionText.length),
      },
      {
        budget: { byKind: { editable: 0 }, total: 0 },
        kind: 'assertRenderBudget',
        label: 'assert-first-left-render-budget',
      },
      {
        kind: 'select',
        label: 'select-between-mentions',
        selection: collapsedSelection([1, 2], betweenMentionsText.length),
      },
      {
        kind: 'resetRenderProfiler',
        label: 'reset-render-before-second-right',
      },
      { key: 'ArrowRight', kind: 'press', label: 'arrow-right-into-mace' },
      {
        kind: 'assertSelection',
        label: 'assert-mace-selected-from-left',
        selection: collapsedSelection([1, 4], 0),
      },
      {
        kind: 'assertSelectionLocation',
        label: 'assert-mace-dom-location',
        location: { anchorOffset: 0, anchorPath: [1, 4], isCollapsed: true },
      },
      {
        budget: { byKind: { editable: 0 }, total: 0 },
        kind: 'assertRenderBudget',
        label: 'assert-second-right-render-budget',
      },
      {
        kind: 'select',
        label: 'select-mace-from-right',
        selection: collapsedSelection([1, 4], 0),
      },
      { kind: 'resetRenderProfiler', label: 'reset-render-before-second-left' },
      { key: 'ArrowLeft', kind: 'press', label: 'arrow-left-before-mace' },
      {
        kind: 'assertSelection',
        label: 'assert-between-mentions',
        selection: collapsedSelection([1, 2], betweenMentionsText.length),
      },
      {
        budget: { byKind: { editable: 0 }, total: 0 },
        kind: 'assertRenderBudget',
        label: 'assert-second-left-render-budget',
      },
    ],
  })
}

const markableInlineVoidFormatting = (): StressCase => {
  const beforeFirstMentionText = 'Try mentioning characters, like '

  return createStressCase({
    family: 'markable-inline-void-formatting',
    route: 'mentions',
    steps: [
      {
        count: 1,
        kind: 'assertLocatorCount',
        label: 'assert-visible-r2d2-mention',
        selector: '[data-cy="mention-R2-D2"]',
      },
      {
        kind: 'assertLocatorCss',
        label: 'assert-r2d2-mark-style',
        property: 'font-weight',
        selector: '[data-cy="mention-R2-D2"]',
        value: '700',
      },
      {
        count: 0,
        kind: 'assertLocatorCount',
        label: 'assert-visible-mention-does-not-own-hidden-anchor',
        selector: '[data-cy="mention-R2-D2"] [data-slate-zero-width]',
      },
      {
        kind: 'assertLocatorCount',
        label: 'assert-inline-void-shells-own-hidden-anchor',
        min: 2,
        selector:
          '[data-slate-inline="true"][data-slate-void="true"] [data-slate-zero-width]',
      },
      {
        kind: 'select',
        label: 'select-before-markable-inline-void',
        selection: collapsedSelection([1, 0], beforeFirstMentionText.length),
      },
      { kind: 'resetRenderProfiler', label: 'reset-render-before-markable' },
      { key: 'ArrowRight', kind: 'press', label: 'arrow-right-into-markable' },
      {
        kind: 'assertSelection',
        label: 'assert-markable-inline-selected',
        selection: collapsedSelection([1, 2], 0),
      },
      {
        kind: 'assertSelectionLocation',
        label: 'assert-markable-inline-dom-location',
        location: { anchorOffset: 0, anchorPath: [1, 2], isCollapsed: true },
      },
      { focusOwner: 'editor', kind: 'assertFocusOwner', label: 'assert-focus' },
      {
        budget: { byKind: { editable: 0 }, total: 0 },
        kind: 'assertRenderBudget',
        label: 'assert-markable-inline-render-budget',
      },
    ],
  })
}

const blockVoidNavigation = (route: 'embeds' | 'images'): StressCase => {
  const startOffset = route === 'images' ? 113 : 177
  const voidRenderBudget = {
    byKind: {
      editable: 0,
      element: { max: 1 },
      spacer: { max: 1 },
      void: { max: 1 },
    },
    total: { max: 3 },
  }

  return createStressCase({
    family: 'block-void-navigation',
    route,
    steps: [
      {
        kind: 'selectDOM',
        label: 'select-before-block-void',
        selection: collapsedSelection([0, 0], startOffset),
      },
      {
        kind: 'assertSelectionLocation',
        label: 'assert-before-block-void-dom-location',
        location: {
          anchorOffset: startOffset,
          anchorPath: [0, 0],
          isCollapsed: true,
        },
      },
      ...(route === 'images'
        ? ([
            {
              innerSelector: '[contenteditable="false"]',
              kind: 'assertLocatorVerticalOffset',
              label: 'assert-image-visible-content-offset',
              max: 1,
              min: 0,
              selector: '[data-slate-path="1"]',
            },
          ] satisfies SlateBrowserScenarioStep[])
        : []),
      ...(route === 'embeds'
        ? ([
            {
              afterSelector: '[data-slate-path="2"]',
              beforeSelector: 'input[type="text"]',
              kind: 'assertLocatorVerticalGap',
              label: 'assert-embed-url-input-gap',
              max: 24,
              min: 12,
            },
          ] satisfies SlateBrowserScenarioStep[])
        : []),
      { kind: 'resetRenderProfiler', label: 'reset-render-before-void-enter' },
      {
        key: 'ArrowRight',
        kind: 'press',
        label: 'arrow-right-into-block-void',
      },
      {
        kind: 'assertSelection',
        label: 'assert-block-void-selected',
        selection: collapsedSelection([1, 0], 0),
      },
      {
        kind: 'assertSelectionLocation',
        label: 'assert-block-void-dom-location',
        location: { anchorOffset: 0, anchorPath: [1, 0], isCollapsed: true },
      },
      { focusOwner: 'editor', kind: 'assertFocusOwner', label: 'assert-focus' },
      {
        budget: voidRenderBudget,
        kind: 'assertRenderBudget',
        label: 'assert-void-enter-render-budget',
      },
      { kind: 'resetRenderProfiler', label: 'reset-render-before-void-exit' },
      {
        key: 'ArrowRight',
        kind: 'press',
        label: 'arrow-right-after-block-void',
      },
      {
        kind: 'assertSelection',
        label: 'assert-after-block-void',
        selection: collapsedSelection([2, 0], 0),
      },
      {
        kind: 'assertSelectionLocation',
        label: 'assert-after-block-void-dom-location',
        location: { anchorOffset: 0, anchorPath: [2, 0], isCollapsed: true },
      },
      {
        budget: voidRenderBudget,
        kind: 'assertRenderBudget',
        label: 'assert-void-exit-render-budget',
      },
      { key: 'ArrowLeft', kind: 'press', label: 'arrow-left-back-to-void' },
      {
        kind: 'assertSelection',
        label: 'assert-block-void-selected-from-right',
        selection: collapsedSelection([1, 0], 0),
      },
    ],
  })
}

const pasteHtmlImageVoid = (): StressCase =>
  createStressCase({
    family: 'paste-html-image-void',
    route: 'paste-html',
    steps: [
      { kind: 'selectAll', label: 'select-all' },
      {
        html: '<p>Before image</p><img src="https://example.com/pasted.png"><p>After image</p>',
        kind: 'pasteHtml',
        label: 'paste-html-image',
        text: 'Before image\nAfter image',
      },
      {
        count: 1,
        kind: 'assertLocatorCount',
        label: 'assert-pasted-image-rendered',
        selector: 'img[src="https://example.com/pasted.png"]',
      },
      {
        count: 1,
        kind: 'assertLocatorCount',
        label: 'assert-pasted-image-void-shell',
        selector: '[data-slate-void="true"]',
      },
      {
        count: 1,
        kind: 'assertLocatorCount',
        label: 'assert-pasted-image-runtime-spacer',
        selector: '[data-slate-void="true"] [data-slate-spacer]',
      },
      {
        count: 1,
        kind: 'assertLocatorCount',
        label: 'assert-pasted-image-visible-content-wrapper',
        selector: '[data-slate-void="true"] > [contenteditable="false"]',
      },
      { focusOwner: 'editor', kind: 'assertFocusOwner', label: 'assert-focus' },
      { kind: 'assertLastCommit', label: 'assert-paste-commit' },
    ],
  })

const editableIslandNativeFocus = (): StressCase =>
  createStressCase({
    family: 'editable-island-native-focus',
    route: 'editable-voids',
    steps: [
      {
        count: 1,
        kind: 'assertLocatorCount',
        label: 'assert-editable-island-shell',
        selector: '[data-slate-void="true"]',
      },
      {
        count: 1,
        kind: 'assertLocatorCount',
        label: 'assert-editable-island-spacer',
        selector: '[data-slate-void="true"] [data-slate-spacer]',
      },
      ...createSlateBrowserInternalControlGauntlet({
        controlSelector: 'input[type="text"]',
        controlValue: 'Typing',
        followUpText: 'Outer ',
        outerSelection: collapsedSelection([0, 0], 0),
        textAfterFollowUp: 'Outer In addition to nodes',
      }),
    ],
  })

const largeDocumentRuntimeVoidShell = (): StressCase =>
  createStressCase({
    family: 'large-document-runtime-void-shell',
    route: 'large-document-runtime',
    steps: [
      {
        count: 1,
        kind: 'assertLocatorCount',
        label: 'assert-runtime-void-content',
        selector: '[data-runtime-void="true"]',
      },
      {
        count: 1,
        kind: 'assertLocatorCount',
        label: 'assert-large-runtime-void-shell',
        selector: '[data-slate-void="true"]',
      },
      {
        count: 1,
        kind: 'assertLocatorCount',
        label: 'assert-large-runtime-void-spacer',
        selector: '[data-slate-void="true"] [data-slate-spacer]',
      },
      {
        kind: 'select',
        label: 'select-large-runtime-void',
        selection: collapsedSelection([0, 0], 0),
      },
      {
        kind: 'assertSelection',
        label: 'assert-large-runtime-void-selection',
        selection: collapsedSelection([0, 0], 0),
      },
      {
        kind: 'assertSelectionLocation',
        label: 'assert-large-runtime-void-dom-location',
        location: { anchorPath: [0, 0], isCollapsed: true },
      },
    ],
    surface: { scope: '[data-runtime-editor="void"]' },
  })

const tableCellBoundaryNavigation = (): StressCase =>
  createStressCase({
    family: 'table-cell-boundary-navigation',
    route: 'tables',
    steps: [
      {
        kind: 'select',
        label: 'select-first-table-cell-start',
        selection: collapsedSelection([1, 0, 0, 0], 0),
      },
      {
        kind: 'assertSelection',
        label: 'assert-first-cell-start',
        selection: collapsedSelection([1, 0, 0, 0], 0),
      },
      { kind: 'resetRenderProfiler', label: 'reset-render-before-cell-right' },
      { key: 'ArrowRight', kind: 'press', label: 'arrow-right-next-cell' },
      {
        kind: 'assertSelection',
        label: 'assert-second-cell-start',
        selection: collapsedSelection([1, 0, 1, 0], 0),
      },
      {
        kind: 'assertSelectionLocation',
        label: 'assert-second-cell-dom-location',
        location: {
          anchorOffset: 0,
          anchorPath: [1, 0, 1, 0],
          isCollapsed: true,
        },
      },
      { focusOwner: 'editor', kind: 'assertFocusOwner', label: 'assert-focus' },
      {
        budget: { byKind: { editable: 0 }, total: 0 },
        kind: 'assertRenderBudget',
        label: 'assert-table-navigation-render-budget',
      },
    ],
  })

const externalDecorationRefresh = (): StressCase =>
  createStressCase({
    family: 'external-decoration-refresh',
    route: 'search-highlighting',
    steps: [
      { kind: 'resetRenderProfiler', label: 'reset-render-before-search' },
      {
        kind: 'fillControl',
        label: 'type-search-query',
        selector: 'input[type="search"]',
        value: 't',
      },
      {
        kind: 'assertLocatorCount',
        label: 'assert-highlight-rendered',
        min: 1,
        selector: '[data-cy="search-highlighted"]',
      },
      {
        focusOwner: 'outside',
        kind: 'assertFocusOwner',
        label: 'assert-search-input-keeps-focus',
      },
      {
        budget: {
          byKind: { editable: 0, element: 0, void: 0 },
        },
        kind: 'assertRenderBudget',
        label: 'assert-search-refresh-render-budget',
      },
    ],
  })

const mouseSelectionToolbar = (): StressCase =>
  createStressCase({
    family: 'mouse-selection-toolbar',
    route: 'hovering-toolbar',
    steps: [
      {
        kind: 'assertLocatorCss',
        label: 'assert-toolbar-starts-hidden',
        property: 'opacity',
        selector: '[data-test-id="menu"]',
        value: '0',
      },
      { kind: 'resetRenderProfiler', label: 'reset-render-before-mouse-drag' },
      {
        kind: 'dragTextSelection',
        label: 'drag-first-text-range',
        selector: 'span[data-slate-string="true"]',
        steps: 12,
      },
      {
        kind: 'assertWindowSelectionText',
        label: 'assert-native-selection-text',
        notEmpty: true,
      },
      {
        kind: 'assertModelSelectionExpanded',
        label: 'assert-model-selection-expanded',
      },
      {
        kind: 'assertLocatorCss',
        label: 'assert-toolbar-visible',
        property: 'opacity',
        selector: '[data-test-id="menu"]',
        value: '1',
      },
      {
        kind: 'assertLocatorCss',
        label: 'assert-toolbar-top-positioned',
        notValue: '-10000px',
        property: 'top',
        selector: '[data-test-id="menu"]',
      },
      { focusOwner: 'editor', kind: 'assertFocusOwner', label: 'assert-focus' },
      {
        budget: { byKind: { editable: 0 }, total: 0 },
        kind: 'assertRenderBudget',
        label: 'assert-mouse-selection-render-budget',
      },
    ],
  })

const selectionRepairIme = (): StressCase =>
  createStressCase({
    family: 'selection-repair-ime',
    route: 'richtext',
    steps: [
      {
        kind: 'select',
        label: 'select-composition-point',
        selection: collapsedSelection([0, 0], 'This is '.length),
      },
      {
        committedText: 'e',
        kind: 'composeText',
        label: 'compose-e',
        steps: ['e'],
        text: 'e',
        transport: 'synthetic',
      },
      {
        kind: 'assertText',
        label: 'assert-composed-model-text',
        text: 'This is eeditable',
      },
      { focusOwner: 'editor', kind: 'assertFocusOwner', label: 'assert-focus' },
      {
        kind: 'assertSelectionLocation',
        label: 'assert-composition-selection-collapsed',
        location: { isCollapsed: true },
      },
    ],
  })

const stressCases: StressCase[] = [
  inlineVoidBoundaryNavigation(),
  markableInlineVoidFormatting(),
  ...(['images', 'embeds'] as const).map(blockVoidNavigation),
  pasteHtmlImageVoid(),
  editableIslandNativeFocus(),
  largeDocumentRuntimeVoidShell(),
  tableCellBoundaryNavigation(),
  externalDecorationRefresh(),
  mouseSelectionToolbar(),
  ...['plaintext', 'richtext', 'forced-layout'].map(pasteNormalizeUndo),
  selectionRepairIme(),
].filter(
  (stressCase) =>
    routeEnabled(stressCase.route) && familyEnabled(stressCase.family)
)

if (stressCases.length === 0) {
  throw new Error(
    'No stress cases selected. Check STRESS_ROUTES and STRESS_FAMILIES filters.'
  )
}

for (const stressCase of stressCases) {
  test(`${stressCase.route} ${stressCase.family}`, async ({
    page,
  }, testInfo) => {
    const artifactPath = stressArtifactPath(testInfo.project.name, stressCase)
    const resultPath = stressResultPath(artifactPath)

    writeStressArtifact(
      artifactPath,
      createStressArtifact({
        artifactPath,
        projectName: testInfo.project.name,
        resultPath,
        status: 'running',
        stressCase,
      })
    )

    try {
      await installSlateReactRenderProfiler(page)
      const editor = await openExample(page, stressCase.route, {
        ready: { editor: 'visible' },
        surface: stressCase.surface,
      })
      const result = await editor.scenario.run(
        stressCase.id,
        stressCase.steps,
        {
          metadata: {
            capabilities: [
              'generated-stress',
              stressCase.family,
              stressCase.route,
            ],
            platform: testInfo.project.name,
            transport: 'playwright-browser',
          },
          tracePath: resultPath,
        }
      )
      const finalState = await takeSlateBrowserRenderStateSnapshot(editor)

      assertNoIllegalKernelTransitions(result)
      expect(result.replay.replayable).toBe(true)

      writeStressArtifact(
        artifactPath,
        createStressArtifact({
          artifactPath,
          finalSnapshot: {
            domSelection: finalState.domSelection,
            focusOwner: finalState.focusOwner,
            lastCommit: finalState.lastCommit,
            renderCounts: finalState.renderCounts,
            selection: finalState.selection,
          },
          projectName: testInfo.project.name,
          reductionCandidates: result.reductionCandidates,
          result,
          resultPath,
          status: 'passed',
          stressCase,
        })
      )
    } catch (error) {
      writeStressArtifact(
        artifactPath,
        createStressArtifact({
          artifactPath,
          error,
          projectName: testInfo.project.name,
          resultPath,
          status: 'failed',
          stressCase,
        })
      )
      throw error
    }
  })
}
