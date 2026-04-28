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

    await page.locator('span.material-icons', { hasText: 'image' }).click()

    await expect(page.getByRole('textbox').locator('img')).toHaveCount(2)
  })

  test('deletes selected image', async ({ page }) => {
    const editor = page.getByRole('textbox')
    const firstImage = editor.locator('img').first()

    await firstImage.click()
    await page.getByRole('button', { name: 'delete' }).click()

    await expect(editor.locator('img')).toHaveCount(1)
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
    expect(proof.renderCounts.byKind.editable ?? 0).toBe(0)
    expect(proof.renderCounts.byKind.void ?? 0).toBeLessThanOrEqual(1)
    expect(proof.renderCounts.byKind.element ?? 0).toBeLessThanOrEqual(1)
    expect(proof.renderCounts.byKind.spacer ?? 0).toBeLessThanOrEqual(1)
    expect(proof.renderCounts.total).toBeLessThanOrEqual(3)

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
    expect(afterImageProof.renderCounts.byKind.editable ?? 0).toBe(0)
    expect(afterImageProof.renderCounts.byKind.void ?? 0).toBeLessThanOrEqual(1)
    expect(
      afterImageProof.renderCounts.byKind.element ?? 0
    ).toBeLessThanOrEqual(1)
    expect(afterImageProof.renderCounts.byKind.spacer ?? 0).toBeLessThanOrEqual(
      1
    )
    expect(afterImageProof.renderCounts.total).toBeLessThanOrEqual(3)

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
