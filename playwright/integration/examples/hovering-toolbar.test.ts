import { expect, type Locator, type Page, test } from '@playwright/test'

test.describe('hovering toolbar example', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/hovering-toolbar')
  })

  const selectTextWithMouse = async (locator: Locator) => {
    const box = await locator.boundingBox()

    if (!box) {
      throw new Error('Expected selectable text to have a bounding box')
    }

    const y = box.y + box.height / 2
    await locator.page().mouse.move(box.x + 5, y)
    await locator.page().mouse.down()
    await locator
      .page()
      .mouse.move(box.x + Math.min(box.width - 5, 260), y, { steps: 12 })
    await locator.page().mouse.up()
  }

  const hasExpandedModelSelection = async (page: Page) => {
    return page.locator('[data-slate-editor]').evaluate((element) => {
      const selection = (element as any).__slateBrowserHandle?.getSelection?.()

      if (!selection) {
        return false
      }

      return (
        selection.anchor.offset !== selection.focus.offset ||
        selection.anchor.path.join(',') !== selection.focus.path.join(',')
      )
    })
  }

  test('hovering toolbar appears', async ({ page }) => {
    await expect(page.getByTestId('menu')).toHaveCSS('opacity', '0')

    await page.locator('span[data-slate-string="true"]').nth(0).selectText()
    await expect(page.getByTestId('menu')).toHaveCount(1)

    await expect(page.getByTestId('menu')).toHaveCSS('opacity', '1')
    await expect(
      page.getByTestId('menu').locator('span.material-icons')
    ).toHaveCount(3)
  })

  test('hovering toolbar appears after real mouse selection', async ({
    page,
  }) => {
    await expect(page.getByTestId('menu')).toHaveCSS('opacity', '0')

    await selectTextWithMouse(
      page.locator('span[data-slate-string="true"]').first()
    )

    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
      .not.toBe('')
    await expect.poll(() => hasExpandedModelSelection(page)).toBe(true)
    await expect(page.getByTestId('menu')).toHaveCSS('opacity', '1')
    await expect(page.getByTestId('menu')).not.toHaveCSS('top', '-10000px')
    await expect(page.getByTestId('menu')).not.toHaveCSS('left', '-10000px')
  })

  test('hovering toolbar disappears', async ({ page }) => {
    await page.locator('span[data-slate-string="true"]').nth(0).selectText()
    await expect(page.getByTestId('menu')).toHaveCSS('opacity', '1')
    await page.locator('span[data-slate-string="true"]').nth(0).selectText()
    await page
      .locator('div')
      .nth(0)
      .click({ force: true, position: { x: 0, y: 0 } })
    await expect(page.getByTestId('menu')).toHaveCSS('opacity', '0')
  })
})
