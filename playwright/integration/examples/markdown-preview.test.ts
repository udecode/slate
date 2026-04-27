import { expect, test } from '@playwright/test'

import { openExample } from 'slate-browser/playwright'

test.describe('markdown preview', () => {
  test('checks for markdown', async ({ page }) => {
    const insertedHeading = '## Added markdown heading'

    const editor = await openExample(page, 'markdown-preview', {
      ready: {
        editor: 'visible',
        text: /Try it out for yourself!/,
      },
    })

    await editor.selection.collapse({ path: [2, 0], offset: 24 })
    await editor.insertBreak()
    await editor.insertText(insertedHeading)
    await editor.insertBreak()

    await expect(editor.root).toContainText(insertedHeading)
  })
})
