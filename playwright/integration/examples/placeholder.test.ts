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

  test('keeps an empty editor value and start selection while showing a placeholder', async ({
    page,
  }) => {
    const editor = await openExample(page, 'custom-placeholder', {
      ready: {
        editor: 'visible',
        placeholder: 'visible',
      },
    })

    await editor.focus()

    await editor.assert.placeholderVisible(true)
    expect(await editor.get.modelText()).toBe('')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })
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

  test('commits IME composition from the custom placeholder empty state', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium IME proof')

    const editor = await openExample(page, 'custom-placeholder', {
      ready: {
        editor: 'visible',
        placeholder: 'visible',
      },
    })

    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })
    await editor.ime.compose({
      committedText: 'abc',
      steps: ['a', 'ab', 'abc'],
      text: 'abc',
      transport: 'native',
    })

    await editor.assert.text('abc')
    expect(await editor.get.modelText()).toBe('abc')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 'abc'.length },
      focus: { path: [0, 0], offset: 'abc'.length },
    })
    await editor.assert.placeholderVisible(false)
    await editor.assert.kernelTrace({
      eventFamily: 'compositionend',
      transition: { allowed: true },
    })
  })

  test('fires blur when focus leaves during placeholder IME composition', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium CDP IME proof')

    const editor = await openExample(page, 'custom-placeholder', {
      ready: {
        editor: 'visible',
        placeholder: 'visible',
      },
    })

    await page.evaluate(() => {
      ;(window as any).__slateCustomPlaceholderBlurCount = 0
      document.getElementById('composition-blur-target')?.remove()

      const button = document.createElement('button')
      button.id = 'composition-blur-target'
      button.type = 'button'
      button.textContent = 'outside'
      document.body.append(button)
    })

    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })
    await editor.ime.enableKeyEvents()

    const client = await page.context().newCDPSession(page)
    await client.send('Input.imeSetComposition', {
      selectionEnd: 1,
      selectionStart: 1,
      text: 'す',
    })

    const blurTarget = page.locator('#composition-blur-target')
    await blurTarget.focus()

    await expect(blurTarget).toBeFocused()
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).__slateCustomPlaceholderBlurCount ?? 0
        )
      )
      .toBe(1)
    await editor.assert.kernelTrace({
      eventFamily: 'blur',
      transition: { allowed: true },
    })
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
