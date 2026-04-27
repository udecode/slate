import { expect, test } from '@playwright/test'

import { openExample } from 'slate-browser/playwright'

test.describe('review comments example', () => {
  test('keeps comment sidebar, inline review slices, and widget panel in sync', async ({
    page,
  }) => {
    const editor = await openExample(page, 'review-comments', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.select({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 24 },
    })

    await page.getByRole('button', { name: 'Add comment on selection' }).click()

    await expect(page.locator('#review-comments-selection')).toContainText(
      '0.0:0|0.0:24'
    )
    await expect(page.locator('[data-comment-tone]')).toHaveCount(1)
    await expect(page.locator('[data-comment-tone="review"]')).toHaveCount(1)
    await expect(page.locator('#comment-card-comment-1')).toHaveCount(1)
    await expect(page.locator('text=comment-1-widget:Comment 1')).toHaveCount(1)

    await page
      .getByRole('button', { name: 'Insert paragraph before first comment' })
      .click()

    await expect(page.locator('[data-comment-tone="review"]')).toHaveCount(1)
    await expect(
      page.locator('text=Inserted review context before the first comment.')
    ).toBeVisible()
    await expect(page.locator('#comment-card-comment-1')).toHaveCount(1)
    await expect(page.locator('text=comment-1-widget:Comment 1')).toHaveCount(1)

    await page
      .getByRole('button', { name: 'Insert prefix before first comment' })
      .click()

    await expect(page.locator('[data-comment-tone="review"]')).toHaveCount(1)
    await expect(page.locator('text=comment-1-widget:Comment 1')).toHaveCount(1)

    await page.getByRole('button', { name: 'Clear comments' }).click()

    await expect(page.locator('#comment-card-comment-1')).toHaveCount(0)
    await expect(page.locator('text=comment-1-widget:Comment 1')).toHaveCount(0)
  })
})
