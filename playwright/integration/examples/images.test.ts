import { expect, test } from '@playwright/test'
import {
  installSlateReactRenderProfiler,
  openExample,
  resetSlateReactRenderProfiler,
  takeSlateBrowserRenderStateSnapshot,
} from 'slate-browser/playwright'

test.describe('images example', () => {
  test.beforeEach(async ({ page }) => {
    await installSlateReactRenderProfiler(page)
    await page.goto('/examples/images')
  })

  test('contains image', async ({ page }) => {
    await expect(page.getByRole('textbox').locator('img')).toHaveCount(2)
  })

  test('does not insert invalid image URL from prompt', async ({ page }) => {
    page.on('dialog', async (dialog) => {
      if (dialog.type() === 'prompt') {
        await dialog.accept('https://example.com/not-an-image.txt')
        return
      }

      await dialog.accept()
    })

    await page.getByRole('button', { name: 'Image' }).click()

    await expect(page.getByRole('textbox').locator('img')).toHaveCount(2)
  })

  test('pastes image files from clipboard data', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium file paste proof')

    const editor = await openExample(page, 'images', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.collapse({ path: [2, 0], offset: 0 })
    await editor.root.evaluate((element: HTMLElement) => {
      const data = new DataTransfer()
      const file = new File(['not-real-image-bytes'], 'pasted.png', {
        type: 'image/png',
      })

      data.items.add(file)
      element.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        })
      )
    })

    await expect(editor.root.locator('img')).toHaveCount(3)
    await expect(
      editor.root.locator('img[src^="data:image/png;base64,"]')
    ).toHaveCount(1)
  })

  test('deletes selected image', async ({ page }) => {
    const editor = page.getByRole('textbox')
    const firstImage = editor.locator('img').first()

    await firstImage.click()
    await page.getByRole('button', { name: 'delete' }).click()

    await expect(editor.locator('img')).toHaveCount(1)
  })

  test('deletes a clicked selected image with Backspace', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName !== 'chromium' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'images', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.root.locator('img').first().click()
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 0 },
      })

    await page.keyboard.press('Backspace')

    await expect(editor.root.locator('img')).toHaveCount(1)
  })

  test('removes an empty paragraph after an image before deleting the image', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName !== 'chromium' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'images', {
      ready: {
        editor: 'visible',
      },
    })
    const paragraphAfterImage =
      'This example shows images in action. It features two ways to add images. You can either add an image via the toolbar icon above, or if you want in on a little secret, copy an image URL to your clipboard and paste it anywhere in the editor!'

    await editor.selection.selectDOM({
      anchor: { path: [2, 0], offset: 0 },
      focus: { path: [2, 0], offset: 0 },
    })
    await page.keyboard.press('Enter')
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [3, 0], offset: 0 },
        focus: { path: [3, 0], offset: 0 },
      })
    await editor.selection.select({
      anchor: { path: [2, 0], offset: 0 },
      focus: { path: [2, 0], offset: 0 },
    })

    await page.keyboard.press('Backspace')

    await expect(editor.root.locator('img')).toHaveCount(2)
    await expect(editor.root).toContainText(paragraphAfterImage)
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 0 },
      })
    await expect
      .poll(() =>
        editor.root
          .locator('img')
          .first()
          .evaluate((element) => getComputedStyle(element).boxShadow)
      )
      .not.toBe('none')
  })

  test('keeps the previous image when Delete removes following text', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName !== 'chromium' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'images', {
      ready: {
        editor: 'visible',
      },
    })
    const paragraphAfterImage =
      'This example shows images in action. It features two ways to add images. You can either add an image via the toolbar icon above, or if you want in on a little secret, copy an image URL to your clipboard and paste it anywhere in the editor!'

    await editor.selection.selectDOM({
      anchor: { path: [2, 0], offset: 0 },
      focus: { path: [2, 0], offset: 0 },
    })
    await page.keyboard.press('Delete')

    await expect(editor.root.locator('img')).toHaveCount(2)
    await expect(editor.root).toContainText(paragraphAfterImage.slice(1))
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [2, 0], offset: 0 },
        focus: { path: [2, 0], offset: 0 },
      })
  })

  test('inserts a paragraph after a clicked selected image on Enter', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName !== 'chromium' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'images', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.root.locator('img').first().click()
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 0 },
      })

    await page.keyboard.press('Enter')
    await page.keyboard.insertText('after image')

    await expect.poll(() => editor.get.blockTexts()).toContain('after image')
    await editor.assert.domCaret({
      offset: 'after image'.length,
      text: 'after image',
    })
  })

  test('copies selected image with visible external HTML payload', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName !== 'chromium' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'images', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.root.locator('img').first().click()
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 0 },
      })

    const payload = await editor.clipboard.copyPayload()

    expect(payload.types).toContain('text/html')
    expect(payload.html).toContain('data-slate-fragment=')
    expect(payload.html).toContain('<img')
    expect(payload.html).toContain('https://source.unsplash.com/kFrdX5IeQzI')
    expect(payload.text).not.toContain('\uFEFF')
  })

  test('selects image editor text content from text focus with keyboard select all', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName !== 'chromium' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'images', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 10 },
      focus: { path: [0, 0], offset: 10 },
    })

    await page.keyboard.press('ControlOrMeta+A')

    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [3, 0], offset: 78 },
      })
    await expect
      .poll(() =>
        editor.root
          .locator('img')
          .first()
          .evaluate((element) => getComputedStyle(element).boxShadow)
      )
      .toBe('none')
  })

  test('does not let the image void spacer add visible space above image content', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName !== 'chromium' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'images', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 113 },
      focus: { path: [0, 0], offset: 113 },
    })
    await page.keyboard.press('ArrowRight')
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 0 },
      })

    const contentOffset = await editor.root.evaluate(() => {
      const imageNode = document.querySelector('[data-slate-path="1"]')
      const content = imageNode?.querySelector('[contenteditable="false"]')

      if (!(imageNode instanceof HTMLElement) || !content) {
        throw new Error('Expected selected image node and visible content')
      }

      return (
        content.getBoundingClientRect().top -
        imageNode.getBoundingClientRect().top
      )
    })

    expect(contentOffset).toBeGreaterThanOrEqual(0)
    expect(contentOffset).toBeLessThanOrEqual(1)
  })

  test('moves horizontally into and out of an image', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName !== 'chromium' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'images', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 113 },
      focus: { path: [0, 0], offset: 113 },
    })
    await editor.assert.domSelectionTarget({
      anchorOffset: 113,
      anchorPath: [0, 0],
      isCollapsed: true,
    })

    await resetSlateReactRenderProfiler(page)
    await page.keyboard.press('ArrowRight')
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 0 },
      })
    await editor.assert.domSelectionTarget({
      anchorOffset: 0,
      anchorPath: [1, 0],
      isCollapsed: true,
    })

    const proof = await takeSlateBrowserRenderStateSnapshot(editor)

    expect(proof.selection).toEqual({
      anchor: { path: [1, 0], offset: 0 },
      focus: { path: [1, 0], offset: 0 },
    })
    expect(proof.focusOwner.kind).toBe('editor')
    expect(proof.selectionShells?.anchor.node?.path).toBe('1,0')
    expect(proof.selectionShells?.anchor.node?.runtimeId).toBeTruthy()
    expect(proof.selectionShells?.anchor.element?.path).toBe('1')
    expect(proof.selectionShells?.anchor.element?.isVoid).toBe(true)
    expect(proof.selectionShells?.runtimeIds.length).toBeGreaterThanOrEqual(2)
    expect(proof.renderCounts.byKind.editable ?? 0).toBeLessThanOrEqual(1)
    expect(proof.renderCounts.byKind.void ?? 0).toBeLessThanOrEqual(1)
    expect(proof.renderCounts.byKind.element ?? 0).toBeLessThanOrEqual(1)
    expect(proof.renderCounts.byKind.spacer ?? 0).toBeLessThanOrEqual(1)
    expect(proof.renderCounts.total).toBeLessThanOrEqual(4)

    await resetSlateReactRenderProfiler(page)
    await page.keyboard.press('ArrowRight')
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [2, 0], offset: 0 },
        focus: { path: [2, 0], offset: 0 },
      })
    await editor.assert.domSelectionTarget({
      anchorOffset: 0,
      anchorPath: [2, 0],
      isCollapsed: true,
    })

    const afterImageProof = await takeSlateBrowserRenderStateSnapshot(editor)

    expect(afterImageProof.selection).toEqual({
      anchor: { path: [2, 0], offset: 0 },
      focus: { path: [2, 0], offset: 0 },
    })
    expect(afterImageProof.selectionShells?.anchor.node?.path).toBe('2,0')
    expect(afterImageProof.selectionShells?.anchor.element?.path).toBe('2')
    expect(afterImageProof.selectionShells?.anchor.element?.isVoid).toBe(false)
    expect(
      afterImageProof.renderCounts.byKind.editable ?? 0
    ).toBeLessThanOrEqual(1)
    expect(afterImageProof.renderCounts.byKind.void ?? 0).toBeLessThanOrEqual(1)
    expect(
      afterImageProof.renderCounts.byKind.element ?? 0
    ).toBeLessThanOrEqual(1)
    expect(afterImageProof.renderCounts.byKind.spacer ?? 0).toBeLessThanOrEqual(
      1
    )
    expect(afterImageProof.renderCounts.total).toBeLessThanOrEqual(4)

    await page.keyboard.press('ArrowLeft')
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 0 },
      })
    await editor.assert.domSelectionTarget({
      anchorOffset: 0,
      anchorPath: [1, 0],
      isCollapsed: true,
    })
  })

  test('keeps vertical arrow movement into an image synchronized', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName !== 'chromium' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'images', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 113 },
      focus: { path: [0, 0], offset: 113 },
    })

    await page.keyboard.press('ArrowDown')

    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 0 },
      })
    await editor.assert.domSelectionTarget({
      anchorOffset: 0,
      anchorPath: [1, 0],
      isCollapsed: true,
    })
    await expect
      .poll(() =>
        editor.root
          .locator('img')
          .first()
          .evaluate((element) => getComputedStyle(element).boxShadow)
      )
      .not.toBe('none')
  })

  test('extends horizontal selection into an image with Shift+ArrowRight', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName !== 'chromium' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'images', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 113 },
      focus: { path: [0, 0], offset: 113 },
    })

    await page.keyboard.press('Shift+ArrowRight')

    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: 113 },
        focus: { path: [1, 0], offset: 0 },
      })
    await expect
      .poll(() =>
        editor.root.evaluate((element) => {
          const root = element.getRootNode() as Document | ShadowRoot
          const selection =
            'getSelection' in root
              ? root.getSelection()
              : element.ownerDocument.getSelection()
          const pathFor = (node: Node | null) => {
            const current =
              node?.nodeType === Node.TEXT_NODE
                ? node.parentElement
                : node instanceof HTMLElement
                  ? node
                  : null
            return (
              current
                ?.closest('[data-slate-node="text"]')
                ?.getAttribute('data-slate-path')
                ?.split(',')
                .filter(Boolean)
                .map(Number) ?? null
            )
          }

          return {
            anchorOffset: selection?.anchorOffset ?? null,
            anchorPath: pathFor(selection?.anchorNode ?? null),
            focusOffset: selection?.focusOffset ?? null,
            focusPath: pathFor(selection?.focusNode ?? null),
            isCollapsed: selection?.isCollapsed ?? null,
          }
        })
      )
      .toEqual({
        anchorOffset: 113,
        anchorPath: [0, 0],
        focusOffset: 0,
        focusPath: [1, 0],
        isCollapsed: false,
      })
  })
})
