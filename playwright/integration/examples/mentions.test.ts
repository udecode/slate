import { expect, test } from '@playwright/test'
import {
  installSlateReactRenderProfiler,
  openExample,
  resetSlateReactRenderProfiler,
  takeSlateBrowserRenderStateSnapshot,
} from 'slate-browser/playwright'

const getEditor = (page: import('@playwright/test').Page) =>
  page.locator('[data-slate-editor="true"]').first()

const selectMentionInsertionPoint = async (
  page: import('@playwright/test').Page
) => {
  await getEditor(page).evaluate((element: HTMLElement) => {
    const point = {
      path: [1, 0],
      offset: 'Try mentioning characters, like '.length,
    }
    const handle = (element as Record<string, any>).__slateBrowserHandle

    if (!handle?.selectRange) {
      throw new Error('Missing Slate browser handle')
    }

    handle.selectRange({
      anchor: point,
      focus: point,
    })

    const textElement = element.querySelector(
      `[data-slate-node="text"][data-slate-path="${point.path.join(',')}"]`
    )
    const stringElement = textElement?.querySelector(
      '[data-slate-string], [data-slate-zero-width]'
    )
    const textNode = Array.from(stringElement?.childNodes ?? []).find(
      (node) => node.nodeType === Node.TEXT_NODE
    )

    if (!textNode) {
      throw new Error('Missing mention insertion DOM text node')
    }

    const offset = Math.min(point.offset, textNode.textContent?.length ?? 0)
    const selection = element.ownerDocument.getSelection()

    if (!selection) {
      throw new Error('Cannot access DOM selection')
    }

    selection.removeAllRanges()
    selection.setBaseAndExtent(textNode, offset, textNode, offset)
    element.focus()
    element.ownerDocument.dispatchEvent(
      new Event('selectionchange', { bubbles: true })
    )
  })
}

test.describe('mentions example', () => {
  test.beforeEach(async ({ page }) => {
    await installSlateReactRenderProfiler(page)
    await page.goto('/examples/mentions')
  })

  test('renders mention element', async ({ page }) => {
    await expect(page.locator('[data-cy="mention-R2-D2"]')).toHaveCount(1)
    await expect(page.locator('[data-cy="mention-Mace-Windu"]')).toHaveCount(1)
  })

  test('shows list of mentions', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'mobile') {
      return
    }

    await getEditor(page).click()
    await selectMentionInsertionPoint(page)
    await getEditor(page).pressSequentially(' @ma')
    await expect(page.locator('[data-cy="mentions-portal"]')).toHaveCount(1)
  })

  test('inserts from list', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'mobile') {
      return
    }

    await getEditor(page).click()
    await selectMentionInsertionPoint(page)
    await getEditor(page).pressSequentially(' @Ja')
    await expect(page.locator('[data-cy="mentions-portal"]')).toHaveCount(1)
    await getEditor(page).press('Enter')
    await expect(page.locator('[data-cy="mention-Jabba"]')).toHaveCount(1)
  })

  test('arrow keys skip over mentions from both sides', async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'mentions', {
      ready: {
        editor: 'visible',
      },
    })
    const beforeFirstMentionText = 'Try mentioning characters, like '
    const betweenMentionsText = ' or '

    await editor.selection.collapse({
      path: [1, 0],
      offset: beforeFirstMentionText.length,
    })
    await editor.focus()
    await editor.assert.selection({
      anchor: { path: [1, 0], offset: beforeFirstMentionText.length },
      focus: { path: [1, 0], offset: beforeFirstMentionText.length },
    })
    await resetSlateReactRenderProfiler(page)
    await editor.root.press('ArrowRight')
    await editor.assert.selection({
      anchor: { path: [1, 2], offset: 0 },
      focus: { path: [1, 2], offset: 0 },
    })
    let proof = await takeSlateBrowserRenderStateSnapshot(editor)

    expect(proof.selection).toEqual({
      anchor: { path: [1, 2], offset: 0 },
      focus: { path: [1, 2], offset: 0 },
    })
    expect(proof.domSelection?.anchorOffset).toBe(0)
    expect(proof.focusOwner.kind).toBe('editor')
    expect(proof.selectionShells?.anchor.node?.path).toBe('1,2')
    expect(proof.selectionShells?.anchor.node?.runtimeId).toBeTruthy()
    expect(proof.selectionShells?.anchor.element?.path).toBe('1')
    expect(proof.renderCounts.byKind.editable ?? 0).toBe(0)
    expect(proof.renderCounts.total).toBe(0)

    await editor.selection.collapse({ path: [1, 2], offset: 0 })
    await editor.assert.selection({
      anchor: { path: [1, 2], offset: 0 },
      focus: { path: [1, 2], offset: 0 },
    })
    await resetSlateReactRenderProfiler(page)
    await editor.root.press('ArrowLeft')
    await editor.assert.selection({
      anchor: { path: [1, 0], offset: beforeFirstMentionText.length },
      focus: { path: [1, 0], offset: beforeFirstMentionText.length },
    })
    proof = await takeSlateBrowserRenderStateSnapshot(editor)

    expect(proof.selection).toEqual({
      anchor: { path: [1, 0], offset: beforeFirstMentionText.length },
      focus: { path: [1, 0], offset: beforeFirstMentionText.length },
    })
    expect(proof.selectionShells?.anchor.node?.path).toBe('1,0')
    expect(proof.renderCounts.byKind.editable ?? 0).toBe(0)
    expect(proof.renderCounts.total).toBe(0)

    await editor.selection.collapse({
      path: [1, 2],
      offset: betweenMentionsText.length,
    })
    await editor.assert.selection({
      anchor: { path: [1, 2], offset: betweenMentionsText.length },
      focus: { path: [1, 2], offset: betweenMentionsText.length },
    })
    await resetSlateReactRenderProfiler(page)
    await editor.root.press('ArrowRight')
    await editor.assert.selection({
      anchor: { path: [1, 4], offset: 0 },
      focus: { path: [1, 4], offset: 0 },
    })
    proof = await takeSlateBrowserRenderStateSnapshot(editor)

    expect(proof.selection).toEqual({
      anchor: { path: [1, 4], offset: 0 },
      focus: { path: [1, 4], offset: 0 },
    })
    expect(proof.domSelection?.anchorOffset).toBe(0)
    expect(proof.selectionShells?.anchor.node?.path).toBe('1,4')
    expect(proof.selectionShells?.anchor.node?.runtimeId).toBeTruthy()
    expect(proof.selectionShells?.anchor.element?.path).toBe('1')
    expect(proof.renderCounts.byKind.editable ?? 0).toBe(0)
    expect(proof.renderCounts.total).toBe(0)

    await editor.selection.collapse({ path: [1, 4], offset: 0 })
    await editor.assert.selection({
      anchor: { path: [1, 4], offset: 0 },
      focus: { path: [1, 4], offset: 0 },
    })
    await resetSlateReactRenderProfiler(page)
    await editor.root.press('ArrowLeft')
    await editor.assert.selection({
      anchor: { path: [1, 2], offset: betweenMentionsText.length },
      focus: { path: [1, 2], offset: betweenMentionsText.length },
    })
    proof = await takeSlateBrowserRenderStateSnapshot(editor)

    expect(proof.selection).toEqual({
      anchor: { path: [1, 2], offset: betweenMentionsText.length },
      focus: { path: [1, 2], offset: betweenMentionsText.length },
    })
    expect(proof.selectionShells?.anchor.node?.path).toBe('1,2')
    expect(proof.renderCounts.byKind.editable ?? 0).toBe(0)
    expect(proof.renderCounts.total).toBe(0)
  })
})
