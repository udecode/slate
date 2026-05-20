import { expect, type Page, test } from '@playwright/test'

import { openExample } from 'slate-browser/playwright'

const selectCommentModeIntro = async (page: Page) => {
  await page.locator('#comment-mode').evaluate((root) => {
    const document = root.ownerDocument
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let textNode: Node | null = null

    let nextNode = walker.nextNode()

    while (nextNode) {
      if (nextNode.textContent?.startsWith('Comment mode in Slate v2')) {
        textNode = nextNode
        break
      }

      nextNode = walker.nextNode()
    }

    if (!textNode?.textContent) {
      throw new Error('Comment mode intro text node was not found')
    }

    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 24)

    const selection = document.defaultView?.getSelection()

    if (!selection) {
      throw new Error('Window selection is unavailable')
    }

    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
}

test.describe('comment mode example', () => {
  test('keeps comment sidebar, inline review slices, and widget panel in sync', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'webkit',
      'WebKit drops the programmatic review selection before the toolbar action'
    )

    await openExample(page, 'comment-mode', {
      ready: {
        editor: 'visible',
      },
    })

    await selectCommentModeIntro(page)
    await expect(
      page.getByRole('button', { name: 'Add comment on selection' })
    ).toBeEnabled()
    await expect(page.locator('#comment-mode-selection')).toContainText(
      '0.0:0|0.0:24'
    )

    await page.getByRole('button', { name: 'Add comment on selection' }).click()

    await expect(page.locator('#comment-card-comment-1')).toContainText(
      'range:0.0:0|0.0:24'
    )
    await expect(page.locator('#comment-mode-document-writes')).toHaveText('0')
    await expect(page.locator('#comment-mode-comment-writes')).toHaveText('1')
    await expect(page.locator('#comment-mode-read-only-writes')).toHaveText('0')
    await expect(page.locator('[data-comment-tone]')).toHaveCount(2)
    await expect(page.locator('[data-comment-tone="review"]')).toHaveCount(2)
    await expect(page.locator('#comment-card-comment-1')).toHaveCount(1)
    await expect(page.locator('text=comment-1-widget:Comment 1')).toHaveCount(1)

    await page
      .getByRole('button', { name: 'Insert paragraph before first comment' })
      .click()

    await expect(page.locator('#comment-mode-document-writes')).toHaveText('1')
    await expect(page.locator('#comment-mode-comment-writes')).toHaveText('1')
    await expect(page.locator('[data-comment-tone="review"]')).toHaveCount(2)
    await expect(
      page.locator('text=Inserted review context before the first comment.')
    ).toHaveCount(2)
    await expect(page.locator('#comment-card-comment-1')).toHaveCount(1)
    await expect(page.locator('text=comment-1-widget:Comment 1')).toHaveCount(1)

    await page
      .getByRole('button', { name: 'Insert prefix before first comment' })
      .click()

    await expect(page.locator('#comment-mode-document-writes')).toHaveText('2')
    await expect(page.locator('#comment-mode-comment-writes')).toHaveText('1')
    await expect(page.locator('[data-comment-tone="review"]')).toHaveCount(2)
    await expect(page.locator('text=comment-1-widget:Comment 1')).toHaveCount(1)

    await page.getByRole('button', { name: 'Update first comment' }).click()

    await expect(page.locator('#comment-mode-document-writes')).toHaveText('2')
    await expect(page.locator('#comment-mode-comment-writes')).toHaveText('2')
    await expect(page.locator('#comment-mode-read-only-writes')).toHaveText('0')
    await expect(
      page.locator('text=Updated from the comment channel.')
    ).toHaveCount(1)

    await page.getByRole('button', { name: 'Toggle resolved' }).click()

    await expect(page.locator('#comment-mode-document-writes')).toHaveText('2')
    await expect(page.locator('#comment-mode-comment-writes')).toHaveText('3')
    await expect(page.locator('#comment-mode-read-only-writes')).toHaveText('0')
    await expect(page.locator('[data-comment-status="resolved"]')).toHaveCount(
      2
    )

    await page.getByRole('button', { name: 'Clear comments' }).click()

    await expect(page.locator('#comment-mode-comment-writes')).toHaveText('4')
    await expect(page.locator('#comment-card-comment-1')).toHaveCount(0)
    await expect(page.locator('text=comment-1-widget:Comment 1')).toHaveCount(0)
    await expect(page.locator('[data-comment-tone]')).toHaveCount(0)
  })
})
