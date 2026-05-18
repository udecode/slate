import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  assertSlateBrowserFirstPartyParityContracts,
  SLATE_BROWSER_FIRST_LEGACY_PARITY_FAMILIES,
  SLATE_BROWSER_FIRST_PARTY_PLUGIN_CONTRACT_REGISTRY,
} from '../../src/core'
import {
  classifyScenarioTransportClaim,
  createScenarioReductionCandidates,
  createScenarioReplay,
  createSlateBrowserCompositionGauntlet,
  createSlateBrowserDestructiveEditingGauntlet,
  createSlateBrowserInlineCutTypingGauntlet,
  createSlateBrowserInternalControlGauntlet,
  createSlateBrowserMixedEditingConformanceGauntlet,
  createSlateBrowserPluginContractRegistry,
  createSlateBrowserSemanticEditingConformanceGauntlet,
  createSlateBrowserShellActivationGauntlet,
  createSlateBrowserToolbarMarkClickTypingGauntlet,
  createSlateBrowserWarmLoopSteps,
  createSlateBrowserWarmToolbarArrowGauntlet,
  defineSlateBrowserPluginContract,
  normalizeScenarioMetadata,
  type SlateBrowserScenarioStep,
  serializeScenarioStepForReplay,
  summarizeScenarioReductionCandidate,
} from '../../src/playwright'

describe('scenario helpers', () => {
  test('creates prefix, suffix, and single-step reduction candidates', () => {
    const steps: SlateBrowserScenarioStep[] = [
      { kind: 'focus', label: 'focus' },
      {
        kind: 'select',
        label: 'select',
        selection: {
          anchor: { path: [0, 0], offset: 0 },
          focus: { path: [0, 0], offset: 0 },
        },
      },
      { kind: 'type', label: 'type', text: 'A' },
    ]

    const candidates = createScenarioReductionCandidates(steps)

    expect(candidates.map((candidate) => candidate.label)).toEqual([
      'prefix:2',
      'prefix:1',
      'suffix:1',
      'suffix:2',
      'without:0',
      'without:1',
      'without:2',
    ])
    expect(candidates.map((candidate) => candidate.steps.length)).toEqual([
      2, 1, 2, 1, 2, 2, 2,
    ])
    expect(candidates[0].removedRange).toEqual({ end: 3, start: 2 })
    expect(candidates[2].removedRange).toEqual({ end: 1, start: 0 })
    expect(candidates[4].removedRange).toEqual({ end: 1, start: 0 })
  })

  test('does not return empty scenario candidates', () => {
    const steps: SlateBrowserScenarioStep[] = [
      { kind: 'snapshot', label: 'only-step' },
    ]

    expect(createScenarioReductionCandidates(steps)).toEqual([])
  })

  test('registers first-party plugin browser contract rows', () => {
    const registry = createSlateBrowserPluginContractRegistry([
      defineSlateBrowserPluginContract({
        plugin: 'media',
        rows: [
          {
            assertions: [
              'model and DOM selections enter and leave block voids',
              'visible void content has no hidden-anchor layout gap',
            ],
            family: 'block-void-navigation',
            routes: ['images', 'embeds'],
          },
        ],
      }),
      defineSlateBrowserPluginContract({
        plugin: 'table',
        rows: [
          {
            assertions: [
              'table cell boundary arrows land at offset 0',
              'model and DOM selection agree',
            ],
            family: 'table-cell-boundary-navigation',
            routes: ['tables'],
          },
        ],
      }),
    ])

    expect(registry.rows.map((row) => [row.plugin, row.family])).toEqual([
      ['media', 'block-void-navigation'],
      ['table', 'table-cell-boundary-navigation'],
    ])
    expect(registry.rowByFamily.get('block-void-navigation')).toMatchObject({
      plugin: 'media',
      routes: ['images', 'embeds'],
    })
    expect(() =>
      createSlateBrowserPluginContractRegistry([
        defineSlateBrowserPluginContract({
          plugin: 'first',
          rows: [
            {
              assertions: ['one'],
              family: 'duplicate-family',
              routes: ['richtext'],
            },
          ],
        }),
        defineSlateBrowserPluginContract({
          plugin: 'second',
          rows: [
            {
              assertions: ['two'],
              family: 'duplicate-family',
              routes: ['plaintext'],
            },
          ],
        }),
      ])
    ).toThrow(/registered more than once/)
  })

  test('locks the first legacy parity slice into a fast contract guard', () => {
    const result = assertSlateBrowserFirstPartyParityContracts()
    const parityFamilies = SLATE_BROWSER_FIRST_LEGACY_PARITY_FAMILIES.map(
      (family) => family.family
    )

    expect(result.parityFamilies).toEqual(parityFamilies)
    expect(parityFamilies).toEqual([
      'inline-void-boundary-navigation',
      'block-void-navigation',
      'external-decoration-refresh',
      'mouse-selection-toolbar',
      'table-cell-boundary-navigation',
    ])
    expect(
      SLATE_BROWSER_FIRST_PARTY_PLUGIN_CONTRACT_REGISTRY.rows.map((row) => [
        row.plugin,
        row.family,
        row.routes,
      ])
    ).toEqual(
      expect.arrayContaining([
        ['mentions', 'inline-void-boundary-navigation', ['mentions']],
        ['media', 'block-void-navigation', ['images', 'embeds']],
        [
          'external-decorations',
          'external-decoration-refresh',
          ['search-highlighting'],
        ],
        ['selection-ui', 'mouse-selection-toolbar', ['hovering-toolbar']],
        ['table', 'table-cell-boundary-navigation', ['tables']],
      ])
    )
  })

  test('keeps generated stress parity out of the default check script', () => {
    const packageJsonPath = fileURLToPath(
      new URL('../../../../package.json', import.meta.url)
    )
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
    }
    const scripts = packageJson.scripts

    expect(scripts.check).not.toContain('test:stress')
    expect(scripts.check).not.toContain('test:integration-local')
    expect(scripts.check).not.toContain('check:full')
    expect(scripts['test:stress']).toContain(
      'playwright/stress/generated-editing.test.ts'
    )
    expect(scripts['test:stress']).toContain('PLAYWRIGHT_RETRIES=0')
    expect(scripts['test:release-proof']).toContain('test:persistent-soak')
    expect(scripts['test:release-proof']).not.toContain(
      'test:mobile-device-proof:raw'
    )
    expect(scripts['check:full']).toContain('test:release-proof')
    expect(scripts['check:full']).toContain('test:integration-local')
  })

  test('summarizes reduction candidates without serializing step functions', () => {
    const steps: SlateBrowserScenarioStep[] = [
      {
        kind: 'custom',
        label: 'custom-step',
        run: () => {},
      },
      { kind: 'type', label: 'type-step', text: 'A' },
    ]
    const candidate = createScenarioReductionCandidates(steps)[0]

    expect(summarizeScenarioReductionCandidate(candidate)).toEqual({
      kind: 'prefix',
      label: 'prefix:1',
      removedRange: { end: 2, start: 1 },
      replay: {
        replayable: false,
        steps: [
          {
            kind: 'custom',
            label: 'custom-step',
            replayable: false,
            value: {
              kind: 'custom',
              label: 'custom-step',
            },
          },
        ],
      },
      stepLabels: ['custom-step'],
    })
  })

  test('serializes replayable scenario steps with action payloads', () => {
    const step: SlateBrowserScenarioStep = {
      iteration: 2,
      kind: 'select',
      label: 'select-word',
      selection: {
        anchor: { path: [0, 0], offset: 1 },
        focus: { path: [0, 0], offset: 5 },
      },
      warmLoop: 'warm-toolbar',
    }

    expect(serializeScenarioStepForReplay(step, 0)).toEqual({
      iteration: 2,
      kind: 'select',
      label: 'select-word',
      replayable: true,
      value: {
        iteration: 2,
        kind: 'select',
        label: 'select-word',
        selection: {
          anchor: { path: [0, 0], offset: 1 },
          focus: { path: [0, 0], offset: 5 },
        },
        warmLoop: 'warm-toolbar',
      },
      warmLoop: 'warm-toolbar',
    })
  })

  test('serializes rendered DOM shape assertions for replay', () => {
    const step: SlateBrowserScenarioStep = {
      kind: 'assertRenderedDOMShape',
      label: 'assert-first-block-dom-shape',
      shape: {
        blockIndex: 0,
        domSelectionTarget: {
          anchorPath: [0, 0],
          isCollapsed: true,
        },
        lineBoxCount: { max: 1 },
        noUnexpectedZeroWidthBreaks: true,
        textContent: 'alpha',
        zeroWidthBreakCount: 0,
      },
    }

    expect(serializeScenarioStepForReplay(step, 0)).toEqual({
      iteration: undefined,
      kind: 'assertRenderedDOMShape',
      label: 'assert-first-block-dom-shape',
      replayable: true,
      value: {
        kind: 'assertRenderedDOMShape',
        label: 'assert-first-block-dom-shape',
        shape: {
          blockIndex: 0,
          domSelectionTarget: {
            anchorPath: [0, 0],
            isCollapsed: true,
          },
          lineBoxCount: { max: 1 },
          noUnexpectedZeroWidthBreaks: true,
          textContent: 'alpha',
          zeroWidthBreakCount: 0,
        },
      },
      warmLoop: undefined,
    })
  })

  test('serializes replayable browser stress assertion steps', () => {
    const steps: SlateBrowserScenarioStep[] = [
      {
        kind: 'dragTextSelection',
        label: 'drag-toolbar-target',
        selector: 'span[data-slate-string="true"]',
        steps: 12,
      },
      {
        kind: 'assertLocatorCount',
        label: 'assert-highlights',
        min: 1,
        selector: '[data-cy="search-highlighted"]',
      },
      {
        kind: 'assertLocatorCss',
        label: 'assert-toolbar-visible',
        property: 'opacity',
        selector: '[data-test-id="menu"]',
        value: '1',
      },
      {
        afterSelector: 'p',
        beforeSelector: 'input[type="text"]',
        kind: 'assertLocatorVerticalGap',
        label: 'assert-embed-gap',
        max: 24,
        min: 12,
      },
      {
        innerSelector: '[contenteditable="false"]',
        kind: 'assertLocatorVerticalOffset',
        label: 'assert-image-offset',
        max: 1,
        min: 0,
        selector: '[data-slate-path="1"]',
      },
      {
        kind: 'assertModelSelectionExpanded',
        label: 'assert-model-selection-expanded',
      },
      {
        contains: 'mode:both',
        kind: 'assertLocatorText',
        label: 'assert-overlay-mode',
        selector: '#external-decoration-mode',
      },
      {
        kind: 'clickSelector',
        label: 'click-overlay-button',
        selector: 'button:has-text("Show both diagnostics")',
      },
      {
        kind: 'captureRuntimeId',
        label: 'capture-image-runtime-id',
        name: 'image',
        path: [1],
      },
      {
        kind: 'applyOperations',
        label: 'remote-remove-image',
        operations: [
          {
            type: 'remove_node',
            path: [1],
            node: { type: 'image', url: 'image.png', children: [{ text: '' }] },
          },
        ],
        tag: 'remote-import',
      },
      {
        kind: 'assertCapturedRuntimeIdPath',
        label: 'assert-image-runtime-id-null',
        name: 'image',
        path: null,
      },
      {
        kind: 'assertLastCommitTags',
        label: 'assert-remote-tags',
        tags: ['remote-import'],
      },
      {
        kind: 'assertWindowSelectionText',
        label: 'assert-native-selection',
        notEmpty: true,
      },
      {
        budget: {
          byKind: {
            editable: { max: 0 },
            element: 0,
          },
          total: { max: 2 },
        },
        kind: 'assertRenderBudget',
        label: 'assert-render-budget',
      },
      {
        kind: 'resetRenderProfiler',
        label: 'reset-render-profiler',
      },
    ]

    expect(createScenarioReplay(steps).replayable).toBe(true)
    expect(createScenarioReplay(steps).steps.map((step) => step.kind)).toEqual([
      'dragTextSelection',
      'assertLocatorCount',
      'assertLocatorCss',
      'assertLocatorVerticalGap',
      'assertLocatorVerticalOffset',
      'assertModelSelectionExpanded',
      'assertLocatorText',
      'clickSelector',
      'captureRuntimeId',
      'applyOperations',
      'assertCapturedRuntimeIdPath',
      'assertLastCommitTags',
      'assertWindowSelectionText',
      'assertRenderBudget',
      'resetRenderProfiler',
    ])
  })

  test('marks custom scenario steps as non-replayable without serializing functions', () => {
    const replay = createScenarioReplay([
      {
        kind: 'custom',
        label: 'custom-step',
        run: () => {},
      },
      { kind: 'type', label: 'type-step', text: 'A' },
    ])

    expect(replay).toEqual({
      replayable: false,
      steps: [
        {
          kind: 'custom',
          label: 'custom-step',
          replayable: false,
          value: {
            kind: 'custom',
            label: 'custom-step',
          },
        },
        {
          kind: 'type',
          label: 'type-step',
          replayable: true,
          value: {
            kind: 'type',
            label: 'type-step',
            text: 'A',
          },
        },
      ],
    })
  })

  test('creates replayable warm toolbar arrow gauntlet steps', () => {
    const replay = createScenarioReplay(
      createSlateBrowserWarmToolbarArrowGauntlet({
        domCaretAfterInsert: {
          offset: 9,
          text: 'editableW',
        },
        insertedText: 'W',
        markDOMSelection: {
          anchorNodeText: 'This is editable ',
          anchorOffset: 8,
          focusNodeText: 'This is editable ',
          focusOffset: 16,
        },
        markButtonTestId: 'mark-button-bold',
        markSelection: {
          anchor: { path: [0, 0], offset: 8 },
          focus: { path: [0, 0], offset: 16 },
        },
        selectedText: 'editable',
        selectionAfterArrowLeft: {
          anchor: { path: [0, 1], offset: 7 },
          focus: { path: [0, 1], offset: 7 },
        },
        selectionAfterCollapse: {
          anchor: { path: [0, 1], offset: 8 },
          focus: { path: [0, 1], offset: 8 },
        },
        selectionAfterInsert: {
          anchor: { path: [0, 1], offset: 9 },
          focus: { path: [0, 1], offset: 9 },
        },
        textAfterInsert:
          'This is editableW rich text, much better than a <textarea>!',
        warmIterations: 1,
      })
    )

    expect(replay.replayable).toBe(true)
    expect(replay.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'clickTestId',
          label: 'warm-bold-on-1',
          value: expect.objectContaining({
            kind: 'clickTestId',
            testId: 'mark-button-bold',
          }),
        }),
        expect.objectContaining({
          kind: 'settle',
          label: 'warm-wait-after-bold-on-1',
          value: expect.objectContaining({
            kind: 'settle',
            timeoutMs: 25,
          }),
        }),
        expect.objectContaining({
          kind: 'assertSelectedText',
          label: 'assert-selection-expanded-after-bold-on-1',
          value: expect.objectContaining({
            kind: 'assertSelectedText',
            text: 'editable',
          }),
        }),
      ])
    )
  })

  test('creates replayable generated command-family gauntlet helpers', () => {
    const collapsed = {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 1 },
    }
    const selected = {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 4 },
    }
    const point = { path: [0, 0], offset: 2 }
    const helpers = [
      createSlateBrowserInternalControlGauntlet({
        controlSelector: '[data-testid="internal-control"]',
        controlValue: 'inner',
        followUpText: 'Z',
        outerSelection: collapsed,
        textAfterFollowUp: 'textZ',
      }),
      createSlateBrowserCompositionGauntlet({
        committedText: 'é',
        selection: collapsed,
        steps: ['e', 'é'],
        text: 'é',
        textAfterComposition: 'texté',
        transport: 'synthetic',
      }),
      createSlateBrowserShellActivationGauntlet({
        buttonName: 'Open editor',
        expectedSelection: collapsed,
      }),
      createSlateBrowserInlineCutTypingGauntlet({
        domShape: {
          afterCut: {
            blockIndex: 0,
            noUnexpectedZeroWidthBreaks: true,
          },
          afterTyping: {
            blockIndex: 0,
            noUnexpectedZeroWidthBreaks: true,
            textContent: 'textZ',
          },
        },
        replacementText: 'Z',
        selection: selected,
        textAfterTyping: 'textZ',
      }),
      createSlateBrowserToolbarMarkClickTypingGauntlet({
        clickPoint: point,
        insertedText: 'Z',
        markButtonTestId: 'mark-button-bold',
        markSelection: selected,
        selectionAfterInsert: collapsed,
        textAfterInsert: 'textZ',
      }),
      createSlateBrowserMixedEditingConformanceGauntlet({
        deleteKey: 'Backspace',
        domShape: {
          afterDelete: {
            blockIndex: 0,
            noUnexpectedZeroWidthBreaks: true,
            textContent: 'text',
          },
          afterFollowUp: {
            blockIndex: 0,
            noUnexpectedZeroWidthBreaks: true,
            textContent: 'textZ',
          },
          afterInsert: {
            blockIndex: 0,
            noUnexpectedZeroWidthBreaks: true,
            textContent: 'textZ',
          },
        },
        insertedText: 'Z',
        navigationKeys: ['ArrowRight'],
        selectionAfterDelete: collapsed,
        selectionAfterFollowUp: collapsed,
        selectionAfterInsert: collapsed,
        selectionAfterNavigation: collapsed,
        startSelection: collapsed,
        textAfterDelete: 'text',
        textAfterFollowUp: 'textZ',
        textAfterInsert: 'textZ',
        toolbarButtonTestId: 'mark-button-bold',
        toolbarSelection: selected,
        toolbarSelectionAfterCommand: selected,
      }),
      createSlateBrowserSemanticEditingConformanceGauntlet({
        insertedText: 'Z',
        selectionAfterDelete: collapsed,
        selectionAfterFollowUp: collapsed,
        selectionAfterInsert: collapsed,
        startSelection: collapsed,
        textAfterDelete: 'text',
        textAfterFollowUp: 'textZ',
        textAfterInsert: 'textZ',
        toolbarButtonTestId: 'mark-button-bold',
        toolbarSelection: selected,
        toolbarSelectionAfterCommand: selected,
      }),
    ]

    for (const steps of helpers) {
      expect(createScenarioReplay(steps).replayable).toBe(true)
    }
  })

  test('creates replayable generated destructive editing gauntlet steps', () => {
    const steps = createSlateBrowserDestructiveEditingGauntlet({
      domShape: {
        afterDeleteAfterPaste: {
          blockIndex: 0,
          noUnexpectedZeroWidthBreaks: true,
          textContent: 'Past text',
        },
        afterFollowUp: {
          blockIndex: 0,
          noUnexpectedZeroWidthBreaks: true,
          textContent: 'Past! text',
        },
        afterPaste: {
          blockIndex: 0,
          noUnexpectedZeroWidthBreaks: true,
          textContent: 'Paste text',
        },
        afterWordDeleteFollowUp: {
          blockIndex: 0,
          noUnexpectedZeroWidthBreaks: true,
        },
        afterWordDeleteIterations: [
          {
            blockIndex: 0,
            noUnexpectedZeroWidthBreaks: true,
          },
          {
            blockIndex: 0,
            noUnexpectedZeroWidthBreaks: true,
          },
        ],
      },
      followUpText: '!',
      pasteSelection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 4 },
      },
      pastedText: 'Paste',
      selectionAfterDeleteAfterPaste: {
        anchor: { path: [0, 0], offset: 4 },
        focus: { path: [0, 0], offset: 4 },
      },
      selectionAfterFollowUp: {
        anchor: { path: [0, 0], offset: 5 },
        focus: { path: [0, 0], offset: 5 },
      },
      selectionAfterPaste: {
        anchor: { path: [0, 0], offset: 5 },
        focus: { path: [0, 0], offset: 5 },
      },
      tailBlockTextsAfterWordDelete: ['tail'],
      textAfterDeleteAfterPaste: 'Past text',
      textAfterFollowUp: 'Past! text',
      textAfterPaste: 'Paste text',
      wordDeleteIterations: 2,
      wordDeleteSelection: {
        anchor: { path: [0, 1], offset: 4 },
        focus: { path: [0, 1], offset: 4 },
      },
    })

    expect(createScenarioReplay(steps).replayable).toBe(true)
    expect(steps.map((step) => step.label)).toEqual(
      expect.arrayContaining([
        'paste-over-selected-range',
        'assert-dom-shape-after-paste',
        'delete-after-paste-Backspace',
        'assert-dom-shape-after-delete-after-paste',
        'assert-dom-shape-after-delete-follow-up',
        'word-delete-backward-1',
        'assert-dom-shape-after-word-delete-1',
        'word-delete-backward-2',
        'assert-dom-shape-after-word-delete-2',
        'assert-tail-blocks-after-word-delete-follow-up',
        'assert-dom-shape-after-word-delete-follow-up',
      ])
    )
    expect(
      createScenarioReductionCandidates(steps).some(
        (candidate) =>
          candidate.kind === 'single-step' &&
          createScenarioReplay(candidate.steps).replayable
      )
    ).toBe(true)
  })

  test('creates generated warm loop steps with iteration labels', () => {
    const steps = createSlateBrowserWarmLoopSteps({
      createIteration: (iteration) => [
        { kind: 'focus', label: `focus-${iteration}` },
        { kind: 'type', label: `type-${iteration}`, text: `${iteration}` },
      ],
      label: 'warm-toolbar',
      iterations: 2,
    })

    expect(steps.map((step) => step.label)).toEqual([
      'focus-1',
      'type-1',
      'focus-2',
      'type-2',
    ])
    expect(
      steps.map((step) => ({
        iteration: step.iteration,
        warmLoop: step.warmLoop,
      }))
    ).toEqual([
      { iteration: 1, warmLoop: 'warm-toolbar' },
      { iteration: 1, warmLoop: 'warm-toolbar' },
      { iteration: 2, warmLoop: 'warm-toolbar' },
      { iteration: 2, warmLoop: 'warm-toolbar' },
    ])
  })

  test('creates iteration-level reduction candidates for warm loops', () => {
    const steps = createSlateBrowserWarmLoopSteps({
      createIteration: (iteration) => [
        { kind: 'focus', label: `focus-${iteration}` },
        { kind: 'type', label: `type-${iteration}`, text: `${iteration}` },
      ],
      label: 'warm-toolbar',
      iterations: 2,
    })

    const summaries = createScenarioReductionCandidates(steps).map(
      summarizeScenarioReductionCandidate
    )

    expect(summaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'iteration',
          label: 'warm-toolbar:iteration:1',
          removedRange: { end: 2, start: 0 },
          stepLabels: ['focus-2', 'type-2'],
        }),
        expect.objectContaining({
          kind: 'iteration',
          label: 'warm-toolbar:iteration:2',
          removedRange: { end: 4, start: 2 },
          stepLabels: ['focus-1', 'type-1'],
        }),
      ])
    )
  })

  test('normalizes scenario metadata for stable trace artifacts', () => {
    expect(
      normalizeScenarioMetadata({
        capabilities: ['selection', 'keyboard', 'selection'],
        platform: 'chromium',
        transport: 'native-keyboard',
      })
    ).toEqual({
      capabilities: ['keyboard', 'selection'],
      claim: 'desktop-native-keyboard',
      platform: 'chromium',
      transport: 'native-keyboard',
    })

    expect(normalizeScenarioMetadata()).toEqual({
      capabilities: [],
      claim: 'unspecified',
      platform: null,
      transport: null,
    })
  })

  test('classifies mobile transports without upgrading semantic handles to native proof', () => {
    expect(
      classifyScenarioTransportClaim({
        platform: 'mobile',
        transport: 'semantic-handle',
      })
    ).toBe('mobile-semantic-handle')
    expect(
      classifyScenarioTransportClaim({
        platform: 'mobile',
        transport: 'keyboard-and-handle',
      })
    ).toBe('mobile-semantic-handle')
    expect(
      classifyScenarioTransportClaim({
        platform: 'mobile',
        transport: 'synthetic-datatransfer-drop',
      })
    ).toBe('synthetic-datatransfer')
    expect(
      classifyScenarioTransportClaim({
        platform: 'mobile',
        transport: 'synthetic-composition',
      })
    ).toBe('mobile-synthetic-composition')
    expect(
      classifyScenarioTransportClaim({
        platform: 'chromium',
        transport: 'native-composition',
      })
    ).toBe('desktop-native-ime-composition')
  })
})
