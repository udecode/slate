import { expect, type Locator, test } from '@playwright/test'
import {
  assertNoIllegalKernelTransitions,
  createSlateBrowserDestructiveEditingGauntlet,
  createSlateBrowserMarkClickTypingGauntlet,
  createSlateBrowserMarkTypingGauntlet,
  createSlateBrowserMixedEditingConformanceGauntlet,
  createSlateBrowserNavigationTypingGauntlet,
  createSlateBrowserSemanticEditingConformanceGauntlet,
  createSlateBrowserToolbarMarkClickTypingGauntlet,
  createSlateBrowserWarmToolbarArrowGauntlet,
  openExample,
  recordSlateBrowserRuntimeErrors,
} from 'slate-browser/playwright'

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3101'
const macChromeUserAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'

const expectDOMCaretAtTextEnd = async (root: Locator, suffix: string) => {
  await expect
    .poll(() =>
      root.evaluate((element: HTMLElement, expectedSuffix) => {
        const selection = element.ownerDocument.getSelection()
        const text = selection?.anchorNode?.textContent ?? null

        return Boolean(
          selection?.isCollapsed &&
            text?.endsWith(expectedSuffix) &&
            selection.anchorOffset === text.length
        )
      }, suffix)
    )
    .toBe(true)
}

const expectVisualCaretAtEndOfFirstBlock = async (root: Locator) => {
  await expect
    .poll(() =>
      root.evaluate((element: HTMLElement) => {
        const selection = element.ownerDocument.getSelection()
        const firstBlock = element.querySelector('[data-slate-node="element"]')

        if (!selection || selection.rangeCount === 0 || !firstBlock) {
          return false
        }

        const walker = element.ownerDocument.createTreeWalker(
          firstBlock,
          NodeFilter.SHOW_TEXT
        )
        let lastTextNode: Node | null = null

        while (walker.nextNode()) {
          lastTextNode = walker.currentNode
        }

        if (!lastTextNode) {
          return false
        }

        const caretRect = selection.getRangeAt(0).getBoundingClientRect()
        const expectedRange = element.ownerDocument.createRange()
        expectedRange.setStart(
          lastTextNode,
          lastTextNode.textContent?.length ?? 0
        )
        expectedRange.collapse(true)
        const expectedRect = expectedRange.getBoundingClientRect()

        return (
          Math.abs(caretRect.x - expectedRect.x) < 2 &&
          Math.abs(caretRect.y - expectedRect.y) < 2
        )
      })
    )
    .toBe(true)
}

const expectDOMCaretAfterInsertedTextBeforeSuffix = async (
  root: Locator,
  insertedText: string,
  trailingText: string
) => {
  await expect
    .poll(() =>
      root.evaluate(
        (
          element: HTMLElement,
          {
            expectedInsertedText,
            expectedTrailingText,
          }: { expectedInsertedText: string; expectedTrailingText: string }
        ) => {
          const selection = element.ownerDocument.getSelection()
          const text = selection?.anchorNode?.textContent ?? null

          return Boolean(
            selection?.isCollapsed &&
              text === `${expectedInsertedText}${expectedTrailingText}` &&
              selection.anchorOffset === expectedInsertedText.length
          )
        },
        {
          expectedInsertedText: insertedText,
          expectedTrailingText: trailingText,
        }
      )
    )
    .toBe(true)
}

const expectEditableWordSelected = async (root: Locator) => {
  await expect
    .poll(() =>
      root.evaluate((element: HTMLElement) => {
        const selection = element.ownerDocument.getSelection()

        return {
          containsAnchor:
            !!selection?.anchorNode && element.contains(selection.anchorNode),
          containsFocus:
            !!selection?.focusNode && element.contains(selection.focusNode),
          isCollapsed: selection?.isCollapsed ?? null,
          selectedText: selection?.toString() ?? '',
        }
      })
    )
    .toEqual({
      containsAnchor: true,
      containsFocus: true,
      isCollapsed: false,
      selectedText: 'editable',
    })
}

const expectCollapsedDOMSelectionInsideEditable = async (root: Locator) => {
  await expect
    .poll(() =>
      root.evaluate((element: HTMLElement) => {
        const selection = element.ownerDocument.getSelection()

        return Boolean(
          selection?.isCollapsed &&
            selection.anchorNode &&
            selection.focusNode &&
            element.contains(selection.anchorNode) &&
            element.contains(selection.focusNode)
        )
      })
    )
    .toBe(true)
}

const getBrowserUndoHotkey = async (root: Locator) => {
  return await root
    .page()
    .evaluate(() =>
      /Mac OS X/.test(navigator.userAgent) ? 'Meta+Z' : 'Control+Z'
    )
}

const selectEndOfFirstBlockWithDOMSelection = async (root: Locator) => {
  await root.evaluate((element: HTMLElement) => {
    const firstBlock = element.querySelector('[data-slate-node="element"]')

    if (!firstBlock) {
      throw new Error('Missing first block')
    }

    const walker = document.createTreeWalker(firstBlock, NodeFilter.SHOW_TEXT)
    let lastTextNode: Node | null = null

    while (walker.nextNode()) {
      lastTextNode = walker.currentNode
    }

    if (!lastTextNode) {
      throw new Error('Missing first block text')
    }

    const offset = lastTextNode.textContent?.length ?? 0
    const selection = window.getSelection()

    if (!selection) {
      throw new Error('Missing browser selection')
    }

    selection.removeAllRanges()
    selection.setBaseAndExtent(lastTextNode, offset, lastTextNode, offset)
    document.dispatchEvent(new Event('selectionchange'))
  })
}

test.describe('On richtext example', () => {
  test.beforeEach(async ({ page }) => await page.goto('/examples/richtext'))

  test('renders rich text', async ({ page }) => {
    expect(await page.locator('strong').nth(0).textContent()).toContain('rich')
    expect(await page.locator('blockquote').textContent()).toContain(
      'wise quote'
    )
  })

  test('inserts text through browser input', async ({ page }, testInfo) => {
    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.click()
    await editor.selection.select({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })
    if (testInfo.project.name === 'mobile') {
      await editor.insertText('Hello World')
    } else {
      await page.keyboard.insertText('Hello World')
    }

    await editor.assert.text('Hello World')
    expect(await editor.get.modelText()).toContain('Hello World')
  })

  test('runs a traced slate-browser scenario', async ({ page }, testInfo) => {
    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })
    const mobile = testInfo.project.name === 'mobile'
    const selection = mobile
      ? {
          anchor: { path: [0, 0], offset: 0 },
          focus: { path: [0, 0], offset: 0 },
        }
      : {
          anchor: { path: [0, 6], offset: 1 },
          focus: { path: [0, 6], offset: 1 },
        }
    const expectedText = mobile
      ? 'SThis is editable rich text'
      : 'This is editable rich text, much better than a <textarea>!S'
    const expectedSelection = mobile
      ? {
          anchor: { path: [0, 0], offset: 1 },
          focus: { path: [0, 0], offset: 1 },
        }
      : {
          anchor: { path: [0, 6], offset: 2 },
          focus: { path: [0, 6], offset: 2 },
        }

    const result = await editor.scenario.run('richtext-traced-type', [
      {
        kind: 'select',
        label: 'select-end',
        selection,
      },
      mobile
        ? { kind: 'insertText', label: 'insert-suffix', text: 'S' }
        : { kind: 'type', label: 'type-suffix', text: 'S' },
      {
        kind: 'assertText',
        label: 'assert-text',
        text: expectedText,
      },
      {
        kind: 'assertSelection',
        label: 'assert-selection',
        selection: expectedSelection,
      },
      ...(mobile
        ? []
        : [
            {
              kind: 'assertDOMSelection' as const,
              label: 'assert-dom-selection',
              selection: {
                anchorNodeText: '!S',
                anchorOffset: 2,
                focusNodeText: '!S',
                focusOffset: 2,
              },
            },
          ]),
    ])

    expect(result.name).toBe('richtext-traced-type')
    expect(result.trace).toHaveLength(mobile ? 4 : 5)
    expect(result.trace.at(-1)?.snapshot.text).toContain(expectedText)
  })

  test('runs generated navigation and typing gauntlet without illegal kernel transitions', async ({
    page,
  }, testInfo) => {
    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })
    const mobile = testInfo.project.name === 'mobile'
    const result = await editor.scenario.run(
      'richtext-generated-navigation-typing-gauntlet',
      createSlateBrowserNavigationTypingGauntlet({
        insertedText: 'G',
        movedSelection: {
          anchor: { path: [0, 6], offset: 1 },
          focus: { path: [0, 6], offset: 1 },
        },
        startSelection: {
          anchor: { path: [0, 6], offset: 0 },
          focus: { path: [0, 6], offset: 0 },
        },
        textAfterInsert: '!G',
      }),
      {
        metadata: {
          capabilities: [
            'generated-gauntlet',
            'keyboard-navigation',
            'model-selection',
            'text-mutation',
          ],
          platform: testInfo.project.name,
          transport: mobile
            ? 'semantic-handle-and-playwright-keyboard'
            : 'keyboard-and-handle',
        },
        tracePath: testInfo.outputPath(
          'richtext-generated-navigation-typing-gauntlet.json'
        ),
      }
    )

    assertNoIllegalKernelTransitions(result)
    expect(result.metadata.claim).toBe(
      mobile ? 'mobile-semantic-handle' : 'mixed-native-and-semantic'
    )
    expect(result.replay.replayable).toBe(true)
    expect(result.replay.steps.map((step) => step.label)).toEqual([
      'select-start',
      'move-right',
      'assert-moved-selection',
      'insert-after-navigation',
      'assert-inserted-text',
    ])
    expect(result.replay.steps[0]?.value).toMatchObject({
      kind: 'select',
      selection: {
        anchor: { path: [0, 6], offset: 0 },
        focus: { path: [0, 6], offset: 0 },
      },
    })
    expect(result.trace.at(-1)?.snapshot.text).toContain('!G')
  })

  test('runs generated mixed editing conformance gauntlet without stale selection', async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })
    const result = await editor.scenario.run(
      'richtext-generated-mixed-editing-conformance-gauntlet',
      createSlateBrowserMixedEditingConformanceGauntlet({
        deleteKey: 'Backspace',
        domCaretAfterDelete: {
          offset: 1,
          text: '!',
        },
        domCaretAfterFollowUp: {
          offset: 1,
          text: "QSince it's rich text, you can do things like turn a selection of text ",
        },
        domShape: {
          afterDelete: {
            blockIndex: 0,
            innerText:
              'This is editable rich text, much better than a <textarea>!',
            noUnexpectedZeroWidthBreaks: true,
            textContent:
              'This is editable rich text, much better than a <textarea>!',
            zeroWidthBreakCount: 0,
          },
          afterFollowUp: {
            blockIndex: 1,
            noUnexpectedZeroWidthBreaks: true,
            zeroWidthBreakCount: 0,
          },
          afterInsert: {
            blockIndex: 0,
            innerText:
              'This is editable rich text, much better than a <textarea>!Q',
            noUnexpectedZeroWidthBreaks: true,
            textContent:
              'This is editable rich text, much better than a <textarea>!Q',
            zeroWidthBreakCount: 0,
          },
        },
        insertedText: 'Q',
        navigationKeys: ['ArrowRight'],
        selectionAfterDelete: {
          anchor: { path: [0, 6], offset: 1 },
          focus: { path: [0, 6], offset: 1 },
        },
        selectionAfterFollowUp: {
          anchor: { path: [1, 0], offset: 1 },
          focus: { path: [1, 0], offset: 1 },
        },
        selectionAfterInsert: {
          anchor: { path: [0, 6], offset: 2 },
          focus: { path: [0, 6], offset: 2 },
        },
        selectionAfterNavigation: {
          anchor: { path: [0, 6], offset: 1 },
          focus: { path: [0, 6], offset: 1 },
        },
        startSelection: {
          anchor: { path: [0, 6], offset: 0 },
          focus: { path: [0, 6], offset: 0 },
        },
        textAfterDelete:
          'This is editable rich text, much better than a <textarea>!',
        textAfterFollowUp: "QSince it's rich text",
        textAfterInsert:
          'This is editable rich text, much better than a <textarea>!Q',
        toolbarButtonTestId: 'block-button-heading-one',
        toolbarSelection: {
          anchor: { path: [1, 0], offset: 0 },
          focus: { path: [1, 0], offset: 0 },
        },
        toolbarSelectionAfterCommand: {
          anchor: { path: [1, 0], offset: 0 },
          focus: { path: [1, 0], offset: 0 },
        },
      }),
      {
        metadata: {
          capabilities: [
            'caret',
            'delete',
            'dom-selection',
            'generated-gauntlet',
            'keyboard-navigation',
            'kernel-trace',
            'toolbar-command',
          ],
          platform: testInfo.project.name,
          transport: 'native-keyboard-and-dom-selection',
        },
        tracePath: testInfo.outputPath(
          'richtext-generated-mixed-editing-conformance-gauntlet.json'
        ),
      }
    )

    assertNoIllegalKernelTransitions(result)
    expect(result.metadata.claim).toBe('desktop-native-keyboard')
    expect(result.replay.replayable).toBe(true)
    expect(
      result.reductionCandidates.every(
        (candidate) => candidate.replay.replayable
      )
    ).toBe(true)
    await expect(
      editor.root.locator('h1').filter({ hasText: "QSince it's rich text" })
    ).toHaveCount(1)
  })

  test('runs generated destructive paste and word-delete gauntlet', async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })
    const tailBlockTexts = [
      "Since it's rich text, you can do things like turn a selection of text bold, or add a semantically rendered block quote in the middle of the page, like this:",
      'A wise quote.',
      'Try it out for yourself!',
    ]
    const result = await editor.scenario.run(
      'richtext-generated-destructive-paste-word-delete-gauntlet',
      createSlateBrowserDestructiveEditingGauntlet({
        domShape: {
          afterDeleteAfterPaste: {
            blockIndex: 0,
            innerText:
              'Past is editable rich text, much better than a <textarea>!',
            noUnexpectedZeroWidthBreaks: true,
            textContent:
              'Past is editable rich text, much better than a <textarea>!',
            zeroWidthBreakCount: 0,
          },
          afterFollowUp: {
            blockIndex: 0,
            innerText:
              'Past! is editable rich text, much better than a <textarea>!',
            noUnexpectedZeroWidthBreaks: true,
            textContent:
              'Past! is editable rich text, much better than a <textarea>!',
            zeroWidthBreakCount: 0,
          },
          afterPaste: {
            blockIndex: 0,
            innerText:
              'Paste is editable rich text, much better than a <textarea>!',
            noUnexpectedZeroWidthBreaks: true,
            textContent:
              'Paste is editable rich text, much better than a <textarea>!',
            zeroWidthBreakCount: 0,
          },
          afterWordDeleteFollowUp: {
            blockIndex: 0,
            noUnexpectedZeroWidthBreaks: true,
            zeroWidthBreakCount: 0,
          },
          afterWordDeleteIterations: Array.from({ length: 4 }, () => ({
            blockIndex: 0,
            noUnexpectedZeroWidthBreaks: true,
            zeroWidthBreakCount: 0,
          })),
        },
        followUpText: '!',
        pasteSelection: {
          anchor: { path: [0, 0], offset: 0 },
          focus: { path: [0, 0], offset: 4 },
        },
        pastedText: 'Paste',
        selectionAfterDeleteAfterPaste: {
          anchor: { path: [0, 0], offset: 4 },
          focus: { path: [0, 0], offset: 4 },
        },
        selectionAfterFollowUp: {
          anchor: { path: [0, 0], offset: 5 },
          focus: { path: [0, 0], offset: 5 },
        },
        selectionAfterPaste: {
          anchor: { path: [0, 0], offset: 5 },
          focus: { path: [0, 0], offset: 5 },
        },
        tailBlockTextsAfterWordDelete: tailBlockTexts,
        textAfterDeleteAfterPaste:
          'Past is editable rich text, much better than a <textarea>!',
        textAfterFollowUp:
          'Past! is editable rich text, much better than a <textarea>!',
        textAfterPaste:
          'Paste is editable rich text, much better than a <textarea>!',
        wordDeleteSelection: {
          anchor: { path: [0, 6], offset: 1 },
          focus: { path: [0, 6], offset: 1 },
        },
      }),
      {
        metadata: {
          capabilities: [
            'delete',
            'generated-gauntlet',
            'kernel-trace',
            'paste',
            'word-delete',
          ],
          platform: testInfo.project.name,
          transport: 'native-keyboard-and-desktop-native-clipboard',
        },
        tracePath: testInfo.outputPath(
          'richtext-generated-destructive-paste-word-delete-gauntlet.json'
        ),
      }
    )

    assertNoIllegalKernelTransitions(result)
    expect(result.metadata.claim).toBe('desktop-native-clipboard')
    expect(result.replay.replayable).toBe(true)
    expect(
      result.reductionCandidates.some(
        (candidate) =>
          candidate.kind === 'single-step' && candidate.replay.replayable
      )
    ).toBe(true)
    await expect
      .poll(async () => (await editor.get.blockTexts()).slice(1))
      .toEqual(tailBlockTexts)
  })

  test('runs generated mobile semantic editing conformance gauntlet', async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name !== 'mobile') {
      return
    }

    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })
    const result = await editor.scenario.run(
      'richtext-generated-mobile-semantic-editing-conformance-gauntlet',
      createSlateBrowserSemanticEditingConformanceGauntlet({
        insertedText: 'M',
        selectionAfterDelete: {
          anchor: { path: [1, 0], offset: 0 },
          focus: { path: [1, 0], offset: 0 },
        },
        selectionAfterFollowUp: {
          anchor: { path: [0, 0], offset: 1 },
          focus: { path: [0, 0], offset: 1 },
        },
        selectionAfterInsert: {
          anchor: { path: [1, 0], offset: 1 },
          focus: { path: [1, 0], offset: 1 },
        },
        startSelection: {
          anchor: { path: [1, 0], offset: 0 },
          focus: { path: [1, 0], offset: 0 },
        },
        textAfterDelete:
          "Since it's rich text, you can do things like turn a selection of text",
        textAfterFollowUp: 'MThis is editable rich text',
        textAfterInsert:
          "MSince it's rich text, you can do things like turn a selection of text",
        toolbarButtonTestId: 'block-button-heading-one',
        toolbarSelection: {
          anchor: { path: [0, 0], offset: 0 },
          focus: { path: [0, 0], offset: 0 },
        },
        toolbarSelectionAfterCommand: {
          anchor: { path: [0, 0], offset: 0 },
          focus: { path: [0, 0], offset: 0 },
        },
      }),
      {
        metadata: {
          capabilities: [
            'delete',
            'dom-selection',
            'generated-gauntlet',
            'kernel-trace',
            'mobile-semantic',
            'toolbar-command',
          ],
          platform: testInfo.project.name,
          transport: 'semantic-handle-and-dom-selection',
        },
        tracePath: testInfo.outputPath(
          'richtext-generated-mobile-semantic-editing-conformance-gauntlet.json'
        ),
      }
    )

    assertNoIllegalKernelTransitions(result)
    expect(result.metadata.claim).toBe('mobile-semantic-handle')
    expect(result.replay.replayable).toBe(true)
    await expect(
      editor.root
        .locator('h1')
        .filter({ hasText: 'MThis is editable rich text' })
    ).toHaveCount(1)
  })

  test('types at the browser-selected end of a block', async ({
    browserName,
    page,
  }, testInfo) => {
    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })
    const expectedSelection = {
      anchor: { path: [0, 6], offset: 1 },
      focus: { path: [0, 6], offset: 1 },
    }

    await editor.click()
    if (browserName === 'firefox' || testInfo.project.name === 'mobile') {
      await editor.selection.select(expectedSelection)
      await expect.poll(() => editor.selection.get()).toEqual(expectedSelection)
      await expect
        .poll(() => editor.selection.dom())
        .toEqual({
          anchorOffset: 1,
          anchorNodeText: '!',
          focusNodeText: '!',
          focusOffset: 1,
        })
    } else {
      await selectEndOfFirstBlockWithDOMSelection(editor.root)
    }

    if (browserName === 'firefox' || testInfo.project.name === 'mobile') {
      await editor.insertText('ZZ')
    } else {
      await page.keyboard.insertText('ZZ')
    }

    await editor.assert.text(
      'This is editable rich text, much better than a <textarea>!ZZ'
    )
    expect(await editor.get.modelText()).toContain(
      'This is editable rich text, much better than a <textarea>!ZZ'
    )
  })

  test('keeps caret editable after browser Backspace at selected text end', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName === 'firefox' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })
    const afterBackspaceText =
      'This is editable rich text, much better than a <textarea>!'
    const afterBackspaceSelection = {
      anchor: { path: [0, 6], offset: 1 },
      focus: { path: [0, 6], offset: 1 },
    }
    const afterFollowUpText =
      'This is editable rich text, much better than a <textarea>!Z'

    await editor.click()
    await editor.selection.select(afterBackspaceSelection)
    await page.keyboard.insertText('O')
    await editor.assert.text(
      'This is editable rich text, much better than a <textarea>!O'
    )
    await page.keyboard.press('Backspace')

    await editor.assert.text(afterBackspaceText)
    expect(await editor.get.modelText()).toContain(afterBackspaceText)
    await expect
      .poll(() => editor.selection.get())
      .toEqual(afterBackspaceSelection)
    await expect
      .poll(() =>
        editor.root.evaluate((element: HTMLElement) => {
          const selection = element.ownerDocument.getSelection()

          return Boolean(
            selection?.isCollapsed &&
              selection.anchorNode &&
              selection.focusNode &&
              element.contains(selection.anchorNode) &&
              element.contains(selection.focusNode)
          )
        })
      )
      .toBe(true)

    await page.keyboard.insertText('Z')

    await editor.assert.text(afterFollowUpText)
    expect(await editor.get.modelText()).toContain(afterFollowUpText)
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [0, 6], offset: 2 },
        focus: { path: [0, 6], offset: 2 },
      })
    await expectDOMCaretAtTextEnd(editor.root, 'Z')
    await expectVisualCaretAtEndOfFirstBlock(editor.root)
  })

  test('keeps caret editable after browser Delete before trailing punctuation', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName === 'firefox' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })
    const afterDeleteText =
      'This is editable rich text, much better than a <textarea>'
    const afterDeleteSelection = {
      anchor: { path: [0, 5], offset: '<textarea>'.length },
      focus: { path: [0, 5], offset: '<textarea>'.length },
    }
    const afterFollowUpText =
      'This is editable rich text, much better than a <textarea>Z'

    await editor.click()
    await editor.selection.select(afterDeleteSelection)
    await page.keyboard.press('Delete')

    await editor.assert.text(afterDeleteText)
    expect(await editor.get.modelText()).toContain(afterDeleteText)
    await expect
      .poll(() => editor.selection.get())
      .toEqual(afterDeleteSelection)
    await expect
      .poll(() =>
        editor.root.evaluate((element: HTMLElement) => {
          const selection = element.ownerDocument.getSelection()

          return Boolean(
            selection?.isCollapsed &&
              selection.anchorNode &&
              selection.focusNode &&
              element.contains(selection.anchorNode) &&
              element.contains(selection.focusNode)
          )
        })
      )
      .toBe(true)

    await page.keyboard.insertText('Z')

    await editor.assert.text(afterFollowUpText)
    expect(await editor.get.modelText()).toContain(afterFollowUpText)
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [0, 5], offset: '<textarea>Z'.length },
        focus: { path: [0, 5], offset: '<textarea>Z'.length },
      })
    await expectDOMCaretAtTextEnd(editor.root, 'Z')
    await expectVisualCaretAtEndOfFirstBlock(editor.root)
  })

  test('keeps model and DOM coherent after persistent native word-delete', async ({
    browser,
    browserName,
  }, testInfo) => {
    if (browserName !== 'chromium' || testInfo.project.name === 'mobile') {
      return
    }

    const context = await browser.newContext({
      baseURL,
      userAgent: macChromeUserAgent,
    })
    const page = await context.newPage()

    try {
      const editor = await openExample(page, 'richtext', {
        ready: {
          editor: 'visible',
        },
      })
      const unchangedTailBlocks = [
        "Since it's rich text, you can do things like turn a selection of text bold, or add a semantically rendered block quote in the middle of the page, like this:",
        'A wise quote.',
        'Try it out for yourself!',
      ]

      await editor.click()
      await selectEndOfFirstBlockWithDOMSelection(editor.root)
      await editor.assert.domCaret({ offset: 1, text: '!' })

      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Alt+Backspace')

        await expect
          .poll(async () => (await editor.get.blockTexts()).slice(1))
          .toEqual(unchangedTailBlocks)
        await expectCollapsedDOMSelectionInsideEditable(editor.root)
      }

      await page.keyboard.insertText('Z')

      await expect
        .poll(async () => (await editor.get.blockTexts()).slice(1))
        .toEqual(unchangedTailBlocks)
      await expect
        .poll(async () => (await editor.get.blockTexts())[0]?.includes('Z'))
        .toBe(true)
      await expectCollapsedDOMSelectionInsideEditable(editor.root)
      await expect
        .poll(async () =>
          (await editor.get.kernelTrace()).some(
            (entry) =>
              (entry.eventFamily === 'keydown' ||
                entry.eventFamily === 'beforeinput') &&
              entry.command != null &&
              entry.command.kind === 'delete' &&
              entry.command.direction === 'backward' &&
              entry.command.unit === 'word'
          )
        )
        .toBe(true)
      await expect
        .poll(async () => {
          const trace = await editor.get.kernelTrace()
          const deleteEpochIds = trace
            .filter(
              (entry) =>
                (entry.eventFamily === 'keydown' ||
                  entry.eventFamily === 'beforeinput') &&
                entry.command?.kind === 'delete' &&
                entry.command.unit === 'word'
            )
            .map((entry) => entry.epochId)
          const repairSelectionchangeEpochIds = trace
            .filter(
              (entry) =>
                entry.eventFamily === 'selectionchange' &&
                entry.selectionChangeOrigin === 'repair-induced'
            )
            .map((entry) => entry.epochId)
          const deleteEpochIdSet = new Set(deleteEpochIds)
          const destructiveRepairSelectionchangeEpochIds =
            repairSelectionchangeEpochIds.filter((epochId) => epochId !== null)

          return {
            deleteEpochCount: deleteEpochIdSet.size,
            deleteEpochsArePresent: deleteEpochIds.every(
              (epochId) => epochId !== null
            ),
            destructiveRepairSelectionchangeCount:
              destructiveRepairSelectionchangeEpochIds.length,
            repairEpochsJoinDeleteEpochs:
              destructiveRepairSelectionchangeEpochIds.every((epochId) =>
                deleteEpochIdSet.has(epochId)
              ),
            repairTracesJoinDeleteEpochs: [...deleteEpochIdSet].every(
              (epochId) =>
                epochId !== null &&
                trace.some(
                  (entry) =>
                    entry.eventFamily === 'repair' && entry.epochId === epochId
                )
            ),
            repairSelectionChangesStayModelOwned: trace
              .filter(
                (entry) =>
                  entry.eventFamily === 'selectionchange' &&
                  entry.selectionChangeOrigin === 'repair-induced'
              )
              .every((entry) => entry.selectionSource === 'model-owned'),
          }
        })
        .toEqual({
          deleteEpochCount: 4,
          deleteEpochsArePresent: true,
          destructiveRepairSelectionchangeCount: 4,
          repairEpochsJoinDeleteEpochs: true,
          repairTracesJoinDeleteEpochs: true,
          repairSelectionChangesStayModelOwned: true,
        })
    } finally {
      await context.close()
    }
  })

  test('keeps rendered DOM shape after repeated leaf-boundary word-delete', async ({
    browser,
    browserName,
  }, testInfo) => {
    if (browserName !== 'chromium' || testInfo.project.name === 'mobile') {
      return
    }

    const context = await browser.newContext({
      baseURL,
      userAgent: macChromeUserAgent,
      viewport: { height: 560, width: 383 },
    })
    const page = await context.newPage()

    try {
      const editor = await openExample(page, 'richtext', {
        ready: {
          editor: 'visible',
        },
      })
      const unchangedTailBlocks = [
        "Since it's rich text, you can do things like turn a selection of text bold, or add a semantically rendered block quote in the middle of the page, like this:",
        'A wise quote.',
        'Try it out for yourself!',
      ]

      await editor.click()
      await selectEndOfFirstBlockWithDOMSelection(editor.root)
      await editor.assert.domCaret({ offset: 1, text: '!' })

      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Alt+Backspace')

        await expect
          .poll(async () => (await editor.get.blockTexts()).slice(1))
          .toEqual(unchangedTailBlocks)
      }

      const firstBlockModelText = (await editor.get.blockTexts())[0] ?? ''

      await editor.assert.renderedDOMShape({
        blockIndex: 0,
        innerText: firstBlockModelText,
        noUnexpectedZeroWidthBreaks: true,
        textContent: firstBlockModelText,
        zeroWidthBreakCount: 0,
        zeroWidthCount: 0,
      })

      await expectCollapsedDOMSelectionInsideEditable(editor.root)
      await page.keyboard.insertText('Z')
      await expect
        .poll(async () => (await editor.get.blockTexts())[0])
        .toContain('Z')
    } finally {
      await context.close()
    }
  })

  test('keeps caret editable after browser Backspace deletes selected range', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName === 'firefox' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })
    const afterDeleteText =
      ' is editable rich text, much better than a <textarea>!'
    const afterDeleteSelection = {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    }
    const afterFollowUpText =
      'Z is editable rich text, much better than a <textarea>!'

    await editor.click()
    await editor.selection.select({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 4 },
    })
    await page.keyboard.press('Backspace')

    await editor.assert.text(afterDeleteText)
    expect(await editor.get.modelText()).toContain(afterDeleteText)
    await expect
      .poll(() => editor.selection.get())
      .toEqual(afterDeleteSelection)
    await editor.assert.domCaret({ offset: 0, text: ' is editable ' })

    await page.keyboard.insertText('Z')

    await editor.assert.text(afterFollowUpText)
    expect(await editor.get.modelText()).toContain(afterFollowUpText)
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: 1 },
        focus: { path: [0, 0], offset: 1 },
      })
    await editor.assert.domCaret({ offset: 1, text: 'Z is editable ' })
  })

  test('keeps caret editable after browser Delete deletes selected range', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName === 'firefox' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })
    const afterDeleteText =
      ' is editable rich text, much better than a <textarea>!'
    const afterDeleteSelection = {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    }
    const afterFollowUpText =
      'Z is editable rich text, much better than a <textarea>!'

    await editor.click()
    await editor.selection.select({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 4 },
    })
    await page.keyboard.press('Delete')

    await editor.assert.text(afterDeleteText)
    expect(await editor.get.modelText()).toContain(afterDeleteText)
    await expect
      .poll(() => editor.selection.get())
      .toEqual(afterDeleteSelection)
    await editor.assert.domCaret({ offset: 0, text: ' is editable ' })

    await page.keyboard.insertText('Z')

    await editor.assert.text(afterFollowUpText)
    expect(await editor.get.modelText()).toContain(afterFollowUpText)
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: 1 },
        focus: { path: [0, 0], offset: 1 },
      })
    await editor.assert.domCaret({ offset: 1, text: 'Z is editable ' })
  })

  test('keeps selection synchronized after browser ArrowLeft and ArrowRight', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName === 'firefox' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.click()
    await editor.selection.select({
      anchor: { path: [0, 6], offset: 1 },
      focus: { path: [0, 6], offset: 1 },
    })
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [0, 6], offset: 1 },
        focus: { path: [0, 6], offset: 1 },
      })
    await page.keyboard.press('ArrowLeft')

    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [0, 6], offset: 0 },
        focus: { path: [0, 6], offset: 0 },
      })
    await expectDOMCaretAfterInsertedTextBeforeSuffix(editor.root, '', '!')

    await page.keyboard.press('ArrowRight')

    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [0, 6], offset: 1 },
        focus: { path: [0, 6], offset: 1 },
      })
    await expectDOMCaretAtTextEnd(editor.root, '!')
  })

  test('keeps ArrowDown then ArrowRight in the browser-selected paragraph', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName !== 'chromium' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.click()
    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })
    await editor.assert.domCaret({ offset: 0, text: 'This is editable ' })

    await page.keyboard.press('ArrowDown')
    await expect
      .poll(() => editor.selection.dom())
      .toEqual({
        anchorOffset: 0,
        anchorNodeText:
          "Since it's rich text, you can do things like turn a selection of text ",
        focusNodeText:
          "Since it's rich text, you can do things like turn a selection of text ",
        focusOffset: 0,
      })
    expect(await editor.get.kernelTrace()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventFamily: 'keydown',
          movement: expect.objectContaining({
            axis: 'vertical',
            key: 'ArrowDown',
            ownership: 'native-allowed',
            reason: 'native-vertical-layout',
          }),
        }),
      ])
    )

    await page.keyboard.press('ArrowRight')
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [1, 0], offset: 1 },
        focus: { path: [1, 0], offset: 1 },
      })
    await editor.assert.domCaret({
      offset: 1,
      text: "Since it's rich text, you can do things like turn a selection of text ",
    })
  })

  test('keeps navigation and mutation chained through browser editing state', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName !== 'chromium' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })

    const result = await editor.scenario.run(
      'richtext-navigation-mutation-gauntlet',
      [
        {
          kind: 'rootClick',
          label: 'activate-before-navigation-chain',
        },
        {
          kind: 'selectDOM',
          label: 'select-dom-navigation-start',
          selection: {
            anchor: { path: [0, 0], offset: 0 },
            focus: { path: [0, 0], offset: 0 },
          },
        },
        {
          key: 'ArrowDown',
          kind: 'press',
          label: 'navigate-arrow-down',
        },
        {
          kind: 'assertSelectionLocation',
          label: 'assert-after-arrow-down',
          location: {
            anchorOffset: 0,
            anchorPath: [1, 0],
            anchorText:
              "Since it's rich text, you can do things like turn a selection of text ",
            isCollapsed: true,
          },
        },
        {
          key: 'ArrowRight',
          kind: 'press',
          label: 'navigate-arrow-right-after-down',
        },
        {
          kind: 'assertSelection',
          label: 'assert-after-arrow-right-after-down',
          selection: {
            anchor: { path: [1, 0], offset: 1 },
            focus: { path: [1, 0], offset: 1 },
          },
        },
        {
          key: 'ArrowUp',
          kind: 'press',
          label: 'navigate-arrow-up',
        },
        {
          kind: 'assertSelectionLocation',
          label: 'assert-after-arrow-up',
          location: {
            anchorPath: [0, 0],
            anchorText: 'This is editable ',
          },
        },
        {
          key: 'ArrowRight',
          kind: 'press',
          label: 'navigate-arrow-right-after-up',
        },
        {
          kind: 'assertSelectionLocation',
          label: 'assert-stays-in-block-after-arrow-right',
          location: {
            anchorPath: [0, 0],
            anchorText: 'This is editable ',
          },
        },
        {
          kind: 'select',
          label: 'select-insert-backspace-start',
          selection: {
            anchor: { path: [0, 0], offset: 4 },
            focus: { path: [0, 0], offset: 4 },
          },
        },
        {
          kind: 'assertSelection',
          label: 'assert-insert-backspace-start',
          selection: {
            anchor: { path: [0, 0], offset: 4 },
            focus: { path: [0, 0], offset: 4 },
          },
        },
        {
          kind: 'type',
          label: 'type-before-backspace',
          text: 'Q',
        },
        {
          kind: 'assertSelection',
          label: 'assert-after-type-before-backspace',
          selection: {
            anchor: { path: [0, 0], offset: 5 },
            focus: { path: [0, 0], offset: 5 },
          },
        },
        {
          kind: 'assertDOMCaret',
          label: 'assert-caret-after-type-before-backspace',
          offset: 5,
          text: 'ThisQ is editable ',
        },
        {
          key: 'Backspace',
          kind: 'press',
          label: 'backspace-after-type',
        },
        {
          kind: 'assertSelection',
          label: 'assert-after-backspace',
          selection: {
            anchor: { path: [0, 0], offset: 4 },
            focus: { path: [0, 0], offset: 4 },
          },
        },
        {
          kind: 'assertDOMCaret',
          label: 'assert-caret-after-backspace',
          offset: 4,
          text: 'This is editable ',
        },
        {
          kind: 'select',
          label: 'select-delete-type-undo-range',
          selection: {
            anchor: { path: [0, 0], offset: 0 },
            focus: { path: [0, 0], offset: 4 },
          },
        },
        {
          key: 'Delete',
          kind: 'press',
          label: 'delete-selected-range',
        },
        {
          kind: 'assertSelection',
          label: 'assert-after-delete-selected-range',
          selection: {
            anchor: { path: [0, 0], offset: 0 },
            focus: { path: [0, 0], offset: 0 },
          },
        },
        {
          kind: 'assertDOMCaret',
          label: 'assert-caret-after-delete-selected-range',
          offset: 0,
          text: ' is editable ',
        },
        {
          caretAfterType: {
            offset: 1,
            text: 'Z is editable ',
          },
          caretAfterUndo: {
            offset: 0,
            text: ' is editable ',
          },
          expectedModelTextAfterType: 'Z is editable rich text',
          expectedModelTextAfterUndo: ' is editable rich text',
          kind: 'typeThenUndo',
          label: 'type-and-undo-after-selected-delete',
          text: 'Z',
        },
      ],
      {
        metadata: {
          capabilities: [
            'dom-selection',
            'keyboard-navigation',
            'model-selection',
            'text-mutation',
            'undo',
          ],
          platform: testInfo.project.name,
          transport: 'native-keyboard',
        },
        tracePath: testInfo.outputPath(
          'richtext-navigation-mutation-gauntlet.json'
        ),
      }
    )

    expect(result.metadata).toEqual({
      capabilities: [
        'dom-selection',
        'keyboard-navigation',
        'model-selection',
        'text-mutation',
        'undo',
      ],
      claim: 'desktop-native-keyboard',
      platform: testInfo.project.name,
      transport: 'native-keyboard',
    })
    expect(result.replay.replayable).toBe(true)
    expect(result.trace.map((entry) => entry.label)).toEqual([
      'activate-before-navigation-chain',
      'select-dom-navigation-start',
      'navigate-arrow-down',
      'assert-after-arrow-down',
      'navigate-arrow-right-after-down',
      'assert-after-arrow-right-after-down',
      'navigate-arrow-up',
      'assert-after-arrow-up',
      'navigate-arrow-right-after-up',
      'assert-stays-in-block-after-arrow-right',
      'select-insert-backspace-start',
      'assert-insert-backspace-start',
      'type-before-backspace',
      'assert-after-type-before-backspace',
      'assert-caret-after-type-before-backspace',
      'backspace-after-type',
      'assert-after-backspace',
      'assert-caret-after-backspace',
      'select-delete-type-undo-range',
      'delete-selected-range',
      'assert-after-delete-selected-range',
      'assert-caret-after-delete-selected-range',
      'type-and-undo-after-selected-delete',
    ])
  })

  test('records kernel commands for structural browser edits', async ({
    page,
  }) => {
    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.collapse({ path: [0, 0], offset: 4 })
    await editor.press('Backspace')
    await editor.press('Enter')

    const commands = (await editor.get.kernelTrace()).map(
      (entry) =>
        (
          entry as {
            command?: Record<string, unknown> | null
          }
        ).command
    )

    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: 'backward',
          kind: 'delete',
        }),
        expect.objectContaining({
          kind: 'insert-break',
          variant: 'paragraph',
        }),
      ])
    )
  })

  test('records kernel commands for proof-handle edits', async ({ page }) => {
    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.collapse({ path: [0, 0], offset: 4 })
    await editor.insertText('Z')
    await editor.deleteBackward()
    await editor.insertBreak()

    const commands = (await editor.get.kernelTrace()).map(
      (entry) =>
        (
          entry as {
            command?: Record<string, unknown> | null
          }
        ).command
    )

    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'insert-text',
          text: 'Z',
        }),
        expect.objectContaining({
          direction: 'backward',
          kind: 'delete',
        }),
        expect.objectContaining({
          kind: 'insert-break',
          variant: 'paragraph',
        }),
      ])
    )
  })

  test('records allowed kernel transitions for movement commands', async ({
    page,
  }) => {
    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.collapse({ path: [0, 6], offset: 0 })
    await editor.press('ArrowRight')

    const movementTrace = (await editor.get.kernelTrace()).find(
      (entry) =>
        (
          entry as {
            command?: { kind?: string } | null
          }
        ).command?.kind === 'move-selection'
    ) as
      | {
          transition?: {
            allowed?: boolean
            reason?: string | null
          }
        }
      | undefined

    expect(movementTrace?.transition).toEqual({
      allowed: true,
      reason: null,
    })
  })

  test('records core command metadata for keydown movement', async ({
    page,
  }) => {
    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.collapse({ path: [0, 6], offset: 0 })
    await editor.press('ArrowRight')

    const lastCommit = (await editor.get.lastCommit()) as {
      command?: { origin?: string; type?: string } | null
    } | null

    expect(lastCommit?.command).toEqual({
      origin: 'command',
      type: 'move_selection',
    })
  })

  test('records kernel policies for browser command and repair traces', async ({
    page,
  }, testInfo) => {
    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })
    const mobile = testInfo.project.name === 'mobile'

    await editor.selection.collapse({ path: [0, 6], offset: 0 })
    await editor.press('ArrowRight')

    await editor.selection.select({
      anchor: { path: [0, 0], offset: 4 },
      focus: { path: [0, 0], offset: 4 },
    })
    if (mobile) {
      await editor.insertText('P')
    } else {
      await editor.page.keyboard.type('P')
    }

    const trace = await editor.get.kernelTrace()
    const moveTrace = trace.find(
      (entry) =>
        (
          entry as {
            command?: { kind?: string } | null
          }
        ).command?.kind === 'move-selection'
    ) as
      | {
          repairPolicy?: unknown
          selectionPolicy?: unknown
        }
      | undefined
    const repairTrace = [...trace].reverse().find(
      (entry) =>
        (
          entry as {
            eventFamily?: string
          }
        ).eventFamily === 'repair'
    ) as
      | {
          repairPolicy?: unknown
          selectionPolicy?: unknown
        }
      | undefined

    expect(moveTrace?.selectionPolicy).toEqual({
      kind: 'import-dom',
      reason: 'unknown-selection',
    })
    expect(moveTrace?.repairPolicy).toEqual({
      kind: 'none',
      reason: 'not-requested',
    })
    if (!mobile) {
      expect(repairTrace?.selectionPolicy).toEqual({
        kind: 'preserve-model',
        reason: 'model-owned',
      })
      expect(repairTrace?.repairPolicy).toEqual({
        kind: 'repair-caret',
        reason: 'repair-caret-after-text-insert',
      })
    }
  })

  test('runs generated mark typing gauntlet without illegal kernel transitions', async ({
    page,
  }, testInfo) => {
    if (
      testInfo.project.name === 'mobile' ||
      testInfo.project.name === 'webkit'
    ) {
      return
    }

    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })

    const result = await editor.scenario.run(
      'richtext-generated-mark-typing-gauntlet',
      createSlateBrowserMarkTypingGauntlet({
        hotkey: 'Control+b',
        insertedText: 'MARK',
        selection: {
          anchor: { path: [0, 0], offset: 4 },
          focus: { path: [0, 0], offset: 4 },
        },
        textAfterInsert: 'MARK',
      }),
      {
        metadata: {
          capabilities: ['format', 'kernel-trace', 'mark'],
          platform: testInfo.project.name,
          transport: 'keyboard-and-handle',
        },
        tracePath: testInfo.outputPath('richtext-mark-typing-gauntlet.json'),
      }
    )

    assertNoIllegalKernelTransitions(result)
    expect(result.metadata.claim).toBe('mixed-native-and-semantic')
    expect(result.replay.replayable).toBe(true)
    await expect(
      editor.root.locator('strong').filter({ hasText: 'MARK' })
    ).toHaveCount(1)
  })

  test('keeps browser caret valid after marking selected text then clicking elsewhere', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName !== 'chromium' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })
    const result = await editor.scenario.run(
      'richtext-generated-mark-click-typing-gauntlet',
      createSlateBrowserMarkClickTypingGauntlet({
        clickPoint: { path: [1, 2], offset: 6 },
        domCaretAfterInsert: {
          offset: 7,
          text: ', you Ocan do things like turn a selection of text ',
        },
        hotkey: 'Control+b',
        insertedText: 'O',
        markSelection: {
          anchor: { path: [1, 0], offset: 16 },
          focus: { path: [1, 0], offset: 20 },
        },
        selectionTransport: 'dom',
        selectionAfterInsert: {
          anchor: { path: [1, 2], offset: 7 },
          focus: { path: [1, 2], offset: 7 },
        },
        textAfterInsert:
          "Since it's rich text, you Ocan do things like turn a selection of text",
      }),
      {
        metadata: {
          capabilities: [
            'dom-selection',
            'generated-gauntlet',
            'mark',
            'runtime-error-guard',
          ],
          platform: testInfo.project.name,
          transport: 'native-keyboard-and-click',
        },
        tracePath: testInfo.outputPath('richtext-mark-click-gauntlet.json'),
      }
    )

    assertNoIllegalKernelTransitions(result)
    expect(result.replay.replayable).toBe(true)
    await expect(
      editor.root.locator('strong').filter({ hasText: 'text' })
    ).toHaveCount(1)
  })

  test('keeps browser caret valid after toolbar marking selected text then clicking elsewhere', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName !== 'chromium' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })
    const result = await editor.scenario.run(
      'richtext-toolbar-mark-click-caret-conformance',
      createSlateBrowserToolbarMarkClickTypingGauntlet({
        clickPoint: { path: [1, 2], offset: 6 },
        domCaretAfterInsert: {
          offset: 7,
          text: ', you Ocan do things like turn a selection of text ',
        },
        insertedText: 'O',
        markButtonTestId: 'mark-button-bold',
        markSelection: {
          anchor: { path: [1, 0], offset: 16 },
          focus: { path: [1, 0], offset: 20 },
        },
        selectionAfterInsert: {
          anchor: { path: [1, 2], offset: 7 },
          focus: { path: [1, 2], offset: 7 },
        },
        textAfterInsert:
          "Since it's rich text, you Ocan do things like turn a selection of text",
      }),
      {
        metadata: {
          capabilities: [
            'caret',
            'dom-selection',
            'generated-gauntlet',
            'mark',
            'runtime-error-guard',
            'toolbar-command',
          ],
          platform: testInfo.project.name,
          transport: 'native-click-and-keyboard',
        },
        tracePath: testInfo.outputPath(
          'richtext-toolbar-mark-click-caret-conformance.json'
        ),
      }
    )

    assertNoIllegalKernelTransitions(result)
    expect(result.replay.replayable).toBe(true)
    await expect(
      editor.root.locator('strong').filter({ hasText: 'text' })
    ).toHaveCount(1)
  })

  test('keeps browser caret valid after native word selection toolbar mark then clicking elsewhere', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName !== 'chromium' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })
    const result = await editor.scenario.run(
      'richtext-native-word-toolbar-mark-click-caret-conformance',
      [
        {
          kind: 'doubleClickTextOffset',
          label: 'native-select-word',
          offset: 18,
          path: [1, 0],
        },
        {
          kind: 'clickTestId',
          label: 'toggle-mark-from-toolbar',
          testId: 'mark-button-bold',
        },
        {
          kind: 'clickTextOffset',
          label: 'click-after-toolbar-mark-split',
          offset: 6,
          path: [1, 2],
        },
        {
          kind: 'type',
          label: 'type-after-toolbar-mark-click',
          text: 'O',
        },
        {
          kind: 'assertKernelTrace',
          label: 'assert-repair-trace-after-toolbar-mark-click',
          trace: {
            eventFamily: 'repair',
            repairPolicy: { kind: 'repair-caret' },
            transition: { allowed: true },
          },
        },
        {
          kind: 'assertText',
          label: 'assert-text-after-toolbar-mark-click',
          text: "Since it's rich text, you Ocan do things like turn a selection of text",
        },
        {
          kind: 'assertSelection',
          label: 'assert-selection-after-toolbar-mark-click',
          selection: {
            anchor: { path: [1, 2], offset: 7 },
            focus: { path: [1, 2], offset: 7 },
          },
        },
        {
          focusOwner: 'editor',
          kind: 'assertFocusOwner',
          label: 'assert-editor-focus-after-toolbar-mark-click',
        },
        {
          kind: 'assertLastCommit',
          label: 'assert-commit-after-toolbar-mark-click',
        },
        {
          kind: 'assertDOMCaret',
          label: 'assert-dom-caret-after-toolbar-mark-click',
          offset: 7,
          text: ', you Ocan do things like turn a selection of text ',
        },
      ],
      {
        metadata: {
          capabilities: [
            'caret',
            'dom-selection',
            'mark',
            'native-word-selection',
            'runtime-error-guard',
            'toolbar-command',
          ],
          platform: testInfo.project.name,
          transport: 'native-click-and-keyboard',
        },
        tracePath: testInfo.outputPath(
          'richtext-native-word-toolbar-mark-click-caret-conformance.json'
        ),
      }
    )

    assertNoIllegalKernelTransitions(result)
    expect(result.replay.replayable).toBe(true)
    await expect(
      editor.root.locator('strong').filter({ hasText: 'text' })
    ).toHaveCount(1)
  })

  test('applies toolbar heading to the browser-selected paragraph', async ({
    page,
  }) => {
    test.setTimeout(60_000)

    const runtimeErrors = recordSlateBrowserRuntimeErrors(page)
    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })

    try {
      await editor.selection.collapse({ path: [0, 0], offset: 0 })
      await editor.assert.selection({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      })
      await editor.root.dispatchEvent('mousedown')
      await editor.selection.selectDOM({
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 0 },
      })
      await expect
        .poll(() => editor.selection.location())
        .toMatchObject({
          anchorOffset: 0,
          anchorPath: [1, 0],
          isCollapsed: true,
        })

      await page.getByTestId('block-button-heading-one').click()

      runtimeErrors.assertNone()
      expect(
        await page
          .locator('[data-slate-editor] h1')
          .filter({ hasText: "Since it's rich text" })
          .count()
      ).toBe(1)
      expect(
        await page
          .locator('[data-slate-editor] h1')
          .filter({ hasText: 'This is editable rich text' })
          .count()
      ).toBe(0)
      expect(await editor.selection.get()).toEqual({
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 0 },
      })

      await page.keyboard.type('Q')

      await editor.assert.text("QSince it's rich text")
      expect(await editor.get.text()).toContain("QSince it's rich text")
      expect(await editor.selection.get()).toEqual({
        anchor: { path: [1, 0], offset: 1 },
        focus: { path: [1, 0], offset: 1 },
      })
      await editor.assert.domCaret({
        offset: 1,
        text: "QSince it's rich text, you can do things like turn a selection of text ",
      })
    } finally {
      runtimeErrors.stop()
    }
  })

  test('applies toolbar heading from browser target even when model selection is already heading', async ({
    page,
  }) => {
    test.setTimeout(60_000)

    const runtimeErrors = recordSlateBrowserRuntimeErrors(page)
    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })

    try {
      await editor.selection.select({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 4 },
      })
      await page.getByTestId('block-button-heading-one').click()
      await expect(
        page
          .locator('[data-slate-editor] h1')
          .filter({ hasText: 'This is editable rich text' })
      ).toHaveCount(1)

      await editor.root.dispatchEvent('mousedown')
      await editor.selection.selectDOM({
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 0 },
      })
      await expect
        .poll(() => editor.selection.location())
        .toMatchObject({
          anchorOffset: 0,
          anchorPath: [1, 0],
          isCollapsed: true,
        })

      await page.getByTestId('block-button-heading-one').click()

      runtimeErrors.assertNone()
      await expect(page.locator('[data-slate-editor] h1')).toHaveCount(2)
      await expect(
        page
          .locator('[data-slate-editor] h1')
          .filter({ hasText: "Since it's rich text" })
      ).toHaveCount(1)
      expect(await editor.selection.get()).toEqual({
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 0 },
      })
    } finally {
      runtimeErrors.stop()
    }
  })

  test('applies toolbar bold to the browser-selected text', async ({
    page,
  }) => {
    test.setTimeout(60_000)

    const runtimeErrors = recordSlateBrowserRuntimeErrors(page)
    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })

    try {
      await editor.selection.select({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 4 },
      })
      await page.getByTestId('mark-button-bold').click()
      await expect(
        editor.root.locator('strong').filter({ hasText: 'This' })
      ).toHaveCount(1)

      await editor.root.dispatchEvent('mousedown')
      await editor.selection.selectDOM({
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 5 },
      })
      await expect
        .poll(() => editor.selection.location())
        .toMatchObject({
          anchorOffset: 0,
          anchorPath: [1, 0],
          isCollapsed: false,
        })

      await page.getByTestId('mark-button-bold').click()

      runtimeErrors.assertNone()
      await expect(
        editor.root.locator('strong').filter({ hasText: 'This' })
      ).toHaveCount(1)
      await expect(
        editor.root.locator('strong').filter({ hasText: 'Since' })
      ).toHaveCount(1)
      expect(await editor.selection.get()).toEqual({
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 5 },
      })
    } finally {
      runtimeErrors.stop()
    }
  })

  test('keeps selected word expanded after toggling toolbar bold off', async ({
    page,
  }) => {
    test.setTimeout(60_000)

    const runtimeErrors = recordSlateBrowserRuntimeErrors(page)
    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })

    try {
      await editor.root.dispatchEvent('mousedown')
      await editor.selection.selectDOM({
        anchor: { path: [0, 0], offset: 8 },
        focus: { path: [0, 0], offset: 16 },
      })
      await expectEditableWordSelected(editor.root)
      await editor.assert.focusOwner('editor')

      await page.getByTestId('mark-button-bold').click()
      await expectEditableWordSelected(editor.root)
      await editor.assert.focusOwner('editor')

      const boldSelection = await editor.selection.get()
      expect(boldSelection).not.toBeNull()
      expect(boldSelection?.anchor).not.toEqual(boldSelection?.focus)

      await page.getByTestId('mark-button-bold').click()

      runtimeErrors.assertNone()
      await expectEditableWordSelected(editor.root)
      await editor.assert.focusOwner('editor')

      const unboldSelection = await editor.selection.get()
      expect(unboldSelection).not.toBeNull()
      expect(unboldSelection?.anchor).not.toEqual(unboldSelection?.focus)
    } finally {
      runtimeErrors.stop()
    }
  })

  test('keeps warm toolbar mark selection usable through arrows without reload', async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === 'mobile') {
      return
    }

    test.setTimeout(90_000)

    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })
    const result = await editor.scenario.run(
      'richtext-warm-toolbar-mark-arrow-conformance',
      createSlateBrowserWarmToolbarArrowGauntlet({
        domCaretAfterInsert: {
          offset: 9,
          text: 'editableW',
        },
        insertedText: 'W',
        markDOMSelection: {
          anchorNodeText: 'This is editable ',
          anchorOffset: 8,
          focusNodeText: 'This is editable ',
          focusOffset: 16,
        },
        markButtonTestId: 'mark-button-bold',
        markSelection: {
          anchor: { path: [0, 0], offset: 8 },
          focus: { path: [0, 0], offset: 16 },
        },
        selectedText: 'editable',
        selectionAfterArrowLeft: {
          anchor: { path: [0, 1], offset: 7 },
          focus: { path: [0, 1], offset: 7 },
        },
        selectionAfterCollapse: {
          anchor: { path: [0, 1], offset: 8 },
          focus: { path: [0, 1], offset: 8 },
        },
        selectionAfterInsert: {
          anchor: { path: [0, 1], offset: 9 },
          focus: { path: [0, 1], offset: 9 },
        },
        textAfterInsert:
          'This is editableW rich text, much better than a <textarea>!',
        warmIterationOverrides: [
          {},
          {
            markDOMSelection: {
              anchorNodeText: 'editable',
              anchorOffset: 0,
              focusNodeText: 'editable',
              focusOffset: 8,
            },
            markSelection: {
              anchor: { path: [0, 1], offset: 0 },
              focus: { path: [0, 1], offset: 8 },
            },
            selectionAfterArrowLeft: {
              anchor: { path: [0, 1], offset: 7 },
              focus: { path: [0, 1], offset: 7 },
            },
            selectionAfterCollapse: {
              anchor: { path: [0, 1], offset: 8 },
              focus: { path: [0, 1], offset: 8 },
            },
          },
        ],
        warmIterations: 2,
      }),
      {
        metadata: {
          capabilities: [
            'caret',
            'dom-selection',
            'generated-gauntlet',
            'kernel-trace',
            'no-refresh',
            'toolbar-command',
            'warm-state',
          ],
          platform: testInfo.project.name,
          transport: 'native-click-and-keyboard',
        },
        tracePath: testInfo.outputPath(
          'richtext-warm-toolbar-mark-arrow-conformance.json'
        ),
      }
    )

    assertNoIllegalKernelTransitions(result)
    expect(result.replay.replayable).toBe(true)
    expect(result.trace.map((entry) => entry.label)).toEqual(
      expect.arrayContaining(['warm-select-word-2'])
    )
    expect(result.reductionCandidates.length).toBeGreaterThan(0)
    expect(result.reductionCandidates[0]?.stepLabels).toContain(
      'activate-editor-before-warm-selection'
    )
    expect(result.reductionCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'iteration',
          label: 'warm-toolbar-arrow:iteration:2',
        }),
      ])
    )
    const secondIterationCandidate = result.reductionCandidates.find(
      (candidate) => candidate.label === 'warm-toolbar-arrow:iteration:2'
    )

    expect(secondIterationCandidate?.replay.replayable).toBe(true)
    expect(secondIterationCandidate?.replay.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'clickTestId',
          label: 'warm-bold-on-1',
          value: expect.objectContaining({
            kind: 'clickTestId',
            testId: 'mark-button-bold',
          }),
        }),
        expect.objectContaining({
          kind: 'assertSelectedText',
          label: 'assert-selection-expanded-after-bold-off-1',
          value: expect.objectContaining({
            kind: 'assertSelectedText',
            text: 'editable',
          }),
        }),
      ])
    )
    const kernelTrace = result.trace.flatMap(
      (entry) => entry.snapshot.kernelTrace
    )

    expect(kernelTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventFamily: 'keydown',
          frame: expect.objectContaining({ eventFamily: 'keydown' }),
          frameId: expect.any(Number),
          movement: expect.objectContaining({
            axis: 'horizontal',
            ownership: 'model-owned',
            reason: 'model-horizontal-inline-void-compat',
          }),
        }),
        expect.objectContaining({
          eventFamily: 'repair',
          frameId: expect.any(Number),
          selectionChangeOrigin: 'repair-induced',
        }),
      ])
    )
    await expect
      .poll(() =>
        editor.root.evaluate((root) => {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
          let count = 0
          let node = walker.nextNode()

          while (node) {
            if (node.textContent === 'editableW') {
              count++
            }
            node = walker.nextNode()
          }

          return count
        })
      )
      .toBe(1)
  })

  test('applies toolbar alignment from browser target even when model selection already has alignment', async ({
    page,
  }) => {
    test.setTimeout(60_000)

    const runtimeErrors = recordSlateBrowserRuntimeErrors(page)
    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })

    try {
      await editor.selection.select({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 4 },
      })
      await page.getByTestId('block-button-center').click()
      await expect(page.locator('[data-slate-editor] p').first()).toHaveCSS(
        'text-align',
        'center'
      )

      await editor.root.dispatchEvent('mousedown')
      await editor.selection.selectDOM({
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 0 },
      })

      await page.getByTestId('block-button-center').click()

      runtimeErrors.assertNone()
      await expect(page.locator('[data-slate-editor] p').first()).toHaveCSS(
        'text-align',
        'center'
      )
      await expect(page.locator('[data-slate-editor] p').nth(1)).toHaveCSS(
        'text-align',
        'center'
      )
      expect(await editor.selection.get()).toEqual({
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 0 },
      })
    } finally {
      runtimeErrors.stop()
    }
  })

  test('applies toolbar list from browser target even when model selection already has list', async ({
    page,
  }) => {
    test.setTimeout(60_000)

    const runtimeErrors = recordSlateBrowserRuntimeErrors(page)
    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })

    try {
      await editor.selection.select({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 4 },
      })
      await page.getByTestId('block-button-bulleted-list').click()
      await expect(
        page
          .locator('[data-slate-editor] ul')
          .filter({ hasText: 'This is editable rich text' })
      ).toHaveCount(1)

      await editor.root.dispatchEvent('mousedown')
      await editor.selection.selectDOM({
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 0 },
      })

      await page.getByTestId('block-button-bulleted-list').click()

      runtimeErrors.assertNone()
      await expect(
        page
          .locator('[data-slate-editor] ul')
          .filter({ hasText: 'This is editable rich text' })
      ).toHaveCount(1)
      await expect(
        page
          .locator('[data-slate-editor] ul')
          .filter({ hasText: "Since it's rich text" })
      ).toHaveCount(1)
      expect(await editor.selection.get()).toEqual({
        anchor: { path: [1, 0, 0], offset: 0 },
        focus: { path: [1, 0, 0], offset: 0 },
      })
    } finally {
      runtimeErrors.stop()
    }
  })

  test('records core command metadata for text input and delete', async ({
    page,
  }, testInfo) => {
    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })
    const mobile = testInfo.project.name === 'mobile'

    const result = await editor.scenario.run(
      'text-input-delete-command-metadata',
      [
        {
          kind: 'select',
          label: 'select-text-input-start',
          selection: {
            anchor: { path: [0, 0], offset: 4 },
            focus: { path: [0, 0], offset: 4 },
          },
        },
        mobile
          ? {
              kind: 'insertText' as const,
              label: 'semantic-text-input',
              text: 'Q',
            }
          : {
              kind: 'type' as const,
              label: 'native-text-input',
              text: 'Q',
            },
        {
          kind: 'assertSelection',
          label: 'assert-selection-after-text-input',
          selection: {
            anchor: { path: [0, 0], offset: 5 },
            focus: { path: [0, 0], offset: 5 },
          },
        },
        ...(mobile
          ? []
          : [
              {
                kind: 'assertDOMCaret' as const,
                label: 'assert-caret-after-native-text-input',
                offset: 5,
                text: 'ThisQ is editable ',
              },
            ]),
        {
          kind: 'assertModelText',
          label: 'assert-model-text-after-text-input',
          text: 'ThisQ is editable rich text',
        },
        {
          kind: 'assertText',
          label: 'assert-dom-text-after-text-input',
          text: 'ThisQ is editable rich text',
        },
        {
          command: {
            origin: 'command',
            type: 'insert_text',
          },
          kind: 'assertLastCommitCommand',
          label: 'assert-commit-after-text-input',
        },
        mobile
          ? {
              kind: 'deleteBackward' as const,
              label: 'semantic-backspace',
            }
          : {
              key: 'Backspace',
              kind: 'press' as const,
              label: 'native-backspace',
            },
        {
          kind: 'assertSelection',
          label: 'assert-selection-after-backspace',
          selection: {
            anchor: { path: [0, 0], offset: 4 },
            focus: { path: [0, 0], offset: 4 },
          },
        },
        ...(mobile
          ? []
          : [
              {
                kind: 'assertDOMCaret' as const,
                label: 'assert-caret-after-native-backspace',
                offset: 4,
                text: 'This is editable ',
              },
            ]),
        {
          kind: 'assertModelText',
          label: 'assert-model-text-after-backspace',
          text: 'This is editable rich text',
        },
        {
          kind: 'assertText',
          label: 'assert-dom-text-after-backspace',
          text: 'This is editable rich text',
        },
        {
          command: {
            origin: 'command',
            type: 'delete',
          },
          kind: 'assertLastCommitCommand',
          label: 'assert-commit-after-backspace',
        },
      ],
      {
        metadata: {
          capabilities: [
            'core-command-metadata',
            'dom-selection',
            'model-selection',
            'text-mutation',
          ],
          platform: testInfo.project.name,
          transport: mobile ? 'semantic-handle' : 'native-keyboard',
        },
      }
    )

    assertNoIllegalKernelTransitions(result)
    expect(result.replay.replayable).toBe(true)
  })

  test('records selectionchange and repair kernel results', async ({
    page,
  }, testInfo) => {
    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })
    const mobile = testInfo.project.name === 'mobile'

    const result = await editor.scenario.run(
      'selectionchange-repair-kernel-results',
      [
        {
          kind: 'rootClick',
          label: 'selectionchange-trace',
        },
        {
          kind: 'assertKernelTrace',
          label: 'assert-selectionchange-trace',
          trace: {
            eventFamily: 'selectionchange',
            transition: { allowed: true },
          },
        },
        {
          kind: 'select',
          label: 'select-text-repair-start',
          selection: {
            anchor: { path: [0, 0], offset: 4 },
            focus: { path: [0, 0], offset: 4 },
          },
        },
        mobile
          ? {
              kind: 'insertText' as const,
              label: 'semantic-text-repair',
              text: 'R',
            }
          : {
              kind: 'type' as const,
              label: 'native-text-repair',
              text: 'R',
            },
        {
          kind: 'assertSelection',
          label: 'assert-selection-after-text-repair',
          selection: {
            anchor: { path: [0, 0], offset: 5 },
            focus: { path: [0, 0], offset: 5 },
          },
        },
        ...(mobile
          ? []
          : [
              {
                kind: 'assertDOMCaret' as const,
                label: 'assert-caret-after-native-text-repair',
                offset: 5,
                text: 'ThisR is editable ',
              },
            ]),
        {
          kind: 'assertModelText',
          label: 'assert-model-text-after-text-repair',
          text: 'ThisR is editable rich text',
        },
        {
          kind: 'assertText',
          label: 'assert-dom-text-after-text-repair',
          text: 'ThisR is editable rich text',
        },
        {
          kind: 'assertKernelTrace',
          label: 'assert-repair-trace',
          trace: {
            eventFamily: 'repair',
            transition: { allowed: true },
          },
        },
      ],
      {
        metadata: {
          capabilities: [
            'dom-selection',
            'kernel-repair',
            'model-selection',
            'text-mutation',
          ],
          platform: testInfo.project.name,
          transport: mobile ? 'semantic-handle' : 'native-keyboard',
        },
      }
    )

    assertNoIllegalKernelTransitions(result)
    expect(result.replay.replayable).toBe(true)
  })

  test('imports programmatic DOM selection through explicit browser handle', async ({
    page,
  }) => {
    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.root.click()
    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 4 },
      focus: { path: [0, 0], offset: 4 },
    })

    await editor.selection.importDOM()

    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 4 },
      focus: { path: [0, 0], offset: 4 },
    })

    const importTrace = [...(await editor.get.kernelTrace())].reverse().find(
      (entry) =>
        (
          entry as {
            eventFamily?: string
            selectionPolicy?: { kind?: string }
          }
        ).eventFamily === 'selectionchange' &&
        (
          entry as {
            selectionPolicy?: { kind?: string }
          }
        ).selectionPolicy?.kind === 'import-dom'
    ) as
      | {
          selectionAfter?: unknown
          selectionPolicy?: unknown
          transition?: unknown
        }
      | undefined

    expect(importTrace?.selectionAfter).toEqual({
      anchor: { path: [0, 0], offset: 4 },
      focus: { path: [0, 0], offset: 4 },
    })
    expect(importTrace?.selectionPolicy).toMatchObject({
      kind: 'import-dom',
    })
    expect(['native-selection', 'unknown-selection']).toContain(
      (
        importTrace?.selectionPolicy as
          | {
              reason?: string
            }
          | undefined
      )?.reason
    )
    expect(importTrace?.transition).toEqual({
      allowed: true,
      reason: null,
    })
  })

  test('records repair trace with observable DOM and model selection', async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.select({
      anchor: { path: [0, 0], offset: 4 },
      focus: { path: [0, 0], offset: 4 },
    })
    await editor.page.keyboard.type('R')

    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 5 },
      focus: { path: [0, 0], offset: 5 },
    })
    await editor.assert.domSelection({
      anchorNodeText: 'ThisR is editable ',
      anchorOffset: 5,
      focusNodeText: 'ThisR is editable ',
      focusOffset: 5,
    })

    const repairTrace = [...(await editor.get.kernelTrace())].reverse().find(
      (entry) =>
        (
          entry as {
            eventFamily?: string
            repairPolicy?: { kind?: string }
          }
        ).eventFamily === 'repair' &&
        (
          entry as {
            repairPolicy?: { kind?: string }
          }
        ).repairPolicy?.kind === 'repair-caret'
    ) as
      | {
          repairPolicy?: unknown
          selectionAfter?: unknown
          selectionPolicy?: unknown
        }
      | undefined

    expect(repairTrace?.selectionAfter).toEqual({
      anchor: { path: [0, 0], offset: 5 },
      focus: { path: [0, 0], offset: 5 },
    })
    expect(repairTrace?.selectionPolicy).toEqual({
      kind: 'preserve-model',
      reason: 'model-owned',
    })
    expect(repairTrace?.repairPolicy).toEqual({
      kind: 'repair-caret',
      reason: 'repair-caret-after-text-insert',
    })
  })

  test('keeps selection synchronized after browser word movement', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName === 'firefox' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.click()
    await editor.selection.select({
      anchor: { path: [0, 4], offset: 4 },
      focus: { path: [0, 4], offset: 4 },
    })

    await page.keyboard.press('Control+ArrowLeft')

    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [0, 4], offset: 1 },
        focus: { path: [0, 4], offset: 1 },
      })
    await expect
      .poll(() =>
        editor.root.evaluate((element: HTMLElement) => {
          const selection = element.ownerDocument.getSelection()

          return Boolean(
            selection?.isCollapsed &&
              selection.anchorNode &&
              selection.focusNode &&
              element.contains(selection.anchorNode) &&
              element.contains(selection.focusNode)
          )
        })
      )
      .toBe(true)
    expect(await editor.get.kernelTrace()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: expect.objectContaining({
            axis: 'word',
            kind: 'move-selection',
          }),
          eventFamily: 'keydown',
          movement: expect.objectContaining({
            axis: 'word',
            ownership: 'model-owned',
            reason: 'model-word-boundary-compat',
          }),
        }),
      ])
    )

    await page.keyboard.press('Control+ArrowRight')

    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [0, 4], offset: 7 },
        focus: { path: [0, 4], offset: 7 },
      })
    await expect
      .poll(() =>
        editor.root.evaluate((element: HTMLElement) => {
          const selection = element.ownerDocument.getSelection()

          return Boolean(
            selection?.isCollapsed &&
              selection.anchorNode &&
              selection.focusNode &&
              element.contains(selection.anchorNode) &&
              element.contains(selection.focusNode)
          )
        })
      )
      .toBe(true)
    expect(await editor.get.kernelTrace()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: expect.objectContaining({
            axis: 'word',
            kind: 'move-selection',
          }),
          eventFamily: 'keydown',
          movement: expect.objectContaining({
            axis: 'word',
            ownership: 'model-owned',
            reason: 'model-word-boundary-compat',
          }),
        }),
      ])
    )
  })

  test('keeps selection synchronized after browser line extension', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL,
      userAgent: macChromeUserAgent,
    })
    const page = await context.newPage()

    try {
      const editor = await openExample(page, 'richtext', {
        ready: {
          editor: 'visible',
        },
      })

      await editor.click()
      await editor.selection.select({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      })

      await page.keyboard.press('Alt+Shift+ArrowDown')

      await expect
        .poll(() => editor.selection.get())
        .toEqual({
          anchor: { path: [0, 0], offset: 0 },
          focus: { path: [0, 6], offset: 1 },
        })
      await expect
        .poll(() =>
          editor.root.evaluate((element: HTMLElement) => {
            const selection = element.ownerDocument.getSelection()

            return Boolean(
              selection &&
                !selection.isCollapsed &&
                selection.anchorNode &&
                selection.focusNode &&
                element.contains(selection.anchorNode) &&
                element.contains(selection.focusNode)
            )
          })
        )
        .toBe(true)
      expect(await editor.get.kernelTrace()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            command: expect.objectContaining({
              axis: 'line',
              extend: true,
              kind: 'move-selection',
            }),
            eventFamily: 'keydown',
            movement: expect.objectContaining({
              axis: 'line',
              extend: true,
              ownership: 'model-owned',
              reason: 'model-line-browser-compat',
            }),
          }),
        ])
      )
    } finally {
      await context.close()
    }
  })

  test('selects the current block on browser triple click', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName === 'firefox' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.click()
    await page.locator('[data-slate-editor] p').first().click({ clickCount: 3 })

    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 6], offset: 1 },
      })
    await expect
      .poll(() =>
        editor.root.evaluate((element: HTMLElement) => {
          const selection = element.ownerDocument.getSelection()

          return Boolean(
            selection &&
              !selection.isCollapsed &&
              selection.anchorNode &&
              selection.focusNode &&
              element.contains(selection.anchorNode) &&
              element.contains(selection.focusNode)
          )
        })
      )
      .toBe(true)
  })

  test('keeps the visual caret after browser insertion at the selected text end', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName === 'firefox' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.click()
    await selectEndOfFirstBlockWithDOMSelection(editor.root)
    await page.keyboard.insertText('O')

    await editor.assert.text(
      'This is editable rich text, much better than a <textarea>!O'
    )
    expect(await editor.get.modelText()).toContain(
      'This is editable rich text, much better than a <textarea>!O'
    )
    await expectDOMCaretAtTextEnd(editor.root, '!O')
    await expectVisualCaretAtEndOfFirstBlock(editor.root)
  })

  test('keeps the visual caret after browser insertion before trailing punctuation', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName === 'firefox' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.click()
    await editor.selection.select({
      anchor: { path: [0, 6], offset: 0 },
      focus: { path: [0, 6], offset: 0 },
    })
    await page.keyboard.insertText('O')

    await editor.assert.text(
      'This is editable rich text, much better than a <textarea>O!'
    )
    expect(await editor.get.modelText()).toContain(
      'This is editable rich text, much better than a <textarea>O!'
    )
    await expectDOMCaretAfterInsertedTextBeforeSuffix(editor.root, 'O', '!')
  })

  test('keeps the visual caret after browser insertion inside a text leaf', async ({
    browserName,
    page,
  }, testInfo) => {
    if (browserName === 'firefox' || testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.click()
    await editor.selection.select({
      anchor: { path: [0, 2], offset: 1 },
      focus: { path: [0, 2], offset: 1 },
    })
    await page.keyboard.insertText('O')

    await editor.assert.text(
      'This is editable rich Otext, much better than a <textarea>!'
    )
    expect(await editor.get.modelText()).toContain(
      'This is editable rich Otext, much better than a <textarea>!'
    )
    await editor.assert.domCaret({ offset: 2, text: ' Otext, ' })
  })

  test('undoes inserted text', async ({ browserName, page }, testInfo) => {
    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })

    if (browserName === 'firefox' || testInfo.project.name === 'mobile') {
      await editor.selection.select({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      })
      await editor.insertText('Undo Me')
    } else {
      await editor.click()
      await editor.root.press('Home')
      await page.keyboard.insertText('Undo Me')
    }

    await editor.assert.text('Undo Me')
    expect(await editor.get.modelText()).toContain('Undo Me')

    if (browserName === 'firefox' || testInfo.project.name === 'mobile') {
      await editor.undo()
    } else {
      await page.keyboard.press(await getBrowserUndoHotkey(editor.root))
    }

    await expect(editor.root).not.toContainText('Undo Me')
    expect(await editor.get.modelText()).not.toContain('Undo Me')
  })

  test('repairs DOM after Mac keyboard undo', async ({ browser }) => {
    const context = await browser.newContext({
      baseURL,
      userAgent: macChromeUserAgent,
    })
    const page = await context.newPage()

    try {
      const editor = await openExample(page, 'richtext', {
        ready: {
          editor: 'visible',
        },
      })

      await editor.click()
      await expect(editor.root).toBeFocused()
      await editor.root.press('Home')
      await expect(editor.root).toBeFocused()
      await page.keyboard.type('Undo Me')

      await editor.assert.text('Undo Me')
      expect(await editor.get.modelText()).toContain('Undo Me')

      await page.keyboard.press('Meta+Z')

      expect(await editor.get.modelText()).not.toContain('Undo Me')
      await expect(editor.root).not.toContainText('Undo Me')
    } finally {
      await context.close()
    }
  })

  test('undo restores deleted selected text', async ({ page }) => {
    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.assert.text('This is editable rich text')
    await editor.selection.select({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 'This is editable '.length },
    })
    await editor.deleteFragment()
    await expect(editor.root).not.toContainText('This is editable rich text')

    await editor.undo()
    await editor.assert.text('This is editable rich text')
  })

  test('keeps caret editable after plain text paste over selected range', async ({
    page,
  }, testInfo) => {
    const editor = await openExample(page, 'richtext', {
      ready: {
        editor: 'visible',
      },
    })
    const afterPasteText =
      'Paste is editable rich text, much better than a <textarea>!'
    const afterTypingText =
      'Paste! is editable rich text, much better than a <textarea>!'

    await editor.selection.select({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 4 },
    })

    if (testInfo.project.name === 'mobile') {
      await editor.insertText('Paste')
    } else {
      await editor.clipboard.pasteText('Paste')
    }

    await editor.assert.text(afterPasteText)
    if (testInfo.project.name === 'mobile') {
      await editor.selection.select({
        anchor: { path: [0, 0], offset: 5 },
        focus: { path: [0, 0], offset: 5 },
      })
    } else {
      await editor.assert.selection({
        anchor: { path: [0, 0], offset: 5 },
        focus: { path: [0, 0], offset: 5 },
      })
      await editor.assert.domSelection({
        anchorNodeText: 'Paste is editable ',
        anchorOffset: 5,
        focusNodeText: 'Paste is editable ',
        focusOffset: 5,
      })
    }

    if (testInfo.project.name === 'mobile') {
      await editor.insertText('!')
    } else {
      await editor.type('!')
    }

    await editor.assert.text(afterTypingText)
    if (testInfo.project.name !== 'mobile') {
      await editor.assert.selection({
        anchor: { path: [0, 0], offset: 6 },
        focus: { path: [0, 0], offset: 6 },
      })
      await editor.assert.domSelection({
        anchorNodeText: 'Paste! is editable ',
        anchorOffset: 6,
        focusNodeText: 'Paste! is editable ',
        focusOffset: 6,
      })
    }
  })

  test('does not duplicate native input handling after route remount', async ({
    page,
  }, testInfo) => {
    const typeText = async (
      editor: Awaited<ReturnType<typeof openExample>>,
      text: string
    ) => {
      if (testInfo.project.name === 'mobile') {
        await editor.insertText(text)
        return
      }

      await editor.type(text)
    }

    const editor = await openExample(page, 'richtext', {
      ready: { editor: 'visible' },
    })

    await editor.selection.collapse({ path: [0, 6], offset: 1 })
    await typeText(editor, 'A')
    await editor.assert.text(
      'This is editable rich text, much better than a <textarea>!A'
    )

    await page.goto('/examples/plaintext')

    const remountedEditor = await openExample(page, 'richtext', {
      ready: { editor: 'visible' },
    })

    await remountedEditor.selection.collapse({ path: [0, 6], offset: 1 })
    await typeText(remountedEditor, 'B')
    await remountedEditor.assert.text(
      'This is editable rich text, much better than a <textarea>!B'
    )
  })
})
