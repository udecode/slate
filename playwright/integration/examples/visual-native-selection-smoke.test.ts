import { expect, test } from '@playwright/test'
import {
  assertSlateBrowserSelectionContract,
  attachPageScreenshot,
  openExample,
} from 'slate-browser/playwright'

const attachSelectionScreenshot = async (
  page: Parameters<typeof attachPageScreenshot>[0],
  testInfo: Parameters<typeof attachPageScreenshot>[1],
  name: string
) => {
  await attachPageScreenshot(page, testInfo, name, {
    fullPage: false,
  })
}

test.describe('visual native selection smoke', () => {
  test('richtext click typing leaves one collapsed displayed caret', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Desktop visual caret proof')

    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('Backspace')
    await page.keyboard.insertText('abcdef')
    await editor.assert.blockTexts(['abcdef'])

    await editor.dom.clickTextRange({
      endOffset: 3,
      path: [0, 0],
      startOffset: 2,
    })

    await page.keyboard.insertText('X')

    await editor.assert.blockTexts(['abXcdef'])
    await editor.assert.collapsedModelDOMSelection({
      offset: 3,
      path: [0, 0],
      text: 'abXcdef',
    })
    await editor.assert.noDoubleSelectionHighlight()
    await attachSelectionScreenshot(
      page,
      testInfo,
      'richtext-collapsed-caret.png'
    )
  })

  test('richtext multi-leaf selection has one native highlight', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile',
      'Desktop visual multi-leaf selection proof'
    )

    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })
    const selection = {
      anchor: { path: [0, 0], offset: 'This is edit'.length },
      focus: { path: [0, 2], offset: ' text'.length },
    }

    await editor.selection.selectDOM(selection)

    await assertSlateBrowserSelectionContract(editor, {
      domSelection: {
        anchorNodeText: 'This is editable ',
        anchorOffset: 'This is edit'.length,
        focusNodeText: ' text, ',
        focusOffset: ' text'.length,
      },
      noDoubleSelectionHighlight: true,
      selectedText: 'able rich text',
      selection,
    })
    await attachSelectionScreenshot(
      page,
      testInfo,
      'richtext-multi-leaf-selection.png'
    )
  })

  test('plaintext backward keyboard selection has one native highlight', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile',
      'Desktop visual selection proof'
    )

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })
    const text = 'abcdef'

    await editor.selection.selectAll()
    await page.keyboard.insertText(text)
    await editor.selection.select({
      anchor: { path: [0, 0], offset: text.length },
      focus: { path: [0, 0], offset: text.length },
    })

    for (let index = 0; index < 3; index += 1) {
      await page.keyboard.press('Shift+ArrowLeft')
    }

    await assertSlateBrowserSelectionContract(editor, {
      domSelection: {
        anchorNodeText: text,
        anchorOffset: text.length,
        focusNodeText: text,
        focusOffset: text.length - 3,
      },
      noDoubleSelectionHighlight: true,
      selectedText: 'def',
      selection: {
        anchor: { path: [0, 0], offset: text.length },
        focus: { path: [0, 0], offset: text.length - 3 },
      },
    })
    await attachSelectionScreenshot(
      page,
      testInfo,
      'plaintext-backward-selection.png'
    )
  })

  test('custom placeholder empty state shows one collapsed caret', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Desktop placeholder proof')

    const editor = await openExample(page, 'custom-placeholder', {
      ready: {
        editor: 'visible',
        placeholder: 'visible',
      },
    })

    await editor.focus()

    await editor.assert.placeholderVisible(true)
    await editor.assert.collapsedModelDOMSelection({
      offset: 0,
      path: [0, 0],
      text: '',
    })
    await editor.assert.noDoubleSelectionHighlight()
    await attachSelectionScreenshot(
      page,
      testInfo,
      'custom-placeholder-collapsed-caret.png'
    )
  })

  test('hidden DOM boundary drag selection avoids native plus projected double highlight', async ({
    browserName,
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Desktop boundary drag proof')
    test.skip(
      browserName === 'firefox',
      'Firefox does not extend native drag selections into contentEditable=false placeholders'
    )

    const pageErrors: string[] = []

    page.on('pageerror', (error) => pageErrors.push(error.message))

    const editor = await openExample(page, 'dom-coverage-boundaries', {
      ready: {
        editor: 'visible',
        text: /Outer body collapsed/,
      },
    })
    const visibleText = editor.root.getByText(
      'Visible introduction before the collapsed section.'
    )
    const placeholder = editor.root.getByText('Outer body collapsed')
    const start = await visibleText.boundingBox()
    const end = await placeholder.boundingBox()

    if (!start || !end) {
      throw new Error('Cannot resolve drag targets for DOM coverage example')
    }

    await page.mouse.move(start.x + 4, start.y + start.height / 2)
    await page.mouse.down()
    await page.mouse.move(end.x + end.width - 2, end.y + end.height / 2, {
      steps: 12,
    })
    await page.mouse.up()

    await expect.poll(() => pageErrors).toEqual([])
    await expect.poll(() => editor.selection.get()).not.toBeNull()
    await editor.assert.noDoubleSelectionHighlight()
    await attachSelectionScreenshot(
      page,
      testInfo,
      'hidden-dom-boundary-drag-selection.png'
    )
  })

  test('adjacent image drag selection has one displayed selected void', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile',
      'Desktop adjacent image visual proof'
    )

    const editor = await openExample(page, 'images', {
      query: { case: 'adjacent-voids' },
      ready: {
        editor: 'visible',
        text: 'Before adjacent images.',
      },
    })
    const bottomImage = editor.root.locator('img').nth(2)

    await expect(editor.root.locator('img')).toHaveCount(3)
    await expect(bottomImage).toBeVisible()
    await editor.selection.selectDOM({
      anchor: { path: [4, 0], offset: 'After adjacent images.'.length },
      focus: { path: [4, 0], offset: 'After adjacent images.'.length },
    })

    const box = await bottomImage.boundingBox()

    if (!box) {
      throw new Error('Expected lower adjacent image box')
    }

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2 + 8)
    await page.mouse.up()

    await assertSlateBrowserSelectionContract(editor, {
      noDoubleSelectionHighlight: true,
      selection: {
        anchor: { path: [3, 0], offset: 0 },
        focus: { path: [3, 0], offset: 0 },
      },
    })
    await editor.assert.domSelectionTarget({
      anchorOffset: 0,
      anchorPath: [3, 0],
      isCollapsed: true,
    })
    await attachSelectionScreenshot(
      page,
      testInfo,
      'images-adjacent-void-selected.png'
    )
  })

  test('inline triple-click paragraph selection matches native text', async ({
    browserName,
    page,
  }, testInfo) => {
    test.skip(
      browserName === 'firefox',
      'Firefox exposes paragraph triple-click selection differently'
    )
    test.skip(
      testInfo.project.name === 'mobile',
      'Desktop triple-click visual proof'
    )

    const editor = await openExample(page, 'inlines', {
      ready: {
        editor: 'visible',
      },
    })
    const secondBlockText =
      (await editor.get.blockTexts())[1]?.replaceAll('\u00A0', '') ?? ''

    await page.locator('[data-slate-editor] p').nth(1).click({ clickCount: 3 })

    await editor.assert.selection({
      anchor: { path: [1, 0], offset: 0 },
      focus: { path: [1, 2], offset: 0 },
    })
    await editor.assert.noDoubleSelectionHighlight()
    await expect
      .poll(async () =>
        (await editor.get.selectedText()).replaceAll('\u00A0', '')
      )
      .toBe(secondBlockText)
    await attachSelectionScreenshot(
      page,
      testInfo,
      'inlines-triple-click-paragraph-selection.png'
    )
  })

  test('table cell drag selection includes the full native text range', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Desktop table drag proof')

    const editor = await openExample(page, 'tables', {
      ready: { editor: 'visible' },
    })

    await editor.selection.dragTextRange({
      endAffinity: 'after',
      endOffset: 'Human'.length,
      settleMs: 25,
      startOffset: 0,
      text: 'Human',
    })

    await assertSlateBrowserSelectionContract(editor, {
      domSelection: {
        anchorNodeText: 'Human',
        anchorOffset: 0,
        focusNodeText: 'Human',
        focusOffset: 'Human'.length,
      },
      noDoubleSelectionHighlight: true,
      selectedText: 'Human',
      selection: {
        anchor: { path: [1, 0, 1, 0], offset: 0 },
        focus: { path: [1, 0, 1, 0], offset: 'Human'.length },
      },
    })
    await attachSelectionScreenshot(
      page,
      testInfo,
      'tables-human-cell-drag-selection.png'
    )
  })
})
