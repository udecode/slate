import { expect, test } from '@playwright/test'
import {
  installSlateReactRenderProfiler,
  openExample,
  resetSlateReactRenderProfiler,
  takeSlateBrowserRenderStateSnapshot,
} from 'slate-browser/playwright'

const slateCoverageErrors = new WeakMap<
  import('@playwright/test').Page,
  string[]
>()

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

const commitDOMComposition = async (
  editor: Awaited<ReturnType<typeof openExample>>,
  {
    committedText,
    steps,
  }: {
    committedText: string
    steps: string[]
  }
) =>
  editor.root.evaluate(
    (
      element: HTMLElement,
      { committedText, steps }: { committedText: string; steps: string[] }
    ) => {
      const selection = element.ownerDocument.getSelection()

      if (!selection || selection.rangeCount === 0) {
        throw new Error('Cannot compose without a DOM selection')
      }

      const insertionRange = selection.getRangeAt(0).cloneRange()
      const dispatchCompositionEvent = (
        type: 'compositionstart' | 'compositionupdate' | 'compositionend',
        data: string
      ) => {
        element.dispatchEvent(
          new CompositionEvent(type, {
            bubbles: true,
            cancelable: true,
            data,
          })
        )
      }

      dispatchCompositionEvent('compositionstart', steps[0] ?? '')
      steps.forEach((text) => {
        dispatchCompositionEvent('compositionupdate', text)
      })

      insertionRange.deleteContents()
      const composedNode = element.ownerDocument.createTextNode(committedText)
      insertionRange.insertNode(composedNode)
      insertionRange.setStart(composedNode, committedText.length)
      insertionRange.setEnd(composedNode, committedText.length)
      selection.removeAllRanges()
      selection.addRange(insertionRange)

      dispatchCompositionEvent('compositionend', committedText)
      element.ownerDocument.dispatchEvent(
        new Event('selectionchange', { bubbles: true })
      )
    },
    { committedText, steps }
  )

test.describe('mentions example', () => {
  test.beforeEach(async ({ page }) => {
    const errors: string[] = []
    slateCoverageErrors.set(page, errors)
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        message.text().includes('without a DOM coverage boundary')
      ) {
        errors.push(message.text())
      }
    })
    await installSlateReactRenderProfiler(page)
    await page.goto('/examples/mentions')
  })

  test('renders mention element', async ({ page }) => {
    await expect(page.locator('[data-cy="mention-R2-D2"]')).toHaveCount(1)
    await expect(page.locator('[data-cy="mention-Mace-Windu"]')).toHaveCount(1)
    await page.waitForTimeout(50)
    expect(slateCoverageErrors.get(page)).toEqual([])
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

  test('keeps mention portal open during IME composition', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium CDP IME proof')

    await getEditor(page).click()
    await selectMentionInsertionPoint(page)
    await getEditor(page).pressSequentially(' @ma')

    const portal = page.locator('[data-cy="mentions-portal"]')

    await expect(portal).toHaveCount(1)

    const client = await page.context().newCDPSession(page)

    await client.send('Input.imeSetComposition', {
      selectionEnd: 1,
      selectionStart: 1,
      text: 'す',
    })
    await expect(portal).toHaveCount(1)

    await client.send('Input.imeSetComposition', {
      selectionEnd: 2,
      selectionStart: 2,
      text: 'すし',
    })
    await expect(portal).toHaveCount(1)

    await client.send('Input.imeSetComposition', {
      selectionEnd: 0,
      selectionStart: 0,
      text: '',
    })
  })

  test('commits staged IME composition before a markable inline mention', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium CDP IME proof')

    const editor = await openExample(page, 'mentions', {
      ready: {
        editor: 'visible',
      },
    })
    const beforeFirstMentionText = 'Try mentioning characters, like '
    const insertedText = 'すし'
    const insertedOffset = beforeFirstMentionText.length + insertedText.length

    await selectMentionInsertionPoint(page)
    await editor.assert.selection({
      anchor: { path: [1, 0], offset: beforeFirstMentionText.length },
      focus: { path: [1, 0], offset: beforeFirstMentionText.length },
    })

    await editor.ime.compose({
      committedText: insertedText,
      steps: ['ｓ', 'す', 'すｓ', 'すｓｈ', insertedText],
      text: insertedText,
      transport: 'native',
    })

    await editor.assert.text(`${beforeFirstMentionText}${insertedText}`)
    await expect(page.locator('[data-cy="mention-R2-D2"]')).toHaveCount(1)
    await editor.assert.selection({
      anchor: { path: [1, 0], offset: insertedOffset },
      focus: { path: [1, 0], offset: insertedOffset },
    })
    await editor.assert.kernelTrace({
      eventFamily: 'compositionend',
      transition: { allowed: true },
    })
  })

  test('commits IME composition between inline mentions without overwriting them', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium IME proof')

    const editor = await openExample(page, 'mentions', {
      ready: {
        editor: 'visible',
      },
    })
    const betweenMentionsPoint = { path: [1, 2], offset: 2 }

    await editor.selection.selectDOM({
      anchor: betweenMentionsPoint,
      focus: betweenMentionsPoint,
    })
    await editor.assert.selection({
      anchor: betweenMentionsPoint,
      focus: betweenMentionsPoint,
    })
    await editor.assert.domSelection({
      anchorNodeText: ' or ',
      anchorOffset: 2,
      focusNodeText: ' or ',
      focusOffset: 2,
    })

    await commitDOMComposition(editor, {
      committedText: 'すし',
      steps: ['す', 'すし'],
    })

    expect(await editor.get.modelText()).toContain(
      'Try mentioning characters, like  oすしr !'
    )
    await editor.assert.text(' oすしr ')
    await expect(page.locator('[data-cy="mention-R2-D2"]')).toHaveCount(1)
    await expect(page.locator('[data-cy="mention-Mace-Windu"]')).toHaveCount(1)
    await editor.assert.selection({
      anchor: { path: [1, 2], offset: 4 },
      focus: { path: [1, 2], offset: 4 },
    })
    await editor.assert.kernelTrace({
      eventFamily: 'compositionend',
      transition: { allowed: true },
    })
  })

  test('commits IME composition immediately after an inline mention', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium IME proof')

    const editor = await openExample(page, 'mentions', {
      ready: {
        editor: 'visible',
      },
    })
    const afterFirstMentionPoint = { path: [1, 2], offset: 0 }

    await editor.selection.selectDOM({
      anchor: afterFirstMentionPoint,
      focus: afterFirstMentionPoint,
    })
    await editor.assert.selection({
      anchor: afterFirstMentionPoint,
      focus: afterFirstMentionPoint,
    })
    await editor.assert.domSelection({
      anchorNodeText: ' or ',
      anchorOffset: 0,
      focusNodeText: ' or ',
      focusOffset: 0,
    })

    await commitDOMComposition(editor, {
      committedText: 'すし',
      steps: ['す', 'すし'],
    })

    await editor.assert.text('すし or ')
    await expect(page.locator('[data-cy="mention-R2-D2"]')).toHaveCount(1)
    await expect(page.locator('[data-cy="mention-Mace-Windu"]')).toHaveCount(1)
    await editor.assert.selection({
      anchor: { path: [1, 2], offset: 2 },
      focus: { path: [1, 2], offset: 2 },
    })
    await editor.assert.kernelTrace({
      eventFamily: 'compositionend',
      transition: { allowed: true },
    })
  })

  test('arrow keys select mentions atomically from both sides', async ({
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
      anchor: { path: [1, 1, 0], offset: 0 },
      focus: { path: [1, 1, 0], offset: 0 },
    })
    let proof = await takeSlateBrowserRenderStateSnapshot(editor)

    expect(proof.selection).toEqual({
      anchor: { path: [1, 1, 0], offset: 0 },
      focus: { path: [1, 1, 0], offset: 0 },
    })
    expect(proof.domSelection?.anchorOffset).toBe(1)
    expect(proof.focusOwner.kind).toBe('editor')
    expect(proof.selectionShells?.anchor.node?.path).toBe('1,1,0')
    expect(proof.selectionShells?.anchor.node?.runtimeId).toBeTruthy()
    expect(proof.selectionShells?.anchor.element?.path).toBe('1,1')
    expect(proof.selectionShells?.anchor.element?.isVoid).toBe(true)
    await expect(page.locator('[data-cy="mention-R2-D2"]')).toHaveCSS(
      'box-shadow',
      'rgb(180, 213, 255) 0px 0px 0px 2px'
    )

    await editor.selection.collapse({ path: [1, 2], offset: 0 })
    await editor.assert.selection({
      anchor: { path: [1, 2], offset: 0 },
      focus: { path: [1, 2], offset: 0 },
    })
    await resetSlateReactRenderProfiler(page)
    await editor.root.press('ArrowLeft')
    await editor.assert.selection({
      anchor: { path: [1, 1, 0], offset: 0 },
      focus: { path: [1, 1, 0], offset: 0 },
    })
    proof = await takeSlateBrowserRenderStateSnapshot(editor)

    expect(proof.selection).toEqual({
      anchor: { path: [1, 1, 0], offset: 0 },
      focus: { path: [1, 1, 0], offset: 0 },
    })
    expect(proof.selectionShells?.anchor.node?.path).toBe('1,1,0')
    expect(proof.selectionShells?.anchor.element?.path).toBe('1,1')
    expect(proof.selectionShells?.anchor.element?.isVoid).toBe(true)

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
      anchor: { path: [1, 3, 0], offset: 0 },
      focus: { path: [1, 3, 0], offset: 0 },
    })
    proof = await takeSlateBrowserRenderStateSnapshot(editor)

    expect(proof.selection).toEqual({
      anchor: { path: [1, 3, 0], offset: 0 },
      focus: { path: [1, 3, 0], offset: 0 },
    })
    expect(proof.domSelection?.anchorOffset).toBe(1)
    expect(proof.selectionShells?.anchor.node?.path).toBe('1,3,0')
    expect(proof.selectionShells?.anchor.node?.runtimeId).toBeTruthy()
    expect(proof.selectionShells?.anchor.element?.path).toBe('1,3')
    expect(proof.selectionShells?.anchor.element?.isVoid).toBe(true)
    await expect(page.locator('[data-cy="mention-Mace-Windu"]')).toHaveCSS(
      'box-shadow',
      'rgb(180, 213, 255) 0px 0px 0px 2px'
    )

    await editor.selection.collapse({ path: [1, 4], offset: 0 })
    await editor.assert.selection({
      anchor: { path: [1, 4], offset: 0 },
      focus: { path: [1, 4], offset: 0 },
    })
    await resetSlateReactRenderProfiler(page)
    await editor.root.press('ArrowLeft')
    await editor.assert.selection({
      anchor: { path: [1, 3, 0], offset: 0 },
      focus: { path: [1, 3, 0], offset: 0 },
    })
    proof = await takeSlateBrowserRenderStateSnapshot(editor)

    expect(proof.selection).toEqual({
      anchor: { path: [1, 3, 0], offset: 0 },
      focus: { path: [1, 3, 0], offset: 0 },
    })
    expect(proof.selectionShells?.anchor.node?.path).toBe('1,3,0')
    expect(proof.selectionShells?.anchor.element?.path).toBe('1,3')
    expect(proof.selectionShells?.anchor.element?.isVoid).toBe(true)
  })
})
