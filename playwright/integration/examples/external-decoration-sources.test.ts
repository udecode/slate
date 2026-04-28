import { expect, test } from '@playwright/test'

import { openExample } from 'slate-browser/playwright'

test.describe('external decoration sources', () => {
  test('refreshes app-owned overlay state through the external projection store', async ({
    page,
  }) => {
    const editor = await openExample(page, 'external-decoration-sources', {
      ready: {
        editor: 'visible',
      },
    })

    await expect(page.locator('#external-decoration-mode')).toHaveText(
      'mode:alpha'
    )
    await expect(page.locator('#external-decoration-tone')).toHaveText(
      'tone:warm'
    )
    await expect(page.locator('[data-external-tone="warm"]')).toHaveCount(1)

    await page.getByRole('button', { name: 'Show both diagnostics' }).click()

    await expect(page.locator('#external-decoration-mode')).toHaveText(
      'mode:both'
    )
    await expect(page.locator('[data-external-tone="warm"]')).toHaveCount(2)
    await expect(page.locator('#external-decoration-snapshot')).toContainText(
      'diagnostic-alpha'
    )
    await expect(page.locator('#external-decoration-snapshot')).toContainText(
      'diagnostic-beta'
    )

    await page.getByRole('button', { name: 'Rotate tone' }).click()

    await expect(page.locator('#external-decoration-tone')).toHaveText(
      'tone:cool'
    )
    await expect(page.locator('#external-decoration-update')).toHaveText(
      'last-update:refresh({ reason: "external", sourceId: "external-diagnostics" })'
    )
    await expect(page.locator('[data-external-tone="cool"]')).toHaveCount(2)

    await page.getByRole('button', { name: 'Clear diagnostics' }).click()

    await expect(page.locator('#external-decoration-mode')).toHaveText(
      'mode:none'
    )
    await expect(page.locator('[data-external-tone]')).toHaveCount(0)
    await expect(page.locator('#external-decoration-snapshot')).toHaveText(
      'none'
    )

    await editor.assert.text(
      'External diagnostics can highlight editor content without pretending the data lives inside the Slate document.Use this when search hits, review overlays, or remote diagnostics are owned by app state outside the editor snapshot.'
    )
  })
})
