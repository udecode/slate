import { expect, test } from '@playwright/test'
import {
  openExample,
  recordSlateBrowserRuntimeErrors,
} from 'slate-browser/playwright'

test.describe('example navigation metadata', () => {
  test('renders only current-state alpha badges', async ({ page }) => {
    const runtimeErrors = recordSlateBrowserRuntimeErrors(page)

    try {
      await openExample(page, 'richtext', {
        ready: {
          editor: 'visible',
        },
      })

      await page.getByLabel('Toggle examples menu').click()

      const navigation = page.getByLabel('Examples navigation')

      await expect(navigation).toBeVisible()
      await expect(navigation.locator('.example-badge')).toHaveCount(1)
      await expect(
        navigation.getByRole('menuitem', { name: /Pagination Alpha/ })
      ).toBeVisible()
      await expect(
        navigation
          .getByRole('menuitem', { name: /Pagination Alpha/ })
          .locator('.example-badge')
      ).toHaveText('Alpha')
      await expect(navigation.locator('.example-badge-new')).toHaveCount(0)
      await expect(navigation.getByText('New', { exact: true })).toHaveCount(0)
      await expect(
        navigation
          .getByRole('menuitem', { name: 'Comment Mode' })
          .locator('.example-badge')
      ).toHaveCount(0)

      runtimeErrors.assertNone()
    } finally {
      runtimeErrors.stop()
    }
  })
})
