import { expect, test } from '@playwright/test'

test.describe('readonly editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/read-only')
  })

  test('should not be editable', async ({ page }) => {
    const slateEditor = '[data-slate-editor="true"]'
    const editor = page.locator(slateEditor)
    const initialText = await editor.textContent()

    expect(await editor.getAttribute('contentEditable')).toBe('false')
    expect(await editor.getAttribute('role')).toBe(null)
    await editor.click()
    await page.keyboard.insertText('not editable')

    await expect(editor).not.toBeFocused()
    await expect(editor).toHaveText(initialText ?? '')
  })
})
