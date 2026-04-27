import { expect, test } from '@playwright/test'
import { openExample } from 'slate-browser/playwright'

test.describe('On markdown-shortcuts example', () => {
  test.beforeEach(
    async ({ page }) => await page.goto('/examples/markdown-shortcuts')
  )

  const openMarkdownShortcuts = async (
    page: Parameters<typeof openExample>[0]
  ) => {
    const editor = await openExample(page, 'markdown-shortcuts', {
      ready: {
        editor: 'visible',
        text: /A wise quote\./,
      },
    })

    await expect(editor.root.locator('blockquote')).toContainText(
      'A wise quote.'
    )

    return editor
  }

  test('contains quote', async ({ page }) => {
    const editor = await openMarkdownShortcuts(page)

    expect(await editor.root.locator('blockquote').textContent()).toContain(
      'A wise quote.'
    )
  })

  test('can add list items', async ({ page }) => {
    const editor = await openMarkdownShortcuts(page)
    const textbox = editor.root

    await expect(textbox.locator('ul')).toHaveCount(0)

    await editor.selection.collapse({ path: [0, 0], offset: 0 })
    await editor.insertText('* ')
    await editor.insertText('1st Item')
    await editor.insertBreak()
    await editor.insertText('2nd Item')
    await editor.insertBreak()
    await editor.insertText('3rd Item')
    await editor.insertBreak()
    await editor.deleteBackward()

    await expect(page.locator('ul > li')).toHaveCount(3)

    expect(await page.locator('ul > li').nth(0).innerText()).toContain(
      '1st Item'
    )
    expect(await page.locator('ul > li').nth(1).innerText()).toContain(
      '2nd Item'
    )
    expect(await page.locator('ul > li').nth(2).innerText()).toContain(
      '3rd Item'
    )
  })

  test('keeps native desktop list continuation text in each list item', async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openMarkdownShortcuts(page)
    const textbox = editor.root

    await expect(textbox.locator('ul')).toHaveCount(0)

    await editor.selection.collapse({ path: [0, 0], offset: 0 })
    await editor.focus()
    await textbox.pressSequentially('* ')
    await expect(page.locator('ul > li')).toHaveCount(1)
    await textbox.pressSequentially('1st Item')
    await textbox.press('Enter')
    await expect(page.locator('ul > li')).toHaveCount(2)
    await textbox.pressSequentially('2nd Item')
    await textbox.press('Enter')
    await expect(page.locator('ul > li')).toHaveCount(3)
    await textbox.pressSequentially('3rd Item')

    await expect(page.locator('ul > li').nth(0)).toContainText('1st Item')
    await expect(page.locator('ul > li').nth(1)).toContainText('2nd Item')
    await expect(page.locator('ul > li').nth(2)).toContainText('3rd Item')
  })

  test('can add a h1 item', async ({ page, browserName }, testInfo) => {
    const editor = await openMarkdownShortcuts(page)
    const textbox = editor.root

    await expect(textbox.locator('h1')).toHaveCount(0)

    if (browserName === 'chromium' && testInfo.project.name !== 'mobile') {
      await textbox.press('Enter')
      await textbox.press('ArrowLeft')
      await textbox.pressSequentially('# ')
      await textbox.pressSequentially('Heading')
    } else {
      await editor.selection.select({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 228 },
      })
      await editor.deleteFragment()
      await editor.insertText('# ')
      await editor.insertText('Heading')
    }

    await expect(page.locator('h1')).toHaveCount(1)

    expect(await textbox.locator('h1').textContent()).toContain('Heading')
  })
})
