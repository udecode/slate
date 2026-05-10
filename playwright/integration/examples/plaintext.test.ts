import { expect, type Locator, test } from '@playwright/test'
import { openExample } from 'slate-browser/playwright'

const getBrowserUndoHotkey = async (root: Locator) =>
  root
    .page()
    .evaluate(() =>
      /Mac OS X/.test(navigator.userAgent) ? 'Meta+Z' : 'Control+Z'
    )

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

  test('applies beforeinput target ranges for browser text substitutions', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'firefox',
      'Firefox lacks compatible synthetic StaticRange beforeinput dispatch'
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
      }

      const firstTextNode = findTextNode('i')

      dispatchBeforeInput({
        data: 'S',
        inputType: 'insertText',
        ranges: targetRanges(firstTextNode, 1, firstTextNode, 1),
      })
      firstTextNode.textContent += 'S'
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
    await page.keyboard.insertText('abc')
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
})
