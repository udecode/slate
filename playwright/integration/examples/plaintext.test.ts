import { expect, type Locator, test } from '@playwright/test'
import {
  openExample,
  recordSlateBrowserRuntimeErrors,
} from 'slate-browser/playwright'

const getBrowserUndoHotkey = async (root: Locator) =>
  root
    .page()
    .evaluate(() =>
      /Mac OS X/.test(navigator.userAgent) ? 'Meta+Z' : 'Control+Z'
    )

const getBrowserLineEndHotkey = async (root: Locator) =>
  root
    .page()
    .evaluate(() =>
      /Mac OS X/.test(navigator.userAgent) ? 'Meta+ArrowRight' : 'End'
    )

const getBrowserWordForwardHotkey = async (root: Locator) =>
  root
    .page()
    .evaluate(() =>
      /Mac OS X/.test(navigator.userAgent)
        ? 'Alt+ArrowRight'
        : 'Control+ArrowRight'
    )

const isMacBrowser = async (root: Locator) =>
  root.page().evaluate(() => /Mac OS X/.test(navigator.userAgent))

test.describe('plaintext example', () => {
  test.beforeEach(async ({ page }) => await page.goto('/examples/plaintext'))

  test('inserts text when typed', async ({ page }) => {
    const insertedText = ' Hello World'
    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.click()
    await editor.press('End')
    await page.keyboard.insertText(insertedText)

    await expect(editor.root).toContainText(insertedText)
    expect(await editor.get.text()).toContain(insertedText)
  })

  test('clicking inside selected text collapses the selection', async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 'This is '.length },
      focus: { path: [0, 0], offset: 'This is editable'.length },
    })
    await expect.poll(() => editor.get.selectedText()).toBe('editable')

    const point = await editor.root.evaluate((element: HTMLElement) => {
      const text = element.textContent ?? ''
      const offset = text.indexOf('editable') + 'edit'.length
      const walker = element.ownerDocument.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT
      )
      let remaining = offset
      let textNode: Text | null = null

      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        const length = node.textContent?.length ?? 0

        if (remaining <= length) {
          textNode = node
          break
        }

        remaining -= length
      }

      if (!textNode) {
        throw new Error('Missing selected text node')
      }

      const range = element.ownerDocument.createRange()
      range.setStart(textNode, remaining)
      range.collapse(true)
      const rect = range.getBoundingClientRect()

      return {
        x: rect.left,
        y: rect.top + rect.height / 2,
      }
    })

    await page.mouse.click(point.x, point.y)
    await expect.poll(() => editor.get.selectedText()).toBe('')
    await expect
      .poll(async () => {
        const selection = await editor.selection.get()

        return selection
          ? JSON.stringify(selection.anchor) === JSON.stringify(selection.focus)
          : false
      })
      .toBe(true)
  })

  test('replaces a multi-paragraph selection with typed text', async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.selectAll()
    await page.keyboard.insertText('one')
    await page.keyboard.press('Enter')
    await page.keyboard.insertText('two')
    await page.keyboard.press('Enter')
    await page.keyboard.insertText('three')
    await editor.assert.blockTexts(['one', 'two', 'three'])

    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [1, 0], offset: 'two'.length },
    })
    await page.keyboard.type('replacement')

    await editor.assert.blockTexts(['replacement', 'three'])
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 'replacement'.length },
      focus: { path: [0, 0], offset: 'replacement'.length },
    })
  })

  test('imports document.execCommand insertText into editor state', async ({
    page,
  }) => {
    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.selectAll()
    await editor.root.evaluate((element: HTMLElement) => {
      element.focus()
      document.execCommand('insertText', false, 'foo')
    })

    await editor.assert.text('foo')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })
  })

  test('imports synthetic ClipboardEvent paste data into editor state', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'firefox',
      'Firefox blocks synthetic ClipboardEvent paste data'
    )

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.selectAll()
    await editor.root.evaluate((element: HTMLElement) => {
      const data = new DataTransfer()
      data.setData('text/plain', 'foo')
      element.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        })
      )
    })

    await editor.assert.text('foo')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })
  })

  test('creates a new plain text block on Enter before follow-up typing', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Desktop Enter key proof')

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.selectAll()
    await page.keyboard.insertText('Hello')
    await page.keyboard.press('Enter')
    await page.keyboard.insertText('world')

    await editor.assert.blockTexts(['Hello', 'world'])
    await editor.assert.selection({
      anchor: { path: [1, 0], offset: 'world'.length },
      focus: { path: [1, 0], offset: 'world'.length },
    })
  })

  test('keeps the caret at the document end through repeated Enter', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Desktop Enter key proof')

    const runtimeErrors = recordSlateBrowserRuntimeErrors(page)

    try {
      const editor = await openExample(page, 'plaintext', {
        ready: {
          editor: 'visible',
        },
      })

      await editor.selection.selectAll()
      await page.keyboard.insertText('start')

      for (let i = 0; i < 12; i += 1) {
        await page.keyboard.press('Enter')
      }

      await editor.assert.blockTexts(['start', ...Array(12).fill('')])
      await editor.assert.selection({
        anchor: { path: [12, 0], offset: 0 },
        focus: { path: [12, 0], offset: 0 },
      })

      await page.keyboard.insertText('tail')
      await editor.assert.blockTexts(['start', ...Array(11).fill(''), 'tail'])
      await editor.assert.selection({
        anchor: { path: [12, 0], offset: 'tail'.length },
        focus: { path: [12, 0], offset: 'tail'.length },
      })
      runtimeErrors.assertNone()
    } finally {
      runtimeErrors.stop()
    }
  })

  test('keeps selection synchronized while typing across rapid cursor changes', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Desktop selection proof')

    const runtimeErrors = recordSlateBrowserRuntimeErrors(page)

    try {
      const editor = await openExample(page, 'plaintext', {
        ready: {
          editor: 'visible',
        },
      })
      let first = 'top'
      let second = 'bottom'

      await editor.selection.selectAll()
      await page.keyboard.insertText(first)
      await page.keyboard.press('Enter')
      await page.keyboard.insertText(second)

      for (let i = 0; i < 6; i += 1) {
        const topInsert = String(i)
        const bottomInsert = String.fromCharCode(97 + i)

        await editor.selection.selectDOM({
          anchor: { path: [0, 0], offset: first.length },
          focus: { path: [0, 0], offset: first.length },
        })
        await page.keyboard.insertText(topInsert)
        first += topInsert

        await editor.selection.selectDOM({
          anchor: { path: [1, 0], offset: second.length },
          focus: { path: [1, 0], offset: second.length },
        })
        await page.keyboard.insertText(bottomInsert)
        second += bottomInsert
      }

      await editor.assert.blockTexts([first, second])
      await editor.assert.selection({
        anchor: { path: [1, 0], offset: second.length },
        focus: { path: [1, 0], offset: second.length },
      })
      runtimeErrors.assertNone()
    } finally {
      runtimeErrors.stop()
    }
  })

  test('handles modified Enter and word Backspace without runtime errors', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Desktop modifier-key proof')

    const runtimeErrors = recordSlateBrowserRuntimeErrors(page)

    try {
      const editor = await openExample(page, 'plaintext', {
        ready: {
          editor: 'visible',
        },
      })

      await editor.selection.selectAll()
      await page.keyboard.insertText('alpha beta')
      await page.keyboard.press('Control+Enter')
      await page.keyboard.press('Control+Backspace')

      runtimeErrors.assertNone()
      expect(await editor.get.selection()).not.toBe(null)
    } finally {
      runtimeErrors.stop()
    }
  })

  test('types angle brackets at the start of a line without dropping characters', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Desktop text input proof')

    const runtimeErrors = recordSlateBrowserRuntimeErrors(page)

    try {
      const editor = await openExample(page, 'plaintext', {
        ready: {
          editor: 'visible',
        },
      })

      await editor.selection.selectAll()
      await page.keyboard.insertText('<')
      await page.keyboard.insertText('>')

      await editor.assert.blockTexts(['<>'])
      await editor.assert.selection({
        anchor: { path: [0, 0], offset: 2 },
        focus: { path: [0, 0], offset: 2 },
      })
      runtimeErrors.assertNone()
    } finally {
      runtimeErrors.stop()
    }
  })

  test('does not fallback insert after same-text native paste', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium clipboard proof')

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })
    const text = await editor.get.modelText()

    await editor.selection.selectAll()
    const beforeTraceLength = (await editor.get.kernelTrace()).length
    await editor.clipboard.pasteText(text)
    const pasteTrace = (await editor.get.kernelTrace()).slice(beforeTraceLength)

    expect(await editor.get.modelText()).toBe(text)
    expect(
      pasteTrace.some(
        (entry) =>
          entry.eventFamily === 'paste' && entry.command?.kind === 'insert-data'
      )
    ).toBe(true)
    expect(
      pasteTrace.some(
        (entry) =>
          entry.eventFamily === 'repair' &&
          entry.command?.kind === 'insert-text'
      )
    ).toBe(false)
  })

  test('copies and cuts selected plain text with keyboard shortcuts', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Desktop clipboard proof')
    test.skip(
      testInfo.project.name === 'webkit',
      'WebKit blocks privileged clipboard reads in Playwright'
    )

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })
    const originalText = 'This is editable plain text, just like a <textarea>!'
    const selectionStart = 'This is '.length
    const selectionEnd = selectionStart + 'editable'.length

    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: selectionStart },
      focus: { path: [0, 0], offset: selectionEnd },
    })
    await editor.root.press('ControlOrMeta+C')

    expect(await editor.clipboard.readText()).toBe('editable')
    await editor.assert.text(originalText)

    await editor.root.press('ControlOrMeta+X')

    expect(await editor.clipboard.readText()).toBe('editable')
    await editor.assert.text('This is  plain text, just like a <textarea>!')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: selectionStart },
      focus: { path: [0, 0], offset: selectionStart },
    })
  })

  test('selects all plain text through a trailing empty line', async ({
    page,
  }) => {
    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selectAll()
    await editor.deleteFragment()
    await editor.insertText('one')
    await editor.insertBreak()
    await editor.insertText('two')
    await editor.insertBreak()
    await editor.assert.blockTexts(['one', 'two', ''])

    await editor.focus()
    await page.keyboard.press('ControlOrMeta+A')

    await expect
      .poll(() => editor.get.selection())
      .toEqual({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [2, 0], offset: 0 },
      })
    expect(await editor.get.selectedText()).toContain('one')
    expect(await editor.get.selectedText()).toContain('two')

    await page.keyboard.press('Backspace')
    await expect.poll(() => editor.get.modelText()).toBe('')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })
  })

  test('keeps repeated trailing insert breaks at the document end', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Desktop Enter key proof')

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })
    const initialText = 'This is editable plain text, just like a <textarea>!'
    const breakCount = 6

    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: initialText.length },
      focus: { path: [0, 0], offset: initialText.length },
    })

    for (let index = 0; index < breakCount; index++) {
      await page.keyboard.press('Enter')
      await editor.assert.selection({
        anchor: { path: [index + 1, 0], offset: 0 },
        focus: { path: [index + 1, 0], offset: 0 },
      })
    }

    await editor.assert.blockTexts([
      initialText,
      ...new Array(breakCount).fill(''),
    ])
    await editor.assert.selection({
      anchor: { path: [breakCount, 0], offset: 0 },
      focus: { path: [breakCount, 0], offset: 0 },
    })
  })

  test('keeps Backspace in an empty first block from deleting it', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Desktop Backspace proof')

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.selectAll()
    await page.keyboard.insertText('second')
    await editor.selection.collapse({ path: [0, 0], offset: 0 })
    await page.keyboard.press('Enter')
    await editor.selection.collapse({ path: [0, 0], offset: 0 })

    await editor.root.press('Backspace')

    await editor.assert.blockTexts(['', 'second'])
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })
  })

  test('keeps browser line-end movement within the current block', async ({
    browserName,
    page,
  }, testInfo) => {
    test.skip(
      browserName !== 'chromium' || testInfo.project.name === 'mobile',
      'Desktop Chromium line-end keyboard proof'
    )

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })
    const lineEndHotkey = await getBrowserLineEndHotkey(editor.root)

    await editor.selection.selectAll()
    await page.keyboard.insertText('First line')
    await page.keyboard.press('Enter')
    await page.keyboard.insertText('Second line')
    await page.keyboard.press('Enter')
    await page.keyboard.insertText('Third line')
    await editor.assert.blockTexts(['First line', 'Second line', 'Third line'])

    await editor.selection.select({
      anchor: { path: [1, 0], offset: 0 },
      focus: { path: [1, 0], offset: 0 },
    })
    await page.keyboard.press(lineEndHotkey)

    await editor.assert.selection({
      anchor: { path: [1, 0], offset: 'Second line'.length },
      focus: { path: [1, 0], offset: 'Second line'.length },
    })
    await editor.assert.domCaret({
      offset: 'Second line'.length,
      text: 'Second line',
    })
  })

  test('moves ArrowRight out of an empty leading block', async ({
    browserName,
    page,
  }, testInfo) => {
    test.skip(
      browserName !== 'chromium' || testInfo.project.name === 'mobile',
      'Desktop Chromium arrow-key proof'
    )

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.selectAll()
    await page.keyboard.insertText('Hello')
    await editor.selection.select({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })
    await page.keyboard.press('Enter')
    await editor.assert.blockTexts(['', 'Hello'])
    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })

    await page.keyboard.press('ArrowRight')

    await editor.assert.selection({
      anchor: { path: [1, 0], offset: 0 },
      focus: { path: [1, 0], offset: 0 },
    })
    await editor.assert.domCaret({ offset: 0, text: 'Hello' })
  })

  test('moves ArrowRight and ArrowLeft into a middle empty block', async ({
    browserName,
    page,
  }, testInfo) => {
    test.skip(
      browserName !== 'chromium' || testInfo.project.name === 'mobile',
      'Desktop Chromium arrow-key proof'
    )

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.selectAll()
    await page.keyboard.insertText('text1')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.insertText('text2')
    await editor.assert.blockTexts(['text1', '', 'text2'])

    await editor.selection.select({
      anchor: { path: [0, 0], offset: 'text1'.length },
      focus: { path: [0, 0], offset: 'text1'.length },
    })
    await page.keyboard.press('ArrowRight')
    await editor.assert.selection({
      anchor: { path: [1, 0], offset: 0 },
      focus: { path: [1, 0], offset: 0 },
    })

    await editor.selection.select({
      anchor: { path: [2, 0], offset: 0 },
      focus: { path: [2, 0], offset: 0 },
    })
    await page.keyboard.press('ArrowLeft')
    await editor.assert.selection({
      anchor: { path: [1, 0], offset: 0 },
      focus: { path: [1, 0], offset: 0 },
    })
  })

  test('moves word forward out of an empty leading block', async ({
    browserName,
    page,
  }, testInfo) => {
    test.skip(
      browserName !== 'chromium' || testInfo.project.name === 'mobile',
      'Desktop Chromium word-navigation proof'
    )

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })
    const wordForward = await getBrowserWordForwardHotkey(editor.root)

    await editor.selection.selectAll()
    await page.keyboard.insertText('Hello')
    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })
    await page.keyboard.press('Enter')
    await editor.assert.blockTexts(['', 'Hello'])
    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })

    await page.keyboard.press(wordForward)

    await editor.assert.selection({
      anchor: { path: [1, 0], offset: 0 },
      focus: { path: [1, 0], offset: 0 },
    })
    await editor.assert.domCaret({ offset: 0, text: 'Hello' })
  })

  test('moves ArrowLeft through ligature-prone repeated letters', async ({
    browserName,
    page,
  }, testInfo) => {
    test.skip(
      browserName !== 'chromium' || testInfo.project.name === 'mobile',
      'Desktop Chromium ligature-prone arrow-key proof'
    )

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.selectAll()
    await page.keyboard.insertText('off')
    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })

    await page.keyboard.press('ArrowLeft')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 2 },
      focus: { path: [0, 0], offset: 2 },
    })

    await page.keyboard.press('ArrowLeft')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 1 },
    })
  })

  test('deletes backward between identical adjacent characters', async ({
    browserName,
    page,
  }, testInfo) => {
    test.skip(
      browserName !== 'chromium' || testInfo.project.name === 'mobile',
      'Desktop Chromium same-character delete proof'
    )

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.selectAll()
    await page.keyboard.insertText('aa')
    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 1 },
    })

    await page.keyboard.press('Backspace')

    await editor.assert.text('a')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })
  })

  test('keeps Shift+ArrowRight cross-block selection on real text', async ({
    browserName,
    page,
  }, testInfo) => {
    test.skip(
      browserName !== 'chromium' || testInfo.project.name === 'mobile',
      'Desktop Chromium cross-block selection proof'
    )

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.selectAll()
    await page.keyboard.insertText('B')
    await page.keyboard.press('Enter')
    await page.keyboard.insertText('A')
    await editor.assert.blockTexts(['B', 'A'])
    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })

    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')

    await expect.poll(() => editor.get.selectedText()).toContain('B')
    await expect.poll(() => editor.get.selectedText()).toContain('A')
    expect(await editor.get.selectedText()).not.toContain('\uFEFF')
  })

  test('keeps Shift+ArrowLeft backward selection inside one paragraph', async ({
    browserName,
    page,
  }, testInfo) => {
    test.skip(
      browserName !== 'chromium' || testInfo.project.name === 'mobile',
      'Desktop Chromium backward selection proof'
    )

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })
    const text = 'abcdef'

    await editor.selection.selectAll()
    await page.keyboard.insertText(text)
    await editor.selection.select({
      anchor: { path: [0, 0], offset: text.length },
      focus: { path: [0, 0], offset: text.length },
    })

    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Shift+ArrowLeft')

    await editor.assert.selection({
      anchor: { path: [0, 0], offset: text.length },
      focus: { path: [0, 0], offset: text.length - 3 },
    })
    await expect.poll(() => editor.get.selectedText()).toBe('def')
    await editor.assert.domSelection({
      anchorNodeText: text,
      anchorOffset: text.length,
      focusNodeText: text,
      focusOffset: text.length - 3,
    })
  })

  test('deletes the current line backward without touching the previous block', async ({
    browserName,
    page,
  }, testInfo) => {
    test.skip(
      browserName !== 'chromium' || testInfo.project.name === 'mobile',
      'Desktop Chromium hard-line-delete proof'
    )

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })
    test.skip(
      !(await isMacBrowser(editor.root)),
      'Command+Backspace hard-line-delete proof is macOS-specific'
    )

    await editor.selection.selectAll()
    await page.keyboard.insertText('foobar')
    await page.keyboard.press('Enter')
    await page.keyboard.insertText('baz')
    await editor.assert.blockTexts(['foobar', 'baz'])

    await page.keyboard.press('Meta+Backspace')

    await editor.assert.blockTexts(['foobar', ''])
    await editor.assert.selection({
      anchor: { path: [1, 0], offset: 0 },
      focus: { path: [1, 0], offset: 0 },
    })
    expect(await editor.get.modelText()).toBe('foobar')
  })

  test('supports WebKit hard-line backward delete without command errors', async ({
    browserName,
    page,
  }, testInfo) => {
    test.skip(
      browserName !== 'webkit' || testInfo.project.name === 'mobile',
      'Desktop WebKit hard-line-delete proof'
    )

    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text())
      }
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.selectAll()
    await page.keyboard.insertText('foobar')
    await page.keyboard.press('Enter')
    await page.keyboard.insertText('baz')
    await editor.assert.blockTexts(['foobar', 'baz'])

    await page.keyboard.press('Meta+Backspace')

    await editor.assert.blockTexts(['foobar', ''])
    await editor.assert.selection({
      anchor: { path: [1, 0], offset: 0 },
      focus: { path: [1, 0], offset: 0 },
    })
    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  })

  test('applies deleteSoftLineBackward target ranges exactly', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'firefox',
      'Firefox lacks compatible synthetic StaticRange beforeinput dispatch'
    )
    test.skip(
      testInfo.project.name === 'mobile',
      'Desktop synthetic beforeinput target range proof'
    )

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })
    const text = 'alpha beta gamma delta epsilon zeta'
    const softLineStart = 'alpha beta '.length

    await editor.selection.selectAll()
    await page.keyboard.insertText(text)

    await editor.root.evaluate(
      (
        element: HTMLElement,
        { rangeStart, sourceText }: { rangeStart: number; sourceText: string }
      ) => {
        const walker = element.ownerDocument.createTreeWalker(
          element,
          NodeFilter.SHOW_TEXT
        )
        let textNode: Node | null = null

        while (walker.nextNode()) {
          if (walker.currentNode.textContent?.includes(sourceText)) {
            textNode = walker.currentNode
            break
          }
        }

        if (!textNode) {
          throw new Error('Soft-line target text node not found')
        }

        const selection = element.ownerDocument.getSelection()
        const range = element.ownerDocument.createRange()
        range.setStart(textNode, sourceText.length)
        range.collapse(true)
        selection?.removeAllRanges()
        selection?.addRange(range)

        const event = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: null,
          inputType: 'deleteSoftLineBackward',
        }) as InputEvent & { getTargetRanges: () => StaticRange[] }

        event.getTargetRanges = () => [
          new StaticRange({
            endContainer: textNode,
            endOffset: sourceText.length,
            startContainer: textNode,
            startOffset: rangeStart,
          }),
        ]
        element.dispatchEvent(event)
      },
      { rangeStart: softLineStart, sourceText: text }
    )

    await editor.assert.text(text.slice(0, softLineStart))
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: softLineStart },
      focus: { path: [0, 0], offset: softLineStart },
    })
  })

  test('applies deleteWord target ranges over tab whitespace exactly', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'firefox',
      'Firefox lacks compatible synthetic StaticRange beforeinput dispatch'
    )
    test.skip(
      testInfo.project.name === 'mobile',
      'Desktop synthetic beforeinput target range proof'
    )

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })
    const dispatchDeleteWordTargetRange = async ({
      caretOffset,
      endOffset,
      inputType,
      startOffset,
      text,
    }: {
      caretOffset: number
      endOffset: number
      inputType: 'deleteWordBackward' | 'deleteWordForward'
      startOffset: number
      text: string
    }) => {
      await editor.root.evaluate(
        (
          element: HTMLElement,
          {
            caretOffset,
            endOffset,
            inputType,
            sourceText,
            startOffset,
          }: {
            caretOffset: number
            endOffset: number
            inputType: 'deleteWordBackward' | 'deleteWordForward'
            sourceText: string
            startOffset: number
          }
        ) => {
          const walker = element.ownerDocument.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT
          )
          let textNode: Node | null = null

          while (walker.nextNode()) {
            if (walker.currentNode.textContent?.includes(sourceText)) {
              textNode = walker.currentNode
              break
            }
          }

          if (!textNode) {
            throw new Error('deleteWord target text node not found')
          }

          const selection = element.ownerDocument.getSelection()
          const range = element.ownerDocument.createRange()
          range.setStart(textNode, caretOffset)
          range.collapse(true)
          selection?.removeAllRanges()
          selection?.addRange(range)

          const event = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: null,
            inputType,
          }) as InputEvent & { getTargetRanges: () => StaticRange[] }

          event.getTargetRanges = () => [
            new StaticRange({
              endContainer: textNode,
              endOffset,
              startContainer: textNode,
              startOffset,
            }),
          ]
          const dispatched = element.dispatchEvent(event)

          return {
            defaultPrevented: event.defaultPrevented,
            dispatched,
            handle: (element as any).__slateBrowserHandle
              ? {
                  lastCommit: (element as any).__slateBrowserHandle.getLastCommit?.(),
                  selection: (element as any).__slateBrowserHandle.getSelection?.(),
                  text: (element as any).__slateBrowserHandle.getText?.(),
                  trace: (element as any).__slateBrowserHandle.getKernelTrace?.(),
                }
              : null,
          }
        },
        { caretOffset, endOffset, inputType, sourceText: text, startOffset }
      )
    }

    await editor.selection.selectAll()
    await page.keyboard.insertText('foo\tbar')
    await dispatchDeleteWordTargetRange({
      caretOffset: 0,
      endOffset: 'foo\t'.length,
      inputType: 'deleteWordForward',
      startOffset: 0,
      text: 'foo\tbar',
    })
    await editor.assert.text('bar')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })

    await editor.selection.selectAll()
    await page.keyboard.insertText('foo\tbar')
    await dispatchDeleteWordTargetRange({
      caretOffset: 'foo\tbar'.length,
      endOffset: 'foo\tbar'.length,
      inputType: 'deleteWordBackward',
      startOffset: 'foo'.length,
      text: 'foo\tbar',
    })
    await editor.assert.text('foo')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 'foo'.length },
      focus: { path: [0, 0], offset: 'foo'.length },
    })
  })

  test('applies delete target ranges over multi-code-unit graphemes exactly', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'firefox',
      'Firefox lacks compatible synthetic StaticRange beforeinput dispatch'
    )
    test.skip(
      testInfo.project.name === 'mobile',
      'Desktop synthetic beforeinput target range proof'
    )

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })
    const sourceText = 'a🧑‍💻b'
    const graphemeStart = 1
    const graphemeEnd = sourceText.length - 1

    const dispatchDeleteTargetRange = async ({
      caretOffset,
      inputType,
    }: {
      caretOffset: number
      inputType: 'deleteContentBackward' | 'deleteContentForward'
    }) => {
      await editor.root.evaluate(
        (
          element: HTMLElement,
          {
            caretOffset,
            endOffset,
            inputType,
            sourceText,
            startOffset,
          }: {
            caretOffset: number
            endOffset: number
            inputType: 'deleteContentBackward' | 'deleteContentForward'
            sourceText: string
            startOffset: number
          }
        ) => {
          const walker = element.ownerDocument.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT
          )
          let textNode: Node | null = null

          while (walker.nextNode()) {
            if (walker.currentNode.textContent?.includes(sourceText)) {
              textNode = walker.currentNode
              break
            }
          }

          if (!textNode) {
            throw new Error('delete grapheme target text node not found')
          }

          const selection = element.ownerDocument.getSelection()
          const range = element.ownerDocument.createRange()
          range.setStart(textNode, caretOffset)
          range.collapse(true)
          selection?.removeAllRanges()
          selection?.addRange(range)

          const event = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: null,
            inputType,
          }) as InputEvent & { getTargetRanges: () => StaticRange[] }

          event.getTargetRanges = () => [
            new StaticRange({
              endContainer: textNode,
              endOffset,
              startContainer: textNode,
              startOffset,
            }),
          ]
          element.dispatchEvent(event)
        },
        {
          caretOffset,
          endOffset: graphemeEnd,
          inputType,
          sourceText,
          startOffset: graphemeStart,
        }
      )
    }

    await editor.selection.selectAll()
    await page.keyboard.insertText(sourceText)
    await dispatchDeleteTargetRange({
      caretOffset: graphemeStart,
      inputType: 'deleteContentForward',
    })
    await editor.assert.text('ab')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: graphemeStart },
      focus: { path: [0, 0], offset: graphemeStart },
    })

    await editor.selection.selectAll()
    await page.keyboard.insertText(sourceText)
    await dispatchDeleteTargetRange({
      caretOffset: graphemeEnd,
      inputType: 'deleteContentBackward',
    })
    await editor.assert.text('ab')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: graphemeStart },
      focus: { path: [0, 0], offset: graphemeStart },
    })
  })

  test('applies beforeinput target ranges for browser text substitutions', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'firefox',
      'Firefox lacks compatible synthetic StaticRange beforeinput dispatch'
    )
    test.skip(
      testInfo.project.name === 'mobile',
      'Desktop synthetic beforeinput target range proof'
    )

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.selectAll()
    await page.keyboard.insertText('i')

    await editor.root.evaluate((element: HTMLElement) => {
      const findTextNode = (needle: string) => {
        const walker = element.ownerDocument.createTreeWalker(
          element,
          NodeFilter.SHOW_TEXT
        )

        while (walker.nextNode()) {
          const node = walker.currentNode

          if (node.textContent?.includes(needle)) {
            return node
          }
        }

        throw new Error(`Text node not found: ${needle}`)
      }
      const targetRanges =
        (
          startContainer: Node,
          startOffset: number,
          endContainer: Node,
          endOffset: number
        ) =>
        () => [
          new StaticRange({
            endContainer,
            endOffset,
            startContainer,
            startOffset,
          }),
        ]
      const dispatchBeforeInput = ({
        data,
        inputType,
        ranges,
      }: {
        data: string
        inputType: string
        ranges: () => StaticRange[]
      }) => {
        const event = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data,
          inputType,
        }) as InputEvent & { getTargetRanges: () => StaticRange[] }

        event.getTargetRanges = ranges
        element.dispatchEvent(event)

        return event
      }

      let firstTextNode = findTextNode('i')

      const insertEvent = dispatchBeforeInput({
        data: 'S',
        inputType: 'insertText',
        ranges: targetRanges(firstTextNode, 1, firstTextNode, 1),
      })
      if (!insertEvent.defaultPrevented) {
        firstTextNode.textContent += 'S'
      }
      firstTextNode = findTextNode('iS')
      const selection = element.ownerDocument.getSelection()
      const range = element.ownerDocument.createRange()

      range.setStart(firstTextNode, 2)
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      dispatchBeforeInput({
        data: 'I',
        inputType: 'insertReplacementText',
        ranges: targetRanges(firstTextNode, 0, firstTextNode, 1),
      })
      element.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          data: 'S',
          inputType: 'insertText',
        })
      )
    })

    await editor.assert.text('IS')

    await editor.selection.selectAll()
    await page.keyboard.insertText('🙂 ')
    await editor.root.evaluate((element: HTMLElement) => {
      const walker = element.ownerDocument.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT
      )
      let textNode: Node | null = null

      while (walker.nextNode()) {
        if (walker.currentNode.textContent?.includes('🙂 ')) {
          textNode = walker.currentNode
          break
        }
      }

      if (!textNode) {
        throw new Error('Emoji text node not found')
      }

      const event = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: '. ',
        inputType: 'insertText',
      }) as InputEvent & { getTargetRanges: () => StaticRange[] }

      event.getTargetRanges = () => [
        new StaticRange({
          endContainer: textNode,
          endOffset: '🙂 '.length,
          startContainer: textNode,
          startOffset: '🙂'.length,
        }),
      ]
      element.dispatchEvent(event)
    })

    await editor.assert.text('🙂. ')
  })

  test('applies insertTranspose beforeinput as adjacent character transpose', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'firefox',
      'Firefox lacks compatible synthetic beforeinput dispatch'
    )
    test.skip(
      testInfo.project.name === 'mobile',
      'Desktop synthetic beforeinput transpose proof'
    )

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.selectAll()
    await page.keyboard.insertText('abc')
    await editor.selection.select({
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 1 },
    })

    await editor.root.evaluate((element: HTMLElement) => {
      const dispatchTranspose = () => {
        element.dispatchEvent(
          new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertTranspose',
          })
        )
      }

      dispatchTranspose()
      dispatchTranspose()
    })

    await editor.assert.text('bca')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })
  })

  test('keyboard undo restores caret after middle-line typing', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Desktop keyboard undo repro')

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })
    const originalText = 'This is editable plain text, just like a <textarea>!'
    const editOffset = 'This is editable '.length

    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: editOffset },
      focus: { path: [0, 0], offset: editOffset },
    })
    await page.keyboard.type('abc')
    await editor.assert.text(
      'This is editable abcplain text, just like a <textarea>!'
    )

    await page.keyboard.press(await getBrowserUndoHotkey(editor.root))

    await editor.assert.text(originalText)
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: editOffset },
      focus: { path: [0, 0], offset: editOffset },
    })
  })

  test('keyboard undo restores partial selected text replacement', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Desktop keyboard undo repro')
    test.skip(
      testInfo.project.name === 'firefox',
      'Firefox native partial replacement selection differs'
    )

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })
    const originalText = 'This is editable plain text, just like a <textarea>!'
    const selectionStart = 'This is editable '.length
    const selectionEnd = selectionStart + 'plain '.length

    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: selectionStart },
      focus: { path: [0, 0], offset: selectionEnd },
    })
    await page.keyboard.insertText('simple')
    await editor.assert.text(
      'This is editable simpletext, just like a <textarea>!'
    )

    await page.keyboard.press(await getBrowserUndoHotkey(editor.root))

    await editor.assert.text(originalText)
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: selectionStart },
      focus: { path: [0, 0], offset: selectionEnd },
    })
  })

  test('mouse drag undo restores manual typed replacement', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium reporter path')

    const editor = await openExample(page, 'plaintext', {
      ready: {
        editor: 'visible',
      },
    })
    const originalText = 'This is editable plain text, just like a <textarea>!'
    const selectionStart = 'This is editable '.length
    const selectionEnd = selectionStart + 'plain '.length

    await editor.selection.dragTextRange({
      endOffset: selectionEnd,
      startOffset: selectionStart,
      text: originalText,
    })

    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
      .toBe('plain ')

    await page.keyboard.type('simple')
    await editor.assert.text(
      'This is editable simpletext, just like a <textarea>!'
    )

    await page.keyboard.press(await getBrowserUndoHotkey(editor.root))

    await editor.assert.text(originalText)
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: selectionStart },
      focus: { path: [0, 0], offset: selectionEnd },
    })
    await expect.poll(() => editor.get.selectedText()).toBe('plain ')
    await editor.assert.domSelection({
      anchorNodeText: originalText,
      anchorOffset: selectionStart,
      focusNodeText: originalText,
      focusOffset: selectionEnd,
    })
  })
})
