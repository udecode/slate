import { expect, test } from '@playwright/test'
import { openExample } from 'slate-browser/playwright'

test.describe('table example', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/tables')
  })

  test('table tag rendered', async ({ page }) => {
    await expect(page.getByRole('textbox').locator('table')).toHaveCount(1)
  })

  test('keeps Backspace from crossing table-cell start', async ({ page }) => {
    const editor = await openExample(page, 'tables', {
      ready: { editor: 'visible' },
    })

    await editor.selection.collapse({ path: [1, 1, 0, 0], offset: 0 })
    await editor.root.press('Backspace')

    await expect(editor.root.locator('table')).toHaveCount(1)
    await expect(editor.root.locator('table')).toContainText('# of Feet')
    await editor.assert.selection({
      anchor: { path: [1, 1, 0, 0], offset: 0 },
      focus: { path: [1, 1, 0, 0], offset: 0 },
    })
  })

  test('keeps Delete from crossing table-cell end', async ({ page }) => {
    const editor = await openExample(page, 'tables', {
      ready: { editor: 'visible' },
    })

    await editor.selection.collapse({ path: [1, 0, 1, 0], offset: 5 })
    await editor.root.press('Delete')

    await expect(editor.root.locator('table')).toHaveCount(1)
    await expect(editor.root.locator('table')).toContainText('Human')
    await editor.assert.selection({
      anchor: { path: [1, 0, 1, 0], offset: 5 },
      focus: { path: [1, 0, 1, 0], offset: 5 },
    })
  })

  test('keeps Enter from splitting inside a table cell', async ({ page }) => {
    const editor = await openExample(page, 'tables', {
      ready: { editor: 'visible' },
    })

    await editor.selection.collapse({ path: [1, 0, 1, 0], offset: 2 })
    await editor.root.press('Enter')

    await expect(editor.root.locator('table')).toHaveCount(1)
    await expect(editor.root.locator('table')).toContainText('Human')
    await editor.assert.selection({
      anchor: { path: [1, 0, 1, 0], offset: 2 },
      focus: { path: [1, 0, 1, 0], offset: 2 },
    })
  })

  test('moves right from an empty cell to the start of the next cell', async ({
    page,
  }) => {
    const editor = await openExample(page, 'tables', {
      ready: { editor: 'visible' },
    })

    await editor.root.locator('td').first().click()
    await editor.root.press('ArrowRight')

    await editor.assert.selection({
      anchor: { path: [1, 0, 1, 0], offset: 0 },
      focus: { path: [1, 0, 1, 0], offset: 0 },
    })
  })
})
