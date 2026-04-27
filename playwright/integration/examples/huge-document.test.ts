import { expect, test } from '@playwright/test'

const hugeDocumentReadyTimeout = 90 * 1000

test.setTimeout(120 * 1000)

test.describe('huge document example', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/huge-document', {
      waitUntil: 'commit',
    })
    await expect(page.getByLabel('Blocks')).toHaveValue('10000')
    // This route intentionally mounts 10k nodes. Keep the integration proof
    // patient under full-suite parallelism; perf regressions belong to the
    // dedicated huge-document benchmarks.
    await expect(page.getByRole('textbox')).toBeVisible({
      timeout: hugeDocumentReadyTimeout,
    })
  })

  test('renders huge document without child-count chunking', async ({
    page,
  }) => {
    await expect(page.getByLabel('Blocks')).toHaveValue('10000')
    await expect(page.locator('[data-slate-chunk]')).toHaveCount(0)
    await expect(page.getByRole('textbox')).toBeVisible()
  })
})
