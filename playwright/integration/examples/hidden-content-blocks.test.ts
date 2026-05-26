import { expect, test } from '@playwright/test'

import { openExample } from 'slate-browser/playwright'

test.describe('hidden content blocks example', () => {
  test('keeps accordion and inactive tab content out of the DOM until materialized', async ({
    page,
  }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    const editor = await openExample(page, 'hidden-content-blocks', {
      ready: {
        editor: 'visible',
        text: /Open hidden accordion body/,
      },
    })

    await expect(editor.root).not.toContainText('Accordion secret alpha')
    await expect(editor.root).not.toContainText('Details tab hidden text')
    await expect(
      editor.root.locator('[data-slate-dom-coverage-boundary]')
    ).toHaveCount(2)
    await expect(
      page.getByTestId('hidden-content-native-surface')
    ).toContainText('degraded')

    await page.getByTestId('accordion-materialize').click()
    await expect(editor.root).toContainText('Accordion secret alpha')
    await expect(editor.root).toContainText('Accordion secret beta')

    await page.getByTestId('tab-details-materialize').click()
    await expect(editor.root).toContainText('Details tab hidden text')
    await expect(editor.root).not.toContainText('Overview tab visible text')
    await expect.poll(() => pageErrors).toEqual([])
  })

  test('copies model-backed hidden accordion and tab content while DOM is absent', async ({
    page,
  }) => {
    const editor = await openExample(page, 'hidden-content-blocks', {
      ready: {
        editor: 'visible',
        text: /Open hidden accordion body/,
      },
    })

    await expect(editor.root).not.toContainText('Accordion secret alpha')
    await page.getByTestId('select-copy-accordion').click()
    await expect(page.getByTestId('hidden-content-copy-preview')).toContainText(
      'Accordion secret alpha'
    )

    await expect(editor.root).not.toContainText('Details tab hidden text')
    await page.getByTestId('select-copy-details').click()
    await expect(page.getByTestId('hidden-content-copy-preview')).toContainText(
      'Details tab hidden text'
    )
  })
})
