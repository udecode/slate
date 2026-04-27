import { expect, type Locator, test } from '@playwright/test'
import { openExample } from 'slate-browser/playwright'

const getBrowserUndoHotkey = async (root: Locator) =>
  root
    .page()
    .evaluate(() =>
      /Mac OS X/.test(navigator.userAgent) ? 'Meta+Z' : 'Control+Z'
    )

test.describe('placeholder example', () => {
  test.beforeEach(
    async ({ page }) => await page.goto('/examples/custom-placeholder')
  )

  test('renders custom placeholder', async ({ page }) => {
    const placeholderElement = page.locator('[data-slate-placeholder=true]')

    expect(await placeholderElement.textContent()).toContain('Type something')
    expect(await page.locator('pre').textContent()).toContain(
      'renderPlaceholder'
    )
  })

  test('renders editor tall enough to fit placeholder', async ({ page }) => {
    const slateEditor = page.locator('[data-slate-editor=true]')
    const placeholderElement = page.locator('[data-slate-placeholder=true]')

    await expect(placeholderElement).toBeVisible()

    const editorBoundingBox = await slateEditor.boundingBox()
    const placeholderBoundingBox = await placeholderElement.boundingBox()

    if (!editorBoundingBox)
      throw new Error('Could not get bounding box for editor')
    if (!placeholderBoundingBox)
      throw new Error('Could not get bounding box for placeholder')

    expect(editorBoundingBox.height).toBeGreaterThanOrEqual(
      placeholderBoundingBox.height
    )
  })

  test('undoes typing from the custom placeholder empty state', async ({
    browserName,
    page,
  }, testInfo) => {
    const editor = await openExample(page, 'custom-placeholder', {
      ready: {
        editor: 'visible',
        placeholder: 'visible',
      },
    })
    const needsSemanticTransport =
      browserName === 'webkit' || testInfo.project.name === 'mobile'

    if (needsSemanticTransport) {
      await editor.selection.select({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      })
      await editor.insertText('Undo me')
    } else {
      await editor.type('Undo me')
    }

    await editor.assert.text('Undo me')
    expect(await editor.get.modelText()).toBe('Undo me')
    await editor.assert.placeholderVisible(false)

    if (needsSemanticTransport) {
      await editor.undo()
    } else {
      await page.keyboard.press(await getBrowserUndoHotkey(editor.root))
    }

    await expect(editor.root).not.toContainText('Undo me')
    expect(await editor.get.modelText()).toBe('')
    await editor.assert.placeholderVisible(true)
  })
})
