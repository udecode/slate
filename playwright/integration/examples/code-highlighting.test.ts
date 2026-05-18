import { expect, test } from '@playwright/test'
import {
  openExample,
  withExclusiveClipboardAccess,
} from 'slate-browser/playwright'

test.setTimeout(60 * 1000)

test.describe('code highlighting', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/code-highlighting')
    await expect(page.getByTestId('code-block-button')).toBeVisible()
  })

  test('renders semantic token projections', async ({ page }) => {
    const editor = page.locator('[data-slate-editor]')

    await expect(editor).toContainText('const initialValue')
    await expect(editor.locator('.token').first()).toBeVisible()
    await expect(editor.locator('.keyword').first()).toBeVisible()
    await expect(editor.locator('.string').first()).toBeVisible()
    await expect(editor.locator('.punctuation').first()).toBeVisible()
  })

  test('updates the code block language through the select', async ({
    page,
  }) => {
    const languageSelect = page.getByTestId('language-select').first()

    await expect(languageSelect).toHaveValue('jsx')

    await languageSelect.selectOption('typescript')

    await expect(languageSelect).toHaveValue('typescript')
  })

  test('converts a selected paragraph into a code block with code lines', async ({
    page,
  }) => {
    const editor = await openExample(page, 'code-highlighting', {
      ready: {
        editor: 'visible',
        text: /const initialValue/,
      },
    })
    const paragraphText =
      "Here's one containing a single paragraph block with some text in it:"

    await editor.selection.select({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: paragraphText.length },
    })
    await editor.focus()
    await page.getByTestId('code-block-button').click()

    await expect(
      editor.root.locator(':scope > [data-slate-node="element"]')
    ).toHaveCount(5)
    await expect(editor.locator.block([0, 0])).toHaveText(paragraphText)
    await expect(
      editor.root
        .locator(':scope > [data-slate-node="element"]')
        .first()
        .getByTestId('language-select')
    ).toHaveValue('html')
    await expect(editor.locator.block([1, 0])).toHaveText(
      '// Add the initial value.'
    )
  })

  test('converts a selected paragraph into a code block with a shortcut', async ({
    page,
  }) => {
    const editor = await openExample(page, 'code-highlighting', {
      ready: {
        editor: 'visible',
        text: /const initialValue/,
      },
    })
    const paragraphText =
      "Here's one containing a single paragraph block with some text in it:"
    const modifier = await editor.root.evaluate(() =>
      /Mac OS X/.test(navigator.userAgent) ? 'Meta' : 'Control'
    )

    await editor.selection.select({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: paragraphText.length },
    })
    await editor.focus()
    await editor.root.press(`${modifier}+Shift+C`)

    await expect(
      editor.root
        .locator(':scope > [data-slate-node="element"]')
        .first()
        .getByTestId('language-select')
    ).toHaveValue('html')
    await expect(editor.locator.block([0, 0])).toHaveText(paragraphText)
  })

  test('Enter inside a code line creates another line in the same code block', async ({
    page,
  }) => {
    const editor = await openExample(page, 'code-highlighting', {
      ready: {
        editor: 'visible',
        text: /const initialValue/,
      },
    })

    await editor.selection.collapse({ path: [1, 0, 0], offset: 6 })
    await editor.focus()
    await editor.press('Enter')

    await expect(
      editor.root.locator(':scope > [data-slate-node="element"]')
    ).toHaveCount(5)
    await expect(editor.locator.block([1, 0])).toHaveText('// Add')
    await expect(editor.locator.block([1, 1])).toHaveText(' the initial value.')
    await editor.assert.selection({
      anchor: { path: [1, 1, 0], offset: 0 },
      focus: { path: [1, 1, 0], offset: 0 },
    })
  })

  test('Tab inside a code line inserts configured spaces and advances the caret', async ({
    page,
  }) => {
    const editor = await openExample(page, 'code-highlighting', {
      ready: {
        editor: 'visible',
        text: /const initialValue/,
      },
    })

    await editor.selection.collapse({ path: [1, 0, 0], offset: 3 })
    await editor.focus()
    await editor.press('Tab')

    await expect(editor.locator.block([1, 0])).toHaveText(
      '//   Add the initial value.'
    )
    await editor.assert.selection({
      anchor: { path: [1, 0, 0], offset: 5 },
      focus: { path: [1, 0, 0], offset: 5 },
    })
  })

  test('Tab and Shift+Tab indent every selected code line', async ({
    page,
  }) => {
    const editor = await openExample(page, 'code-highlighting', {
      ready: {
        editor: 'visible',
        text: /const initialValue/,
      },
    })

    await editor.selection.select({
      anchor: { path: [1, 0, 0], offset: 1 },
      focus: { path: [1, 1, 0], offset: 1 },
    })
    await editor.focus()
    await editor.press('Tab')

    await expect(editor.locator.block([1, 0])).toHaveText(
      '  // Add the initial value.'
    )
    await expect(editor.locator.block([1, 1])).toHaveText(
      '  const initialValue = ['
    )

    await editor.selection.select({
      anchor: { path: [1, 0, 0], offset: 3 },
      focus: { path: [1, 1, 0], offset: 3 },
    })
    await editor.press('Shift+Tab')

    await expect(editor.locator.block([1, 0])).toHaveText(
      '// Add the initial value.'
    )
    await expect(editor.locator.block([1, 1])).toHaveText(
      'const initialValue = ['
    )
  })

  test('pastes selected text inside a code block without leaving the code block', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile',
      'Native clipboard proof needs desktop keyboard shortcuts'
    )

    const editor = await openExample(page, 'code-highlighting', {
      ready: {
        editor: 'visible',
        text: /const initialValue/,
      },
    })

    await editor.selection.selectDOM({
      anchor: { path: [1, 0, 0], offset: 3 },
      focus: { path: [1, 0, 0], offset: 6 },
    })

    await withExclusiveClipboardAccess(async () => {
      await editor.root.press('ControlOrMeta+C')
      await editor.selection.collapse({ path: [1, 0, 0], offset: 0 })
      await editor.root.press('ControlOrMeta+V')
    })

    await expect(
      editor.root.locator(':scope > [data-slate-node="element"]')
    ).toHaveCount(5)
    await expect(editor.locator.block([1, 0])).toHaveText(
      'Add// Add the initial value.'
    )
    await expect(editor.locator.block([1, 1])).toHaveText(
      'const initialValue = ['
    )
    await expect(
      editor.root
        .locator(':scope > [data-slate-node="element"]')
        .nth(1)
        .getByTestId('language-select')
    ).toHaveValue('jsx')
  })
})
