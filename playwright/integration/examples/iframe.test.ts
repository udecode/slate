import { expect, test } from '@playwright/test'

test.describe('iframe editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/iframe')
  })

  test('should be editable', async ({ page }) => {
    const slateErrors: string[] = []
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        message.text().includes('without a DOM coverage boundary')
      ) {
        slateErrors.push(message.text())
      }
    })

    const textbox = page
      .frameLocator('iframe')
      .locator('body')
      .getByRole('textbox')

    await textbox.evaluate((element: HTMLElement) => {
      const handle = (element as Record<string, any>).__slateBrowserHandle

      if (!handle?.selectRange || !handle?.insertText) {
        throw new Error('Missing Slate browser handle')
      }

      handle.selectRange({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      })
      handle.insertText('Hello World')
    })
    await expect(textbox).toContainText('Hello World')
    await page.waitForTimeout(50)
    expect(slateErrors).toEqual([])
  })
})
