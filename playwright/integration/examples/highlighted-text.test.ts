import { expect, test } from '@playwright/test'

import {
  assertNoIllegalKernelTransitions,
  createSlateBrowserMarkClickTypingGauntlet,
  openExample,
} from 'slate-browser/playwright'

const nextCutPayload = async (
  editor: Awaited<ReturnType<typeof openExample>>
) =>
  editor.root.evaluate(
    (element: HTMLElement) =>
      new Promise<{ html: string; text: string }>((resolve) => {
        element.addEventListener(
          'cut',
          (event) => {
            const data = event.clipboardData
            setTimeout(() => {
              resolve({
                html: data?.getData('text/html') ?? '',
                text: data?.getData('text/plain') ?? '',
              })
            })
          },
          { once: true }
        )
      })
  )

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

test.describe('slate highlighted text', () => {
  test('supports semantic selection across decorated multi-leaf text', async ({
    page,
  }) => {
    const editor = await openExample(page, 'highlighted-text', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.select({
      anchor: { path: [0, 0], offset: 2 },
      focus: { path: [0, 0], offset: 8 },
    })

    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 2 },
      focus: { path: [0, 0], offset: 8 },
    })
    await editor.assert.domSelection({
      anchorNodeText: 'lph',
      anchorOffset: 1,
      focusNodeText: 'a beta',
      focusOffset: 4,
    })
    expect(await editor.get.selectedText()).toBe('pha be')
  })

  test('renders a decorated middle slice and still types through the text boundary', async ({
    page,
  }, testInfo) => {
    const editor = await openExample(page, 'highlighted-text', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.assert.htmlContains('data-tone="warm"')
    await editor.assert.text('alpha beta')

    await editor.selection.collapse({
      path: [0, 0],
      offset: 10,
    })
    if (testInfo.project.name === 'mobile') {
      await editor.insertText('!')
    } else {
      await editor.type('!')
    }

    await editor.assert.text('alpha beta!')
    await editor.assert.htmlContains('data-tone="warm"')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 11 },
      focus: { path: [0, 0], offset: 11 },
    })
  })

  test('commits IME composition inside decorated text', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium IME proof')

    const editor = await openExample(page, 'highlighted-text', {
      ready: {
        editor: 'visible',
      },
    })
    const pointInsideDecoration = { path: [0, 0], offset: 2 }

    await editor.assert.text('alpha beta')
    await editor.assert.htmlContains('data-tone="warm"')
    await editor.selection.selectDOM({
      anchor: pointInsideDecoration,
      focus: pointInsideDecoration,
    })
    await editor.assert.domSelection({
      anchorNodeText: 'lph',
      anchorOffset: 1,
      focusNodeText: 'lph',
      focusOffset: 1,
    })

    await commitDOMComposition(editor, {
      committedText: 'すし',
      steps: ['す', 'すし'],
    })

    await editor.assert.text('alすしpha beta')
    await editor.assert.htmlContains('data-tone="warm"')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 4 },
      focus: { path: [0, 0], offset: 4 },
    })
    await editor.assert.kernelTrace({
      eventFamily: 'compositionend',
      ownership: 'native-allowed',
      transition: { allowed: true },
    })

    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')

    await editor.assert.text('alpha beta')
    await editor.assert.htmlContains('data-tone="warm"')
    await editor.assert.selection({
      anchor: pointInsideDecoration,
      focus: pointInsideDecoration,
    })
  })

  test('commits IME composition spanning decorated text nodes', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium IME proof')

    const editor = await openExample(page, 'highlighted-text', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.assert.text('alpha beta')
    await editor.assert.htmlContains('data-tone="warm"')
    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 2 },
      focus: { path: [0, 0], offset: 6 },
    })
    await editor.assert.domSelection({
      anchorNodeText: 'lph',
      anchorOffset: 1,
      focusNodeText: 'a beta',
      focusOffset: 2,
    })

    await commitDOMComposition(editor, {
      committedText: 'すし',
      steps: ['す', 'すし'],
    })

    await editor.assert.text('alすしbeta')
    await editor.assert.htmlContains('data-tone="warm"')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 4 },
      focus: { path: [0, 0], offset: 4 },
    })
    await editor.assert.domSelection({
      anchorNodeText: 'lすし',
      anchorOffset: 3,
      focusNodeText: 'lすし',
      focusOffset: 3,
    })
    await editor.assert.kernelTrace({
      eventFamily: 'compositionend',
      ownership: 'native-allowed',
      transition: { allowed: true },
    })
  })

  test('runs generated mark-click gauntlet across projected text', async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'highlighted-text', {
      ready: {
        editor: 'visible',
      },
    })
    const result = await editor.scenario.run(
      'highlighted-text-generated-mark-click-gauntlet',
      createSlateBrowserMarkClickTypingGauntlet({
        clickPoint: { path: [0, 0], offset: 7 },
        domCaretAfterInsert: {
          offset: 4,
          text: 'a bXeta',
        },
        hotkey: 'Control+b',
        insertedText: 'X',
        markSelection: {
          anchor: { path: [0, 0], offset: 1 },
          focus: { path: [0, 0], offset: 4 },
        },
        selectionAfterInsert: {
          anchor: { path: [0, 0], offset: 8 },
          focus: { path: [0, 0], offset: 8 },
        },
        textAfterInsert: 'alpha bXeta',
      }),
      {
        metadata: {
          capabilities: [
            'dom-selection',
            'generated-gauntlet',
            'mark',
            'projection',
            'runtime-error-guard',
          ],
          platform: testInfo.project.name,
          transport: 'native-keyboard-and-click',
        },
        tracePath: testInfo.outputPath(
          'highlighted-text-mark-click-gauntlet.json'
        ),
      }
    )

    assertNoIllegalKernelTransitions(result)
    await editor.assert.htmlContains('data-tone="warm"')
  })

  test('keeps projected text movement model-owned and editable', async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'highlighted-text', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.assert.htmlContains('data-tone="warm"')
    await editor.selection.collapse({
      path: [0, 0],
      offset: 6,
    })
    await editor.press('ArrowRight')

    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 7 },
      focus: { path: [0, 0], offset: 7 },
    })
    expect(await editor.get.kernelTrace()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: expect.objectContaining({
            axis: 'horizontal',
            kind: 'move-selection',
          }),
          eventFamily: 'keydown',
          movement: expect.objectContaining({
            axis: 'horizontal',
            ownership: 'model-owned',
            reason: 'model-horizontal-inline-void',
          }),
        }),
      ])
    )

    await editor.type('X')
    await editor.assert.text('alpha bXeta')
  })

  test('keeps caret editable after Backspace inside decorated text', async ({
    page,
  }, testInfo) => {
    const editor = await openExample(page, 'highlighted-text', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.assert.htmlContains('data-tone="warm"')
    await editor.assert.text('alpha beta')
    await editor.selection.collapse({
      path: [0, 0],
      offset: 4,
    })

    if (testInfo.project.name === 'mobile') {
      await editor.deleteBackward()
    } else {
      await editor.root.press('Backspace')
    }

    await editor.assert.text('alpa beta')
    await editor.assert.htmlContains('data-tone="warm"')
    if (testInfo.project.name !== 'mobile') {
      await editor.assert.selection({
        anchor: { path: [0, 0], offset: 3 },
        focus: { path: [0, 0], offset: 3 },
      })
      await editor.assert.domSelection({
        anchorNodeText: 'lpa',
        anchorOffset: 2,
        focusNodeText: 'lpa',
        focusOffset: 2,
      })
    }

    if (testInfo.project.name === 'mobile') {
      await editor.insertText('h')
    } else {
      await editor.type('h')
    }

    await editor.assert.text('alpha beta')
    await editor.assert.htmlContains('data-tone="warm"')
    if (testInfo.project.name !== 'mobile') {
      await editor.assert.selection({
        anchor: { path: [0, 0], offset: 4 },
        focus: { path: [0, 0], offset: 4 },
      })
      await editor.assert.domSelection({
        anchorNodeText: 'lph',
        anchorOffset: 3,
        focusNodeText: 'lph',
        focusOffset: 3,
      })
    }
  })

  test('keeps caret editable after Delete inside decorated text', async ({
    page,
  }, testInfo) => {
    const editor = await openExample(page, 'highlighted-text', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.assert.htmlContains('data-tone="warm"')
    await editor.assert.text('alpha beta')
    await editor.selection.collapse({
      path: [0, 0],
      offset: 3,
    })

    if (testInfo.project.name === 'mobile') {
      await editor.deleteForward()
    } else {
      await editor.root.press('Delete')
    }

    await editor.assert.text('alpa beta')
    await editor.assert.htmlContains('data-tone="warm"')
    if (testInfo.project.name !== 'mobile') {
      await editor.assert.selection({
        anchor: { path: [0, 0], offset: 3 },
        focus: { path: [0, 0], offset: 3 },
      })
      await editor.assert.domSelection({
        anchorNodeText: 'lpa',
        anchorOffset: 2,
        focusNodeText: 'lpa',
        focusOffset: 2,
      })
    }

    if (testInfo.project.name === 'mobile') {
      await editor.insertText('h')
    } else {
      await editor.type('h')
    }

    await editor.assert.text('alpha beta')
    await editor.assert.htmlContains('data-tone="warm"')
    if (testInfo.project.name !== 'mobile') {
      await editor.assert.selection({
        anchor: { path: [0, 0], offset: 4 },
        focus: { path: [0, 0], offset: 4 },
      })
      await editor.assert.domSelection({
        anchorNodeText: 'lph',
        anchorOffset: 3,
        focusNodeText: 'lph',
        focusOffset: 3,
      })
    }
  })

  test('keeps caret editable after deleting a decorated selected range', async ({
    page,
  }, testInfo) => {
    const editor = await openExample(page, 'highlighted-text', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.assert.htmlContains('data-tone="warm"')
    await editor.assert.text('alpha beta')
    await editor.selection.select({
      anchor: { path: [0, 0], offset: 2 },
      focus: { path: [0, 0], offset: 8 },
    })

    if (testInfo.project.name === 'mobile') {
      await editor.deleteFragment()
    } else {
      await editor.root.press('Backspace')
    }

    await editor.assert.text('alta')
    if (testInfo.project.name !== 'mobile') {
      await editor.assert.selection({
        anchor: { path: [0, 0], offset: 2 },
        focus: { path: [0, 0], offset: 2 },
      })
      await editor.assert.domSelection({
        anchorNodeText: 'lta',
        anchorOffset: 1,
        focusNodeText: 'lta',
        focusOffset: 1,
      })
    }

    if (testInfo.project.name === 'mobile') {
      await editor.insertText('pha be')
    } else {
      await editor.type('pha be')
    }

    await editor.assert.text('alpha beta')
    await editor.assert.htmlContains('data-tone="warm"')
    if (testInfo.project.name !== 'mobile') {
      await editor.assert.selection({
        anchor: { path: [0, 0], offset: 8 },
        focus: { path: [0, 0], offset: 8 },
      })
    }
  })

  test('copies decorated text as fragment semantics instead of leaking highlight wrappers', async ({
    page,
  }) => {
    const editor = await openExample(page, 'highlighted-text', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.root.click()
    await editor.selection.select({
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 9 },
    })

    const payload = await editor.clipboard.copyPayload()

    expect(payload.text).toBe('lpha bet')
    expect(payload.types).toEqual(
      expect.arrayContaining(['text/html', 'text/plain'])
    )
    expect(payload.html).toContain('data-slate-fragment')
    expect(payload.html).not.toContain('data-tone=')
  })

  test('cuts decorated text as fragment semantics and deletes the selection', async ({
    page,
  }, testInfo) => {
    const editor = await openExample(page, 'highlighted-text', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.select({
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 9 },
    })

    const payloadPromise = nextCutPayload(editor)

    await editor.root.press('ControlOrMeta+X')

    if (testInfo.project.name === 'chromium') {
      expect(await editor.clipboard.readText()).toBe('lpha bet')
      expect(await editor.clipboard.readHtml()).toContain('data-slate-fragment')
    } else {
      const payload = await payloadPromise
      if (testInfo.project.name === 'firefox') {
        expect(payload.text).toBe('lpha bet')
        expect(payload.html).toContain('data-slate-fragment')
      }
    }
    await editor.assert.text('aa')
    if (testInfo.project.name !== 'mobile') {
      await editor.assert.selection({
        anchor: { path: [0, 0], offset: 1 },
        focus: { path: [0, 0], offset: 1 },
      })
    }
  })
})
