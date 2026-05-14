import { expect, test } from '@playwright/test'

test.describe('yjs collaboration example', () => {
  test('syncs document edits, awareness cursors, and paused peer recovery', async ({
    page,
  }) => {
    await page.goto('/examples/yjs-collaboration')

    await expect(page.locator('#yjs-left-text')).toHaveText(
      'Alpha shared document'
    )
    await expect(page.locator('#yjs-right-text')).toHaveText(
      'Alpha shared document'
    )
    await expect(page.locator('#yjs-left-connection')).toHaveText('connected')
    await expect(page.locator('#yjs-right-connection')).toHaveText('connected')

    await page.getByRole('button', { name: 'Left insert' }).click()
    await expect(page.locator('#yjs-right-text')).toHaveText(
      'Alpha shared document!'
    )
    await expect(page.locator('#yjs-left-exports')).toHaveText('out 1')
    await expect(page.locator('#yjs-right-imports')).toContainText('in')

    await page.getByRole('button', { name: 'Right insert' }).click()
    await expect(page.locator('#yjs-left-text')).toHaveText(
      'Alpha shared document!?'
    )

    await page.getByRole('button', { name: 'Left selection' }).click()
    await expect(page.locator('#yjs-right-cursors')).toContainText('Left:1-5')
    await expect(
      page.locator('[data-test-id="yjs-right-remote-cursor-segment"]')
    ).toContainText('lpha')

    await page.getByRole('button', { name: 'Pause right' }).click()
    await expect(page.locator('#yjs-right-connection')).toHaveText('paused')
    await page.getByRole('button', { name: 'Left insert' }).click()
    await expect(page.locator('#yjs-left-text')).toHaveText(
      'Alpha shared document!?!'
    )
    await expect(page.locator('#yjs-right-text')).toHaveText(
      'Alpha shared document!?'
    )

    await page.getByRole('button', { name: 'Resume right' }).click()
    await expect(page.locator('#yjs-right-connection')).toHaveText('connected')
    await expect(page.locator('#yjs-right-text')).toHaveText(
      'Alpha shared document!?!'
    )

    await page.getByRole('button', { name: 'Unicode' }).click()
    await expect(page.locator('#yjs-shared-text')).toContainText(
      'Iñtërnâtiônàlizætiøn☃💩'
    )
    await expect(page.locator('#yjs-right-text')).toContainText(
      'Iñtërnâtiônàlizætiøn☃💩'
    )
  })
})
