import { expect, test } from '@playwright/test'
import { openExample } from 'slate-browser/playwright'

test.setTimeout(60 * 1000)

test.describe('code highlighting', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/code-highlighting')
    await expect(page.getByTestId('code-block-button')).toBeVisible()
  })

  test('renders semantic token projections', async ({ page }) => {
    const editor = page.locator('[data-slate-editor]')

    await expect(editor).toContainText('const initialValue')
    await expect(editor.locator('.token').first()).toBeVisible()
    await expect(editor.locator('.keyword').first()).toBeVisible()
    await expect(editor.locator('.string').first()).toBeVisible()
    await expect(editor.locator('.punctuation').first()).toBeVisible()
  })

  test('Enter inside a code line creates another line in the same code block', async ({
    page,
  }) => {
    const editor = await openExample(page, 'code-highlighting', {
      ready: {
        editor: 'visible',
        text: /const initialValue/,
      },
    })

    await editor.selection.collapse({ path: [1, 0, 0], offset: 6 })
    await editor.focus()
    await editor.root.press('Enter')

    await expect(
      editor.root.locator(':scope > [data-slate-node="element"]')
    ).toHaveCount(5)
    await expect(editor.locator.block([1, 0])).toHaveText('// Add')
    await expect(editor.locator.block([1, 1])).toHaveText(' the initial value.')
    await editor.assert.selection({
      anchor: { path: [1, 1, 0], offset: 0 },
      focus: { path: [1, 1, 0], offset: 0 },
    })
  })
})
