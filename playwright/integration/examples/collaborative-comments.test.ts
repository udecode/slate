import { expect, type Page, test } from '@playwright/test'

const selectReviewerIntro = async (page: Page) => {
  await page.locator('#collab-comments-reviewer').evaluate((root) => {
    const document = root.ownerDocument
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let textNode: Node | null = null

    let nextNode = walker.nextNode()

    while (nextNode) {
      if (nextNode.textContent?.startsWith('The writer owns this')) {
        textNode = nextNode
        break
      }

      nextNode = walker.nextNode()
    }

    if (!textNode?.textContent) {
      throw new Error('Reviewer intro text node was not found')
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

test.describe('collaborative comments example', () => {
  test('keeps read-only reviewer comments off the document channel', async ({
    page,
  }) => {
    await page.goto('/examples/collaborative-comments')
    await expect(page.locator('#collab-comments-reviewer')).toBeVisible()
    await expect(page.locator('#collab-comments-reviewer')).toContainText(
      'The writer owns this document channel'
    )

    await expect(page.locator('#collab-comments-document-writes')).toHaveText(
      '0'
    )
    await expect(page.locator('#collab-comments-comment-writes')).toHaveText(
      '0'
    )
    await expect(
      page.locator('#collab-comments-reviewer-document-writes')
    ).toHaveText('0')

    await selectReviewerIntro(page)
    await expect(
      page.getByRole('button', { name: 'Add comment' })
    ).toBeEnabled()
    await page.getByRole('button', { name: 'Add comment' }).click()

    await expect(page.locator('#collab-comments-document-writes')).toHaveText(
      '0'
    )
    await expect(page.locator('#collab-comments-comment-writes')).toHaveText(
      '1'
    )
    await expect(page.locator('[data-comment-tone="review"]')).toHaveCount(2)
    await expect(page.locator('#collab-comments-reviewer')).toContainText(
      'The writer owns this'
    )

    await page.getByRole('button', { name: 'Insert prefix' }).click()

    await expect(page.locator('#collab-comments-document-writes')).toHaveText(
      '1'
    )
    await expect(page.locator('#collab-comments-comment-writes')).toHaveText(
      '1'
    )
    await expect(page.locator('text=range:0.0:1|0.0:25')).toHaveCount(2)

    await page.getByRole('button', { name: 'Update body' }).click()

    await expect(page.locator('#collab-comments-document-writes')).toHaveText(
      '1'
    )
    await expect(page.locator('#collab-comments-comment-writes')).toHaveText(
      '2'
    )
    await expect(
      page.locator('#collab-comments-reviewer-document-writes')
    ).toHaveText('0')
    await expect(
      page.locator('text=Updated from the comment channel.')
    ).toHaveCount(2)
  })
})
