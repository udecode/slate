import { expect, test } from '@playwright/test'
import {
  assertNoIllegalKernelTransitions,
  createSlateBrowserEditorHarness,
  createSlateBrowserInternalControlGauntlet,
  openExample,
} from 'slate-browser/playwright'

test.describe('editable voids', () => {
  const input = 'input[type="text"]'
  const elements = [
    { tag: 'h4', count: 3 },
    { tag: input, count: 1 },
    { tag: 'input[type="radio"]', count: 2 },
  ]

  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/editable-voids', {
      waitUntil: 'domcontentloaded',
    })
    await expect(page.locator(input)).toHaveCount(1)
  })

  test('checks for the elements', async ({ page }) => {
    for (const elem of elements) {
      const { tag, count } = elem
      await expect(page.locator(tag)).toHaveCount(count)
    }
  })

  test('should double the elements', async ({ page }) => {
    // click the `+` sign to duplicate the editable void
    await page.locator('span.material-icons').nth(1).click()

    for (const elem of elements) {
      const { tag, count } = elem
      await expect(page.locator(tag)).toHaveCount(count * 2)
    }
  })

  test('make sure you can edit editable void', async ({ page }) => {
    await page.locator(input).fill('Typing')
    expect(await page.locator(input).inputValue()).toBe('Typing')
  })

  test('restores outer editor selection after editing input inside editable void', async ({
    page,
  }, testInfo) => {
    const outerEditor = page.locator('[data-slate-editor="true"]').first()
    const inputElement = page.locator(input)
    const outer = createSlateBrowserEditorHarness(
      page,
      'editable-voids-outer',
      outerEditor
    )

    await outer.selection.select({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })

    await inputElement.pressSequentially('Typing', { delay: 20 })
    await expect(inputElement).toHaveValue('Typing')
    await expect
      .poll(() => outer.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      })

    await outerEditor.evaluate((element: HTMLElement) => {
      element.focus()
    })
    if (testInfo.project.name === 'mobile') {
      await outer.insertText('Outer ')
    } else {
      await page.keyboard.type('Outer ')
    }

    await expect
      .poll(() => outer.get.modelText())
      .toContain('Outer In addition to nodes')
    await expect
      .poll(() => outer.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: 'Outer '.length },
        focus: { path: [0, 0], offset: 'Outer '.length },
      })
  })

  test('runs generated internal-control gauntlet without illegal kernel transitions', async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === 'webkit') {
      return
    }

    const editor = await openExample(page, 'editable-voids', {
      ready: {
        editor: 'visible',
      },
    })

    const result = await editor.scenario.run(
      'editable-voids-generated-internal-control-gauntlet',
      createSlateBrowserInternalControlGauntlet({
        controlSelector: input,
        controlValue: 'Typing',
        followUpText: 'Outer ',
        outerSelection: {
          anchor: { path: [0, 0], offset: 0 },
          focus: { path: [0, 0], offset: 0 },
        },
        textAfterFollowUp: 'Outer In addition to nodes',
      }),
      {
        metadata: {
          capabilities: ['internal-control', 'kernel-trace', 'model-selection'],
          platform: testInfo.project.name,
          transport: 'semantic-handle',
        },
        tracePath: testInfo.outputPath(
          'editable-voids-internal-control-gauntlet.json'
        ),
      }
    )

    assertNoIllegalKernelTransitions(result)
  })

  test('keeps ArrowLeft inside editable void input native-owned', async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === 'mobile') {
      return
    }

    const outerEditor = page.locator('[data-slate-editor="true"]').first()
    const inputElement = page.locator(input)
    const outer = createSlateBrowserEditorHarness(
      page,
      'editable-voids-outer',
      outerEditor
    )

    const outerSelection = {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    }

    await outer.selection.select(outerSelection)
    await inputElement.fill('Typing')
    await inputElement.evaluate((element: HTMLInputElement) => {
      element.focus()
      element.setSelectionRange(4, 4)
    })
    await expect(inputElement).toBeFocused()

    const traceBefore = await outer.get.kernelTrace()
    await inputElement.press('ArrowLeft')

    await expect(inputElement).toBeFocused()
    await expect
      .poll(() =>
        inputElement.evaluate((element: HTMLInputElement) => ({
          end: element.selectionEnd,
          start: element.selectionStart,
        }))
      )
      .toEqual({ end: 3, start: 3 })
    await expect.poll(() => outer.selection.get()).toEqual(outerSelection)

    const traceAfter = await outer.get.kernelTrace()
    expect(traceAfter.slice(traceBefore.length)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: null,
          eventFamily: 'keydown',
          intent: 'internal-control',
          selectionPolicy: {
            kind: 'none',
            reason: 'internal-control',
          },
          targetOwner: 'internal-control',
        }),
      ])
    )
    expect(traceAfter.slice(traceBefore.length)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: expect.objectContaining({
            kind: 'move-selection',
          }),
        }),
      ])
    )
  })

  test('ignores selectionchange noise from input inside editable void', async ({
    page,
  }) => {
    const outerEditor = page.locator('[data-slate-editor="true"]').first()
    const inputElement = page.locator(input)
    const outer = createSlateBrowserEditorHarness(
      page,
      'editable-voids-outer',
      outerEditor
    )

    await outer.selection.select({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })

    await inputElement.evaluate((element: HTMLInputElement) => {
      element.dispatchEvent(new Event('selectionchange', { bubbles: true }))
    })

    await expect
      .poll(() => outer.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      })
  })

  test('edits nested editor inside editable void', async ({ page }) => {
    const nestedEditor = page.locator('[data-slate-editor="true"]').nth(1)
    const nested = createSlateBrowserEditorHarness(
      page,
      'editable-voids-nested',
      nestedEditor
    )

    await expect(nestedEditor).toContainText('This is editable')
    await nested.selection.select({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })
    await nested.insertText('Nested ')

    await expect
      .poll(() => nested.get.modelText())
      .toContain('Nested This is editable')
    await expect(nestedEditor).toContainText('Nested This is editable')
  })

  test('keeps nested editor input focused inside editable void', async ({
    page,
  }, testInfo) => {
    const outerEditor = page.locator('[data-slate-editor="true"]').first()
    const nestedEditor = page.locator('[data-slate-editor="true"]').nth(1)
    const outer = createSlateBrowserEditorHarness(
      page,
      'editable-voids-outer',
      outerEditor
    )
    const nested = createSlateBrowserEditorHarness(
      page,
      'editable-voids-nested',
      nestedEditor
    )

    await expect(nestedEditor).toContainText('This is editable')
    await nested.selection.select({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })

    await nestedEditor.evaluate((element: HTMLElement) => {
      element.focus()
    })
    if (testInfo.project.name === 'mobile') {
      await nested.insertText('Nested ')
    } else {
      await page.keyboard.type('Nested ')
    }

    await expect
      .poll(() => nested.get.modelText())
      .toContain('Nested This is editable')
    await expect.poll(() => outer.get.modelText()).not.toContain('Nested')
    await expect
      .poll(() => nested.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: 'Nested '.length },
        focus: { path: [0, 0], offset: 'Nested '.length },
      })
    if (testInfo.project.name === 'mobile') {
      return
    }

    await expect
      .poll(() => nested.selection.dom())
      .toEqual({
        anchorNodeText: 'Nested This is editable ',
        anchorOffset: 'Nested '.length,
        focusNodeText: 'Nested This is editable ',
        focusOffset: 'Nested '.length,
      })
  })
})
