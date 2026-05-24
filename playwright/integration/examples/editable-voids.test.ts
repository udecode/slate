import { expect, test } from '@playwright/test'
import {
  assertNoIllegalKernelTransitions,
  createSlateBrowserDropDataGauntlet,
  createSlateBrowserEditorHarness,
  createSlateBrowserInternalControlGauntlet,
  openExample,
  recordSlateBrowserRuntimeErrors,
  withExclusiveClipboardAccess,
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

  test('undo from a new editable void input removes the inserted void block', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile',
      'Native input undo proof needs desktop keyboard shortcuts'
    )

    await page.locator('span.material-icons', { hasText: 'add' }).click()
    await expect(page.locator(input)).toHaveCount(2)

    const insertedInput = page.locator(input).last()

    await insertedInput.fill('abc')
    await expect(insertedInput).toHaveValue('abc')

    await page.keyboard.press('ControlOrMeta+Z')

    await expect(page.locator(input)).toHaveCount(1)
  })

  test('keeps native paste inside editable void input', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile',
      'Native input clipboard proof needs desktop keyboard shortcuts'
    )

    const inputElement = page.locator(input)

    await inputElement.fill('hello')
    await inputElement.evaluate((element: HTMLInputElement) => {
      element.focus()
      element.setSelectionRange(1, 5)
    })

    await withExclusiveClipboardAccess(async () => {
      await page.keyboard.press('ControlOrMeta+C')
      await page.keyboard.press('ControlOrMeta+V')
      await page.keyboard.press('ControlOrMeta+V')
    })

    await expect(inputElement).toHaveValue('helloello')
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

  test('pastes rich HTML inside nested editor without stealing outer selection', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile',
      'Rich HTML clipboard proof needs desktop keyboard shortcuts'
    )

    const runtimeErrors = recordSlateBrowserRuntimeErrors(page)
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
    const outerSelection = {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    }

    try {
      await outer.selection.select(outerSelection)
      await nested.selection.selectAll()
      await nested.clipboard.pasteHtml(
        '<p>Hello <strong>World</strong></p>',
        'Hello World'
      )

      runtimeErrors.assertNone()
      await expect
        .poll(async () =>
          (await nested.get.modelText()).replaceAll('\u00a0', ' ')
        )
        .toBe('Hello World')
      await expect(nestedEditor.locator('strong')).toHaveText('World')
      await expect
        .poll(() => outer.get.modelText())
        .not.toContain('Hello World')
      await expect.poll(() => outer.selection.get()).toEqual(outerSelection)

      await outerEditor.evaluate((element: HTMLElement) => {
        element.focus()
      })
      await page.keyboard.type('Outer ')

      runtimeErrors.assertNone()
      await expect
        .poll(() => outer.get.modelText())
        .toContain('Outer In addition to nodes')
    } finally {
      runtimeErrors.stop()
    }
  })

  test('drops rich HTML inside nested editor without stealing outer selection', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Desktop nested drop proof')

    const runtimeErrors = recordSlateBrowserRuntimeErrors(page)
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
    const outerSelection = {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    }

    try {
      await outer.selection.select(outerSelection)
      await nested.selection.select({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      })

      const textAfterDrop =
        "TDropped Worldhis is editable rich text, much better than a <textarea>!Since it's rich text, you can do things like turn a selection of text bold, or add a semantically rendered block quote in the middle of the page, like this:A wise quote.Try it out for yourself!"

      const result = await nested.scenario.run(
        'editable-voids-nested-drop-data-gauntlet',
        createSlateBrowserDropDataGauntlet({
          html: '<p>Dropped <strong>World</strong></p>',
          plainText: 'Dropped World',
          textAfterDrop,
        }),
        {
          metadata: {
            capabilities: [
              'drop',
              'html-drop',
              'kernel-trace',
              'nested-editor',
            ],
            platform: testInfo.project.name,
            transport: 'synthetic-datatransfer-drop',
          },
          tracePath: testInfo.outputPath(
            'editable-voids-nested-drop-data-gauntlet.json'
          ),
        }
      )

      assertNoIllegalKernelTransitions(result)
      expect(result.metadata.claim).toBe('synthetic-datatransfer')
      await expect(
        nestedEditor.locator('strong').filter({ hasText: 'World' })
      ).toHaveCount(1)
      await expect
        .poll(() => outer.get.modelText())
        .not.toContain('Dropped World')
      await expect.poll(() => outer.selection.get()).toEqual(outerSelection)

      await outerEditor.evaluate((element: HTMLElement) => {
        element.focus()
      })
      await page.keyboard.type('Outer ')

      runtimeErrors.assertNone()
      await expect
        .poll(() => outer.get.modelText())
        .toContain('Outer In addition to nodes')
    } finally {
      runtimeErrors.stop()
    }
  })

  test('ignores a parent selection that crosses into a nested editor', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile',
      'Desktop cross-editor DOM selection proof'
    )

    const runtimeErrors = recordSlateBrowserRuntimeErrors(page)
    const outerEditor = page.locator('[data-slate-editor="true"]').first()
    const nestedEditor = page.locator('[data-slate-editor="true"]').nth(1)
    const outer = createSlateBrowserEditorHarness(
      page,
      'editable-voids-outer',
      outerEditor
    )

    try {
      await outer.selection.select({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      })
      await outerEditor.focus()

      await outerEditor.evaluate((outerElement: HTMLElement) => {
        const nestedElement = outerElement.ownerDocument.querySelectorAll(
          '[data-slate-editor="true"]'
        )[1]
        const outerText = outerElement.querySelector(
          '[data-slate-string]'
        )?.firstChild
        const nestedText = nestedElement?.querySelector(
          '[data-slate-string]'
        )?.firstChild

        if (!outerText || !nestedText) {
          throw new Error('Cannot create outer-to-nested selection')
        }

        const range = outerElement.ownerDocument.createRange()
        range.setStart(outerText, 0)
        range.setEnd(nestedText, 4)

        const selection = outerElement.ownerDocument.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        outerElement.ownerDocument.dispatchEvent(
          new Event('selectionchange', { bubbles: true })
        )
      })
      await page.waitForTimeout(150)
      await page.keyboard.type('Outer ')

      runtimeErrors.assertNone()
      await expect
        .poll(() => outer.get.modelText())
        .toMatch(/^Outer In addition to nodes/)
      await expect(nestedEditor).toContainText('This is editable')
    } finally {
      runtimeErrors.stop()
    }
  })
})
