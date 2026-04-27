import { expect, test } from '@playwright/test'
import {
  assertNoIllegalKernelTransitions,
  createSlateBrowserInlineCutTypingGauntlet,
  openExample,
} from 'slate-browser/playwright'

test.describe('Inlines example', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/inlines')
  })

  test('contains link', async ({ page }) => {
    expect(
      await page.getByRole('textbox').locator('a').nth(0).innerText()
    ).toContain('hyperlink')
  })

  test('wraps typed URL text as a link command', async ({ page }) => {
    const editor = await openExample(page, 'inlines', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.collapse({ path: [0, 0], offset: 0 })
    await editor.insertText('https://example.com')

    const link = editor.root.locator('a[href="https://example.com/"]')
    await expect(link).toHaveCount(1)
    await expect(link).toContainText('https://example.com')
  })

  test('arrow keys skip over read-only inline', async ({ page }) => {
    const editor = await openExample(page, 'inlines', {
      ready: {
        editor: 'visible',
      },
    })
    const beforeBadgeText = '! Here is a read-only inline: '

    await editor.selection.collapse({ path: [0, 6], offset: 0 })
    await editor.focus()
    await editor.assert.selection({
      anchor: { path: [0, 6], offset: 0 },
      focus: { path: [0, 6], offset: 0 },
    })

    await editor.root.press('ArrowLeft')
    await editor.assert.selection({
      anchor: { path: [0, 4], offset: beforeBadgeText.length },
      focus: { path: [0, 4], offset: beforeBadgeText.length },
    })

    await editor.root.press('ArrowRight')
    await editor.assert.selection({
      anchor: { path: [0, 6], offset: 0 },
      focus: { path: [0, 6], offset: 0 },
    })
    expect(await editor.get.kernelTrace()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: expect.objectContaining({
            axis: 'horizontal',
            kind: 'move-selection',
          }),
          eventFamily: 'keydown',
          movement: expect.objectContaining({
            axis: 'horizontal',
            ownership: 'model-owned',
            reason: 'model-horizontal-inline-void-compat',
          }),
        }),
      ])
    )
  })

  test('keeps caret editable after cutting inline link text', async ({
    page,
  }, testInfo) => {
    const editor = await openExample(page, 'inlines', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.select({
      anchor: { path: [0, 1, 0], offset: 0 },
      focus: { path: [0, 1, 0], offset: 'hyperlink'.length },
    })

    await editor.root.press('ControlOrMeta+X')

    if (
      testInfo.project.name !== 'mobile' &&
      testInfo.project.name !== 'webkit'
    ) {
      expect(await editor.clipboard.readText()).toBe('hyperlink')
    }
    await expect(
      editor.root.locator('a').filter({ hasText: 'hyperlink' })
    ).toHaveCount(0)
    if (testInfo.project.name === 'mobile') {
      return
    }
    expect(await editor.get.selection()).not.toBe(null)

    await editor.type('LINK')

    await editor.assert.text(
      /Here is a LINK, and here is a more unusual inline/
    )
    expect(await editor.get.selection()).not.toBe(null)
  })

  test('runs generated inline cut typing gauntlet without illegal kernel transitions', async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'inlines', {
      ready: {
        editor: 'visible',
      },
    })

    const result = await editor.scenario.run(
      'inlines-generated-cut-typing-gauntlet',
      createSlateBrowserInlineCutTypingGauntlet({
        domShape: {
          afterCut: {
            blockIndex: 0,
            noUnexpectedZeroWidthBreaks: true,
            zeroWidthBreakCount: 0,
          },
          afterTyping: {
            blockIndex: 0,
            noUnexpectedZeroWidthBreaks: true,
            zeroWidthBreakCount: 0,
          },
        },
        replacementText: 'LINK',
        selection: {
          anchor: { path: [0, 1, 0], offset: 0 },
          focus: { path: [0, 1, 0], offset: 'hyperlink'.length },
        },
        textAfterTyping: 'LINK',
      }),
      {
        metadata: {
          capabilities: ['inline-boundary', 'keyboard-cut', 'kernel-trace'],
          platform: testInfo.project.name,
          transport: 'native-keyboard',
        },
        tracePath: testInfo.outputPath('inlines-cut-typing-gauntlet.json'),
      }
    )

    assertNoIllegalKernelTransitions(result)
    await expect(
      editor.root.locator('a').filter({ hasText: 'hyperlink' })
    ).toHaveCount(0)
  })
})
