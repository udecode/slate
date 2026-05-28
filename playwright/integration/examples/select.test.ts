import { expect, test } from '@playwright/test'

test.describe('selection', () => {
  const slateEditor = '[data-slate-node="element"]'
  test.beforeEach(async ({ page }) => await page.goto('/examples/richtext'))
  test('select the correct block when triple clicking', async ({ page }) => {
    // triple clicking the second block (paragraph) shouldn't highlight the
    // quote button
    await page.locator(slateEditor).nth(1).click({ clickCount: 3 })
    const quoteButton = page.getByTestId('block-button-block-quote')
    await expect(quoteButton).not.toHaveClass(/is-active/)
  })
})
