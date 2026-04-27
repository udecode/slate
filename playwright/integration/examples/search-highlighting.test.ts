import { expect, test } from '@playwright/test'

test.describe('search highlighting', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/search-highlighting', {
      waitUntil: 'domcontentloaded',
    })
    await expect(page.getByRole('textbox')).toHaveCount(1)
  })

  test('highlights the searched text', async ({ page }) => {
    const searchField = 'input[type="search"]'
    const highlightedText = 'search-highlighted'

    await page.locator(searchField).fill('text')
    await expect(page.locator(`[data-cy="${highlightedText}"]`)).toHaveCount(2)
  })

  test('keeps focus in search input after the editor was focused', async ({
    page,
  }) => {
    const searchField = page.locator('input[type="search"]')
    const highlightedText = 'search-highlighted'

    await page.locator('[data-slate-editor="true"]').click()
    await searchField.click()
    await page.keyboard.type('t')

    await expect(searchField).toBeFocused()
    await expect(searchField).toHaveValue('t')
    await expect(
      page.locator(`[data-cy="${highlightedText}"]`)
    ).not.toHaveCount(0)
  })
})
