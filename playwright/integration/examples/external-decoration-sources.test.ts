import { expect, test } from '@playwright/test'

import { openExample } from 'slate-browser/playwright'

test.describe('linting', () => {
  test('refreshes app-owned lint diagnostics through an external decoration source', async ({
    page,
  }) => {
    const editor = await openExample(page, 'external-decoration-sources', {
      ready: {
        editor: 'visible',
      },
    })

    await expect(page.locator('.example-page-title')).toContainText('Linting')
    await expect(page.locator('#linting-source')).toHaveText('source:idle')
    await expect(page.locator('#linting-count')).toHaveText('issues:0')
    await expect(page.locator('[data-lint-severity]')).toHaveCount(0)

    await page.getByRole('button', { name: 'Run linter' }).click()

    await expect(page.locator('#linting-source')).toHaveText('source:local')
    await expect(page.locator('#linting-count')).toHaveText('issues:2')
    await expect(page.locator('[data-lint-severity="warning"]')).toHaveCount(1)
    await expect(page.locator('[data-lint-severity="error"]')).toHaveCount(1)
    await expect(page.locator('#linting-snapshot')).toContainText(
      'style-filler-word'
    )
    await expect(page.locator('#linting-snapshot')).toContainText(
      'comma-spacing'
    )

    await page.getByRole('button', { name: 'Apply first fix' }).click()

    await expect(page.locator('#linting-source')).toHaveText('source:fixed')
    await expect(page.locator('#linting-count')).toHaveText('issues:1')
    await expect(page.locator('[data-lint-severity="error"]')).toHaveCount(0)
    await expect(page.locator('#linting-snapshot')).not.toContainText(
      'comma-spacing'
    )

    await page
      .getByRole('button', { name: 'Receive server diagnostics' })
      .click()

    await expect(page.locator('#linting-source')).toHaveText('source:server')
    await expect(page.locator('#linting-count')).toHaveText('issues:2')
    await expect(page.locator('[data-lint-severity="info"]')).toHaveCount(1)
    await expect(page.locator('#linting-snapshot')).toContainText(
      'server-terminology'
    )

    await editor.assert.text(
      'This paragraph obviously has a spacing problem, and the linter should report it.Server diagnostics can arrive later without changing the Slate document.'
    )

    await page.getByRole('button', { name: 'Clear diagnostics' }).click()

    await expect(page.locator('#linting-source')).toHaveText('source:cleared')
    await expect(page.locator('#linting-count')).toHaveText('issues:0')
    await expect(page.locator('[data-lint-severity]')).toHaveCount(0)
    await expect(page.locator('#linting-snapshot')).toHaveText('none')
  })
})
