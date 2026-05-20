import { expect, type Locator, type Page, test } from '@playwright/test'
import {
  createSlateBrowserEditorHarness,
  installSlateReactRenderProfiler,
  openExample,
  recordSlateBrowserRuntimeErrors,
  resetSlateReactRenderProfiler,
  takeSlateBrowserRenderStateSnapshot,
} from 'slate-browser/playwright'

test.describe('hovering toolbar example', () => {
  test.beforeEach(async ({ page }) => {
    await installSlateReactRenderProfiler(page)
    await page.goto('/examples/hovering-toolbar')
  })

  const selectTextWithMouse = async (locator: Locator) => {
    const box = await locator.boundingBox()

    if (!box) {
      throw new Error('Expected selectable text to have a bounding box')
    }

    const y = box.y + box.height / 2
    await locator.page().mouse.move(box.x + 5, y)
    await locator.page().mouse.down()
    await locator
      .page()
      .mouse.move(box.x + Math.min(box.width - 5, 260), y, { steps: 12 })
    await locator.page().mouse.up()
  }

  const hasExpandedModelSelection = async (page: Page) => {
    return page.locator('[data-slate-editor]').evaluate((element) => {
      const selection = (element as any).__slateBrowserHandle?.getSelection?.()

      if (!selection) {
        return false
      }

      return (
        selection.anchor.offset !== selection.focus.offset ||
        selection.anchor.path.join(',') !== selection.focus.path.join(',')
      )
    })
  }

  test('hovering toolbar appears', async ({ page }) => {
    await expect(page.getByTestId('menu')).toHaveCSS('opacity', '0')

    await page.locator('span[data-slate-string="true"]').nth(0).selectText()
    await expect(page.getByTestId('menu')).toHaveCount(1)

    await expect(page.getByTestId('menu')).toHaveCSS('opacity', '1')
    await expect(
      page.getByTestId('menu').locator('span.material-icons')
    ).toHaveCount(3)
  })

  test('hovering toolbar appears after real mouse selection', async ({
    page,
  }) => {
    const editor = createSlateBrowserEditorHarness(
      page,
      'hovering-toolbar',
      page.locator('[data-slate-editor="true"]')
    )

    await expect(page.getByTestId('menu')).toHaveCSS('opacity', '0')

    await resetSlateReactRenderProfiler(page)
    await selectTextWithMouse(
      page.locator('span[data-slate-string="true"]').first()
    )

    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
      .not.toBe('')
    await expect.poll(() => hasExpandedModelSelection(page)).toBe(true)
    await expect(page.getByTestId('menu')).toHaveCSS('opacity', '1')
    await expect(page.getByTestId('menu')).not.toHaveCSS('top', '-10000px')
    await expect(page.getByTestId('menu')).not.toHaveCSS('left', '-10000px')

    const proof = await takeSlateBrowserRenderStateSnapshot(editor)

    expect(proof.selection).not.toBeNull()
    expect(proof.focusOwner.kind).toBe('editor')
    expect(proof.renderCounts.byKind.editable ?? 0).toBe(0)
    expect(proof.renderCounts.total).toBe(0)
  })

  test('hovering toolbar disappears', async ({ page }) => {
    await page.locator('span[data-slate-string="true"]').nth(0).selectText()
    await expect(page.getByTestId('menu')).toHaveCSS('opacity', '1')
    await page.locator('span[data-slate-string="true"]').nth(0).selectText()
    await page
      .locator('div')
      .nth(0)
      .click({ force: true, position: { x: 0, y: 0 } })
    await expect(page.getByTestId('menu')).toHaveCSS('opacity', '0')
  })

  test('typing English over selected formatted text does not crash', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile',
      'Desktop replacement text repro'
    )
    test.skip(
      testInfo.project.name === 'firefox',
      'Firefox native double-click replacement selection differs'
    )

    const runtimeErrors = recordSlateBrowserRuntimeErrors(page)
    const editor = await openExample(page, 'hovering-toolbar', {
      ready: {
        editor: 'visible',
        text: /This example shows/,
      },
    })
    const boldWord = editor.root.locator('strong', { hasText: 'bold' }).first()

    try {
      await boldWord.dblclick()
      await expect
        .poll(() =>
          page.evaluate(() => window.getSelection()?.toString() ?? '')
        )
        .toBe('bold')

      await page.keyboard.insertText('plain')

      runtimeErrors.assertNone()
      await expect(editor.root).toContainText('plain')
      await expect(
        editor.root.locator('strong', { hasText: 'bold' })
      ).toHaveCount(0)
    } finally {
      runtimeErrors.stop()
    }
  })

  test('native format beforeinput routes through the semantic command handler', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium native proof')

    const editor = await openExample(page, 'hovering-toolbar', {
      ready: {
        editor: 'visible',
        text: /This example shows/,
      },
    })

    await editor.click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('Backspace')
    await page.keyboard.insertText('hello')
    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 5 },
    })

    const prevented = await editor.root.evaluate((element) => {
      const event = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'formatBold',
      }) as InputEvent & { getTargetRanges: () => StaticRange[] }

      event.getTargetRanges = () => []
      element.dispatchEvent(event)

      return event.defaultPrevented
    })

    expect(prevented).toBe(true)
    await expect(editor.root.locator('strong')).toHaveText('hello')
  })

  test('keeps hovering toolbar hidden during IME composition', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium CDP IME proof')

    const editor = await openExample(page, 'hovering-toolbar', {
      ready: {
        editor: 'visible',
        text: /This example shows/,
      },
    })

    await expect(page.getByTestId('menu')).toHaveCSS('opacity', '0')

    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })
    await editor.ime.enableKeyEvents()

    const client = await page.context().newCDPSession(page)

    await client.send('Input.imeSetComposition', {
      selectionEnd: 1,
      selectionStart: 0,
      text: 'ｓ',
    })
    await client.send('Input.imeSetComposition', {
      selectionEnd: 1,
      selectionStart: 0,
      text: 'す',
    })
    await client.send('Input.imeSetComposition', {
      selectionEnd: 2,
      selectionStart: 0,
      text: 'すｓ',
    })
    await client.send('Input.imeSetComposition', {
      selectionEnd: 3,
      selectionStart: 0,
      text: 'すｓｈ',
    })

    await expect(page.getByTestId('menu')).toHaveCSS('opacity', '0')

    await client.send('Input.insertText', { text: 'すし' })
    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 2 },
    })

    await expect(page.getByTestId('menu')).toHaveCSS('opacity', '1')
  })
})
