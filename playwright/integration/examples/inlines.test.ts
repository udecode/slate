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

  test('wraps pasted URL text as a link command', async ({
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

    await editor.selection.collapse({ path: [0, 0], offset: 0 })
    await editor.clipboard.pasteText('https://example.com')

    const link = editor.root.locator('a[href="https://example.com/"]')
    await expect(link).toHaveCount(1)
    await expect(link).toContainText('https://example.com')

    await editor.type(' after')

    await expect(link).not.toContainText('after')
    await expect
      .poll(async () =>
        (await editor.get.blockTexts())[0]?.replaceAll('\u00A0', '')
      )
      .toContain('https://example.com afterIn addition to block nodes')
  })

  test('places Enter after a typed inline link outside the link', async ({
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

    await editor.selection.collapse({ path: [0, 0], offset: 0 })
    await editor.insertText('https://example.com')
    await editor.press('Enter')

    const link = editor.root.locator('a[href="https://example.com/"]')
    await expect(link).toHaveCount(1)
    await expect(link).toContainText('https://example.com')
    await editor.assert.selection({
      anchor: { path: [1, 0], offset: 0 },
      focus: { path: [1, 0], offset: 0 },
    })

    await editor.type('outside ')

    await expect(link).not.toContainText('outside')
    await expect
      .poll(async () =>
        (await editor.get.blockTexts())[1]?.replaceAll('\u00A0', '')
      )
      .toContain('outside In addition to block nodes')
  })

  test('types inside an editable inline at its end', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName !== 'chromium' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'inlines', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.selectDOM({
      anchor: { path: [0, 1, 0], offset: 'hyperlink'.length },
      focus: { path: [0, 1, 0], offset: 'hyperlink'.length },
    })
    await page.keyboard.insertText(' inside')

    await expect(editor.root.locator('a').first()).toContainText(
      'hyperlink inside'
    )
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [0, 1, 0], offset: 'hyperlink inside'.length },
        focus: { path: [0, 1, 0], offset: 'hyperlink inside'.length },
      })
  })

  test('keeps the start of following text distinct from the end of an inline', async ({
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

    await editor.selection.selectDOM({
      anchor: { path: [0, 2], offset: 0 },
      focus: { path: [0, 2], offset: 0 },
    })
    await editor.assert.domSelectionTarget({
      anchorOffset: 0,
      anchorPath: [0, 2],
      isCollapsed: true,
    })

    await page.keyboard.insertText(' outside')

    await expect(editor.root.locator('a').first()).toContainText('hyperlink')
    await expect(editor.root.locator('a').first()).not.toContainText('outside')
    await expect
      .poll(async () =>
        (await editor.get.blockTexts())[0]?.replaceAll('\u00A0', '')
      )
      .toContain('Here is a hyperlink outside, and here is')
  })

  test('pastes content outside inline link boundaries without expanding the link', async ({
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
    const beforeLinkText =
      'In addition to block nodes, you can create inline nodes. Here is a '

    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: beforeLinkText.length },
      focus: { path: [0, 0], offset: beforeLinkText.length },
    })
    await editor.clipboard.pasteText('before ')

    await editor.selection.selectDOM({
      anchor: { path: [0, 2], offset: 0 },
      focus: { path: [0, 2], offset: 0 },
    })
    await editor.clipboard.pasteHtml('<strong>after</strong> ', 'after ')

    const link = editor.root.locator('a').first()

    await expect(link).toContainText('hyperlink')
    await expect(link).not.toContainText('before')
    await expect(link).not.toContainText('after')
    await expect
      .poll(async () =>
        (await editor.get.blockTexts())[0]?.replaceAll('\u00A0', '')
      )
      .toContain('Here is a before hyperlinkafter , and here is')
  })

  test('replaces selected text adjacent to inline link boundaries with rich content', async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === 'mobile') {
      return
    }

    let editor = await openExample(page, 'inlines', {
      ready: {
        editor: 'visible',
      },
    })
    const beforeLinkText =
      'In addition to block nodes, you can create inline nodes. Here is a '
    const selectedBeforeLinkText = 'Here is a '

    await editor.selection.selectDOM({
      anchor: {
        path: [0, 0],
        offset: beforeLinkText.length - selectedBeforeLinkText.length,
      },
      focus: { path: [0, 0], offset: beforeLinkText.length },
    })
    await editor.clipboard.pasteHtml('<strong>replaced</strong>', 'replaced')

    let link = editor.root.locator('a').first()
    await expect(link).toContainText('hyperlink')
    await expect(link).not.toContainText('replaced')
    await expect
      .poll(async () =>
        (await editor.get.blockTexts())[0]?.replaceAll('\u00A0', '')
      )
      .toContain('inline nodes. replacedhyperlink, and here is')

    await page.goto('/examples/inlines')
    editor = await openExample(page, 'inlines', {
      ready: {
        editor: 'visible',
      },
    })
    const selectedAfterLinkText = ', and here'

    await editor.selection.selectDOM({
      anchor: { path: [0, 2], offset: 0 },
      focus: { path: [0, 2], offset: selectedAfterLinkText.length },
    })
    await editor.clipboard.pasteHtml('<em>replaced</em>', 'replaced')

    link = editor.root.locator('a').first()
    await expect(link).toContainText('hyperlink')
    await expect(link).not.toContainText('replaced')
    await expect
      .poll(async () =>
        (await editor.get.blockTexts())[0]?.replaceAll('\u00A0', '')
      )
      .toContain('Here is a hyperlinkreplaced is a more unusual inline')
  })

  test('replaces selected inline link text with rich content outside the surviving link', async ({
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

    await editor.selection.selectDOM({
      anchor: { path: [0, 1, 0], offset: 0 },
      focus: { path: [0, 1, 0], offset: 'hyper'.length },
    })
    await editor.clipboard.pasteHtml('<strong>replaced</strong>', 'replaced')

    const link = editor.root.locator('a').first()
    const beforeLinkText =
      'In addition to block nodes, you can create inline nodes. Here is a '

    await expect(link).toContainText('link')
    await expect(link).not.toContainText('replaced')
    await expect
      .poll(async () =>
        (await editor.get.blockTexts())[0]?.replaceAll('\u00A0', '')
      )
      .toContain('Here is a replacedlink, and here is')
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: {
          path: [0, 0],
          offset: beforeLinkText.length + 'replaced'.length,
        },
        focus: {
          path: [0, 0],
          offset: beforeLinkText.length + 'replaced'.length,
        },
      })
  })

  test('places the caret outside a padded inline before typing', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName !== 'chromium' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'inlines', {
      ready: {
        editor: 'visible',
      },
    })
    const beforeButtonText = ', and here is a more unusual inline: an '

    await editor.selection.selectDOM({
      anchor: { path: [0, 2], offset: beforeButtonText.length },
      focus: { path: [0, 2], offset: beforeButtonText.length },
    })
    await editor.assert.domSelectionTarget({
      anchorOffset: beforeButtonText.length,
      anchorPath: [0, 2],
      isCollapsed: true,
    })

    const caretRect = await editor.selection.rect()
    const buttonLeft = await editor.root
      .locator('[data-slate-path="0,3"]')
      .first()
      .evaluate((element) => element.getBoundingClientRect().left)

    expect(caretRect).not.toBeNull()
    expect(caretRect!.x).toBeLessThanOrEqual(buttonLeft + 1)
  })

  test('removes an empty editable inline with Backspace without deleting preceding text', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName !== 'chromium' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'inlines', {
      ready: {
        editor: 'visible',
      },
    })
    const beforeButtonText = ', and here is a more unusual inline: an '
    const buttonText = 'editable button'

    await editor.selection.selectDOM({
      anchor: { path: [0, 3, 0], offset: 0 },
      focus: { path: [0, 3, 0], offset: buttonText.length },
    })
    await page.keyboard.press('Backspace')

    await expect
      .poll(async () =>
        (await editor.get.blockTexts())[0]?.replaceAll('\u00A0', '')
      )
      .toContain(`${beforeButtonText}! Here is a read-only inline`)
    await editor.assert.selection({
      anchor: { path: [0, 3, 0], offset: 0 },
      focus: { path: [0, 3, 0], offset: 0 },
    })
    await editor.assert.domSelectionTarget({
      anchorOffset: 1,
      anchorPath: [0, 3, 0],
      isCollapsed: true,
    })

    await page.keyboard.press('Backspace')

    await expect
      .poll(async () =>
        (await editor.get.blockTexts())[0]?.replaceAll('\u00A0', '')
      )
      .toContain(`${beforeButtonText}! Here is a read-only inline`)
    await expect
      .poll(async () =>
        (await editor.get.blockTexts())[0]?.replaceAll('\u00A0', '')
      )
      .not.toContain(', and here is a more unusual inline: a! Here')
    expect(await editor.get.selection()).not.toBe(null)
    await editor.assert.domSelectionTarget({
      isCollapsed: true,
    })
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
            reason: 'model-horizontal-inline-void',
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
