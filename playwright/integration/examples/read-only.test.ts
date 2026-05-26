import { expect, test } from '@playwright/test'

test.describe('readonly editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/read-only')
  })

  test('should not be editable', async ({ page }) => {
    const slateEditor = '[data-slate-editor="true"]'
    const editor = page.locator(slateEditor)
    const initialText = await editor.textContent()

    expect(await editor.getAttribute('contentEditable')).toBe('true')
    expect(await editor.getAttribute('aria-readonly')).toBe('true')
    expect(await editor.getAttribute('role')).toBe('textbox')
    await expect(editor).toHaveCSS('caret-color', 'rgba(0, 0, 0, 0)')
    await editor.click()
    await page.keyboard.type('not editable')

    await expect(editor).toBeFocused()
    await expect(editor).toHaveText(initialText ?? '')
  })
})
