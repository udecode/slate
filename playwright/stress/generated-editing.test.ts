import { expect, test } from '@playwright/test'
import {
  assertNoIllegalKernelTransitions,
  openExample,
} from 'slate-browser/playwright'

import {
  createStressArtifact,
  type StressCase,
  stressArtifactPath,
  stressResultPath,
  writeStressArtifact,
} from './stress-utils'

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

const selectAllMultilinePaste = (route: string): StressCase => ({
  family: 'select-all-multiline-paste',
  id: `${seed}-${route}-select-all-multiline-paste`,
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
  ],
})

const selectAllTypeDeleteUndo = (route: string): StressCase => ({
  family: 'select-all-type-delete-undo',
  id: `${seed}-${route}-select-all-type-delete-undo`,
  route,
  steps: [
    { kind: 'selectAll', label: 'select-all' },
    { kind: 'type', label: 'type-seed', text: 'Seed' },
    {
      kind: 'assertBlockTexts',
      label: 'assert-seed-text',
      texts: ['Seed'],
    },
    { kind: 'assertLastCommit', label: 'assert-type-commit' },
    { key: 'Backspace', kind: 'press', label: 'delete-last-character' },
    {
      kind: 'assertBlockTexts',
      label: 'assert-after-delete',
      texts: ['See'],
    },
    {
      expectedModelTextBefore: 'See',
      kind: 'undo',
      label: 'undo-delete',
    },
    {
      kind: 'assertBlockTexts',
      label: 'assert-after-undo',
      texts: ['Seed'],
    },
    { kind: 'type', label: 'type-follow-up', text: '!' },
    {
      kind: 'assertBlockTexts',
      label: 'assert-follow-up-text',
      texts: ['Seed!'],
    },
  ],
})

const stressCases: StressCase[] = [
  ...['plaintext', 'richtext', 'forced-layout']
    .filter(routeEnabled)
    .map(selectAllMultilinePaste),
  ...['plaintext', 'richtext']
    .filter(routeEnabled)
    .map(selectAllTypeDeleteUndo),
].filter((stressCase) => familyEnabled(stressCase.family))

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
        projectName: testInfo.project.name,
        resultPath,
        status: 'running',
        stressCase,
      })
    )

    try {
      const editor = await openExample(page, stressCase.route, {
        ready: { editor: 'visible' },
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

      assertNoIllegalKernelTransitions(result)
      expect(result.replay.replayable).toBe(true)

      writeStressArtifact(
        artifactPath,
        createStressArtifact({
          projectName: testInfo.project.name,
          reductionCandidates: result.reductionCandidates,
          resultPath,
          status: 'passed',
          stressCase,
        })
      )
    } catch (error) {
      writeStressArtifact(
        artifactPath,
        createStressArtifact({
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
