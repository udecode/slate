import { expect, test } from '@playwright/test'
import { openExample } from 'slate-browser/playwright'

test.describe('plaintext example', () => {
  test.beforeEach(async ({ page }) => await page.goto('/examples/plaintext'))

  test('inserts text when typed', async ({ page }) => {
    const insertedText = ' Hello World'
    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.click()
    await editor.press('End')
    await page.keyboard.insertText(insertedText)

    await expect(editor.root).toContainText(insertedText)
    expect(await editor.get.text()).toContain(insertedText)
  })

  test('imports document.execCommand insertText into editor state', async ({
    page,
  }) => {
    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.selectAll()
    await editor.root.evaluate((element: HTMLElement) => {
      element.focus()
      document.execCommand('insertText', false, 'foo')
    })

    await editor.assert.text('foo')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })
  })

  test('imports synthetic ClipboardEvent paste data into editor state', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'firefox',
      'Firefox blocks synthetic ClipboardEvent paste data'
    )

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.selectAll()
    await editor.root.evaluate((element: HTMLElement) => {
      const data = new DataTransfer()
      data.setData('text/plain', 'foo')
      element.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        })
      )
    })

    await editor.assert.text('foo')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })
  })
})
