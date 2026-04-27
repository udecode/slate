import { expect, test } from '@playwright/test'
import { openExample } from 'slate-browser/playwright'

test.describe('embeds example', () => {
  const slateEditor = 'div[data-slate-editor="true"]'

  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/embeds')
  })

  test('contains embeded', async ({ page }) => {
    await expect(page.locator(slateEditor).locator('iframe')).toHaveCount(1)
  })

  test('does not let the hidden void spacer add visible height after the url input', async ({
    page,
  }) => {
    await expect(page.locator('input[type="text"]')).toBeVisible()
    await expect(page.getByText('Try it out!')).toBeVisible()

    const gap = await page.evaluate(() => {
      const editor = document.querySelector('[data-slate-editor="true"]')
      const input = editor?.querySelector('input[type="text"]')
      const nextParagraph = Array.from(
        editor?.querySelectorAll('p') ?? []
      ).find((paragraph) => paragraph.textContent?.startsWith('Try it out!'))

      if (!(input instanceof HTMLElement) || !nextParagraph) {
        throw new Error('Expected embeds example input and following paragraph')
      }

      return (
        nextParagraph.getBoundingClientRect().top -
        input.getBoundingClientRect().bottom
      )
    })

    expect(gap).toBeGreaterThanOrEqual(12)
    expect(gap).toBeLessThanOrEqual(24)
  })

  test('moves from the first paragraph into the embed before the next paragraph', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName !== 'chromium' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'embeds', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 177 },
      focus: { path: [0, 0], offset: 177 },
    })
    await editor.assert.domSelectionTarget({
      anchorOffset: 177,
      anchorPath: [0, 0],
      isCollapsed: true,
    })

    await page.keyboard.press('ArrowRight')
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 0 },
      })
    await editor.assert.domSelectionTarget({
      anchorOffset: 0,
      anchorPath: [1, 0],
      isCollapsed: true,
    })

    await page.keyboard.press('ArrowRight')
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [2, 0], offset: 0 },
        focus: { path: [2, 0], offset: 0 },
      })
    await editor.assert.domSelectionTarget({
      anchorOffset: 0,
      anchorPath: [2, 0],
      isCollapsed: true,
    })
  })
})
