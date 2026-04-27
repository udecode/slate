import { expect, test } from '@playwright/test'

test.describe('images example', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/images')
  })

  test('contains image', async ({ page }) => {
    await expect(page.getByRole('textbox').locator('img')).toHaveCount(2)
  })

  test('does not insert invalid image URL from prompt', async ({ page }) => {
    page.on('dialog', async (dialog) => {
      if (dialog.type() === 'prompt') {
        await dialog.accept('https://example.com/not-an-image.txt')
        return
      }

      await dialog.accept()
    })

    await page.locator('span.material-icons', { hasText: 'image' }).click()

    await expect(page.getByRole('textbox').locator('img')).toHaveCount(2)
  })

  test('deletes selected image', async ({ page }) => {
    const editor = page.getByRole('textbox')
    const firstImage = editor.locator('img').first()

    await firstImage.click()
    await page.getByRole('button', { name: 'delete' }).click()

    await expect(editor.locator('img')).toHaveCount(1)
  })
})
