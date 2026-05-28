import { expect, test } from '@playwright/test'
import {
  installSlateReactRenderProfiler,
  openExample,
  resetSlateReactRenderProfiler,
  takeSlateBrowserRenderStateSnapshot,
} from 'slate-browser/playwright'

test.describe('table example', () => {
  test.beforeEach(async ({ page }) => {
    await installSlateReactRenderProfiler(page)
    await page.goto('/examples/tables')
  })

  test('table tag rendered', async ({ page }) => {
    await expect(page.getByRole('textbox').locator('table')).toHaveCount(1)
  })

  test('keeps Backspace from crossing table-cell start', async ({ page }) => {
    const editor = await openExample(page, 'tables', {
      ready: { editor: 'visible' },
    })

    await editor.selection.collapse({ path: [1, 1, 0, 0], offset: 0 })
    await editor.root.press('Backspace')

    await expect(editor.root.locator('table')).toHaveCount(1)
    await expect(editor.root.locator('table')).toContainText('# of Feet')
    await editor.assert.selection({
      anchor: { path: [1, 1, 0, 0], offset: 0 },
      focus: { path: [1, 1, 0, 0], offset: 0 },
    })
  })

  test('keeps Delete from crossing table-cell end', async ({ page }) => {
    const editor = await openExample(page, 'tables', {
      ready: { editor: 'visible' },
    })

    await editor.selection.collapse({ path: [1, 0, 1, 0], offset: 5 })
    await editor.root.press('Delete')

    await expect(editor.root.locator('table')).toHaveCount(1)
    await expect(editor.root.locator('table')).toContainText('Human')
    await editor.assert.selection({
      anchor: { path: [1, 0, 1, 0], offset: 5 },
      focus: { path: [1, 0, 1, 0], offset: 5 },
    })
  })

  test('keeps Backspace after a table from deleting empty table cells', async ({
    page,
  }) => {
    const editor = await openExample(page, 'tables', {
      ready: { editor: 'visible' },
    })

    await editor.selection.collapse({ path: [2, 0], offset: 0 })
    await editor.root.press('Backspace')

    await expect(editor.root.locator('table')).toHaveCount(1)
    await expect(editor.root.locator('table')).toContainText('Human')
    await expect(editor.root.locator('table')).toContainText('# of Feet')
    await expect
      .poll(() =>
        editor.root
          .locator('tr')
          .evaluateAll((rows) =>
            rows.map((row) => row.querySelectorAll('td,th').length)
          )
      )
      .toEqual([4, 4, 4])
    await editor.assert.selection({
      anchor: { path: [1, 2, 3, 0], offset: 1 },
      focus: { path: [1, 2, 3, 0], offset: 1 },
    })
  })

  test('keeps ArrowDown at the table end inside the last cell when the table is last', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Desktop ArrowDown proof')

    const editor = await openExample(page, 'tables', {
      ready: { editor: 'visible' },
    })
    const trailingParagraph =
      (await editor.root.locator('p').last().textContent()) ?? ''

    await editor.selection.select({
      anchor: { path: [2, 0], offset: 0 },
      focus: { path: [2, 0], offset: trailingParagraph.length },
    })
    await editor.root.press('Backspace')
    await editor.selection.collapse({ path: [1, 2, 3, 0], offset: 1 })
    await editor.assert.selection({
      anchor: { path: [1, 2, 3, 0], offset: 1 },
      focus: { path: [1, 2, 3, 0], offset: 1 },
    })

    await resetSlateReactRenderProfiler(page)
    await editor.root.press('ArrowDown')
    await page.waitForTimeout(150)

    await editor.assert.selection({
      anchor: { path: [1, 2, 3, 0], offset: 1 },
      focus: { path: [1, 2, 3, 0], offset: 1 },
    })

    const proof = await takeSlateBrowserRenderStateSnapshot(editor)

    expect(proof.focusOwner.kind).toBe('editor')
    expect(proof.selection).toEqual({
      anchor: { path: [1, 2, 3, 0], offset: 1 },
      focus: { path: [1, 2, 3, 0], offset: 1 },
    })
    expect(proof.selectionShells?.anchor.node?.path).toBe('1,2,3,0')
    expect(proof.selectionShells?.anchor.element?.path).toBe('1,2,3')

    await editor.root.type('X')

    await expect(editor.root.locator('table')).toHaveCount(1)
    await expect(editor.root.locator('td').last()).toHaveText('9X')
    await expect(editor.root.locator('p')).toHaveCount(1)
    await editor.assert.selection({
      anchor: { path: [1, 2, 3, 0], offset: 2 },
      focus: { path: [1, 2, 3, 0], offset: 2 },
    })
  })

  test('triple-clicking the last table cell selects only that cell text', async ({
    page,
  }) => {
    const editor = await openExample(page, 'tables', {
      ready: { editor: 'visible' },
    })
    const lastCell = editor.root.locator('td').last()

    await lastCell.click({ clickCount: 3, delay: 50 })

    await expect
      .poll(async () => (await editor.get.selectedText()).replace(/\n+$/g, ''))
      .toBe('9')
    await editor.assert.selection({
      anchor: { path: [1, 2, 3, 0], offset: 0 },
      focus: { path: [1, 2, 3, 0], offset: 1 },
    })
  })

  test('dragging from a table cell toward trailing text does not select the intro paragraph', async ({
    page,
  }) => {
    const editor = await openExample(page, 'tables', {
      ready: { editor: 'visible' },
    })
    const lastCellText = editor.root
      .locator('td')
      .last()
      .locator('[data-slate-node="text"]')
      .first()
    const trailingText = editor.root
      .locator('p')
      .last()
      .locator('[data-slate-node="text"]')
      .first()
    const cellTextBox = await lastCellText.boundingBox()
    const paragraphTextBox = await trailingText.boundingBox()

    if (!cellTextBox || !paragraphTextBox) {
      throw new Error('Expected table cell and trailing paragraph text boxes')
    }

    await page.mouse.move(
      cellTextBox.x + cellTextBox.width / 2,
      cellTextBox.y + cellTextBox.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      paragraphTextBox.x + paragraphTextBox.width - 4,
      paragraphTextBox.y + paragraphTextBox.height / 2,
      { steps: 8 }
    )
    await page.mouse.up()

    await expect
      .poll(() => editor.get.selectedText())
      .not.toContain('Since the editor is based')
    await expect
      .poll(() => editor.get.selectedText())
      .toContain('This table is a basic rendering example')
  })

  test('keeps Enter from splitting inside a table cell', async ({ page }) => {
    const editor = await openExample(page, 'tables', {
      ready: { editor: 'visible' },
    })

    await editor.selection.collapse({ path: [1, 0, 1, 0], offset: 2 })
    await editor.root.press('Enter')

    await expect(editor.root.locator('table')).toHaveCount(1)
    await expect(editor.root.locator('table')).toContainText('Human')
    await editor.assert.selection({
      anchor: { path: [1, 0, 1, 0], offset: 2 },
      focus: { path: [1, 0, 1, 0], offset: 2 },
    })
  })

  test('moves right from an empty cell to the start of the next cell', async ({
    page,
  }) => {
    const editor = await openExample(page, 'tables', {
      ready: { editor: 'visible' },
    })

    await editor.root.locator('td').first().click()
    await editor.assert.selection({
      anchor: { path: [1, 0, 0, 0], offset: 0 },
      focus: { path: [1, 0, 0, 0], offset: 0 },
    })
    await resetSlateReactRenderProfiler(page)
    await editor.root.press('ArrowRight')

    await editor.assert.selection({
      anchor: { path: [1, 0, 1, 0], offset: 0 },
      focus: { path: [1, 0, 1, 0], offset: 0 },
    })

    const proof = await takeSlateBrowserRenderStateSnapshot(editor)

    expect(proof.selection).toEqual({
      anchor: { path: [1, 0, 1, 0], offset: 0 },
      focus: { path: [1, 0, 1, 0], offset: 0 },
    })
    expect(proof.domSelection?.anchorOffset).toBe(0)
    expect(proof.focusOwner.kind).toBe('editor')
    expect(proof.selectionShells?.anchor.node?.path).toBe('1,0,1,0')
    expect(proof.selectionShells?.anchor.node?.runtimeId).toBeTruthy()
    expect(proof.selectionShells?.anchor.element?.path).toBe('1,0,1')
    expect(proof.selectionShells?.anchor.element?.isVoid).toBe(false)
    expect(proof.renderCounts.byKind.editable ?? 0).toBe(0)
    expect(proof.renderCounts.total).toBe(0)
  })

  test('moves left from a cell start to the end of the previous cell', async ({
    page,
  }) => {
    const editor = await openExample(page, 'tables', {
      ready: { editor: 'visible' },
    })

    await editor.selection.collapse({ path: [1, 0, 1, 0], offset: 0 })
    await resetSlateReactRenderProfiler(page)
    await editor.root.press('ArrowLeft')

    await editor.assert.selection({
      anchor: { path: [1, 0, 0, 0], offset: 0 },
      focus: { path: [1, 0, 0, 0], offset: 0 },
    })

    const proof = await takeSlateBrowserRenderStateSnapshot(editor)

    expect(proof.selection).toEqual({
      anchor: { path: [1, 0, 0, 0], offset: 0 },
      focus: { path: [1, 0, 0, 0], offset: 0 },
    })
    expect(proof.domSelection?.anchorOffset).toBe(0)
    expect(proof.focusOwner.kind).toBe('editor')
    expect(proof.selectionShells?.anchor.node?.path).toBe('1,0,0,0')
    expect(proof.selectionShells?.anchor.node?.runtimeId).toBeTruthy()
    expect(proof.selectionShells?.anchor.element?.path).toBe('1,0,0')
    expect(proof.selectionShells?.anchor.element?.isVoid).toBe(false)
    expect(proof.renderCounts.byKind.editable ?? 0).toBeLessThanOrEqual(1)
    expect(proof.renderCounts.total).toBeLessThanOrEqual(1)
  })
})
