import { expect, test } from '@playwright/test'
import {
  openExample,
  type SlateBrowserEditorHarness,
} from 'slate-browser/playwright'

const scrollContainersAwayFromCaret = async (
  editor: SlateBrowserEditorHarness
) =>
  editor.root.evaluate((element: HTMLElement) => {
    for (
      let parent = element.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      if (parent.scrollHeight > parent.clientHeight) {
        parent.scrollTop = 0
      }
    }
    window.scrollTo(0, 0)
  })

const getScrollableParentState = async (editor: SlateBrowserEditorHarness) =>
  editor.root.evaluate((element: HTMLElement) => {
    const parents: Array<{
      clientHeight: number
      scrollHeight: number
      scrollTop: number
    }> = []

    for (
      let parent = element.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      if (parent.scrollHeight > parent.clientHeight) {
        parents.push({
          clientHeight: parent.clientHeight,
          scrollHeight: parent.scrollHeight,
          scrollTop: parent.scrollTop,
        })
      }
    }

    return parents
  })

const scrollBlockIntoView = async (
  editor: SlateBrowserEditorHarness,
  blockIndex: number
) => {
  await editor.root
    .locator(`[data-slate-node="element"][data-slate-path="${blockIndex}"]`)
    .scrollIntoViewIfNeeded()
}

const clickTextBlock = async (
  editor: SlateBrowserEditorHarness,
  blockIndex: number
) => {
  const point = await editor.root.evaluate((element: HTMLElement, index) => {
    const textElement = element.querySelector<HTMLElement>(
      `[data-slate-node="text"][data-slate-path="${index},0"]`
    )

    if (!textElement) {
      throw new Error(`Missing text element for block ${index}`)
    }

    const rect = textElement.getBoundingClientRect()

    return {
      x: rect.left + Math.min(rect.width - 4, Math.max(4, rect.width * 0.75)),
      y: rect.top + rect.height / 2,
    }
  }, blockIndex)

  await editor.page.mouse.click(point.x, point.y)
}

const getBrowserUndoHotkey = async (editor: SlateBrowserEditorHarness) =>
  editor.root
    .page()
    .evaluate(() =>
      /Mac OS X/.test(navigator.userAgent) ? 'Meta+Z' : 'Control+Z'
    )

const selectTextBlockEndDOM = async (
  editor: SlateBrowserEditorHarness,
  blockIndex: number
) =>
  editor.root.evaluate((element: HTMLElement, index) => {
    const textElement = element.querySelector<HTMLElement>(
      `[data-slate-node="text"][data-slate-path="${index},0"]`
    )

    if (!textElement) {
      throw new Error(`Missing text element for block ${index}`)
    }

    const walker = element.ownerDocument.createTreeWalker(
      textElement,
      NodeFilter.SHOW_TEXT
    )
    let textNode: Text | null = null
    let currentNode: Node | null = null

    currentNode = walker.nextNode()
    while (currentNode) {
      textNode = currentNode as Text
      currentNode = walker.nextNode()
    }

    if (!textNode) {
      throw new Error(`Missing text node for block ${index}`)
    }

    const range = element.ownerDocument.createRange()
    const selection = element.ownerDocument.getSelection()

    range.setStart(textNode, textNode.textContent?.length ?? 0)
    range.collapse(true)
    selection?.removeAllRanges()
    selection?.addRange(range)
    element.focus()
    element.ownerDocument.dispatchEvent(
      new Event('selectionchange', { bubbles: true })
    )
  }, blockIndex)

const expectCaretVisibleInScrollableParent = async (
  editor: SlateBrowserEditorHarness
) => {
  await expect
    .poll(() =>
      editor.root.evaluate((element: HTMLElement) => {
        const selection = element.ownerDocument.getSelection()
        const scrollParent = Array.from(
          (function* parents() {
            for (
              let parent = element.parentElement;
              parent;
              parent = parent.parentElement
            ) {
              if (parent.scrollHeight > parent.clientHeight) {
                yield parent
              }
            }
          })()
        )[0]

        if (!selection || selection.rangeCount === 0 || !scrollParent) {
          return false
        }

        const range = selection.getRangeAt(0)
        const markerRect = range.getBoundingClientRect()
        const parentRect = scrollParent.getBoundingClientRect()

        return (
          markerRect.top >= parentRect.top - 1 &&
          markerRect.bottom <= parentRect.bottom + 1
        )
      })
    )
    .toBe(true)
}

test.describe('scroll into view example', () => {
  test('keeps repeated typing visible after manual scroll-away', async ({
    page,
  }) => {
    const editor = await openExample(page, 'scroll-into-view', {
      ready: { editor: 'visible' },
    })
    const blockTexts = await editor.get.blockTexts()
    const lastBlockIndex = blockTexts.length - 1

    await scrollBlockIntoView(editor, lastBlockIndex)
    await clickTextBlock(editor, lastBlockIndex)

    await scrollContainersAwayFromCaret(editor)
    await page.keyboard.insertText(' first-scroll')
    await expect
      .poll(async () =>
        (await getScrollableParentState(editor)).some(
          (state) => state.scrollTop > 0
        )
      )
      .toBe(true)
    await expectCaretVisibleInScrollableParent(editor)

    await scrollContainersAwayFromCaret(editor)
    await page.keyboard.insertText(' second-scroll')
    await expect
      .poll(async () =>
        (await getScrollableParentState(editor)).some(
          (state) => state.scrollTop > 0
        )
      )
      .toBe(true)
    await expectCaretVisibleInScrollableParent(editor)

    const nextBlockTexts = await editor.get.blockTexts()
    expect(nextBlockTexts[lastBlockIndex]).toContain('first-scroll')
    expect(nextBlockTexts[lastBlockIndex]).toContain('second-scroll')
    expect(nextBlockTexts.slice(0, lastBlockIndex).join('\n')).not.toContain(
      'second-scroll'
    )
  })

  test('keeps caret at the edited block end across repeated manual scroll-away typing', async ({
    page,
  }) => {
    const editor = await openExample(page, 'scroll-into-view', {
      ready: { editor: 'visible' },
    })
    const blockTexts = await editor.get.blockTexts()
    const lastBlockIndex = blockTexts.length - 1
    const firstText = ' first-scroll'
    const secondText = ' second-scroll'

    let expectedOffset = blockTexts[lastBlockIndex]!.length

    await scrollBlockIntoView(editor, lastBlockIndex)
    await selectTextBlockEndDOM(editor, lastBlockIndex)
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [lastBlockIndex, 0], offset: expectedOffset },
        focus: { path: [lastBlockIndex, 0], offset: expectedOffset },
      })

    await scrollContainersAwayFromCaret(editor)
    await page.keyboard.type(firstText)
    expectedOffset += firstText.length

    await editor.assert.selection({
      anchor: { path: [lastBlockIndex, 0], offset: expectedOffset },
      focus: { path: [lastBlockIndex, 0], offset: expectedOffset },
    })
    await expectCaretVisibleInScrollableParent(editor)

    await scrollContainersAwayFromCaret(editor)
    await page.keyboard.type(secondText)
    expectedOffset += secondText.length

    await editor.assert.selection({
      anchor: { path: [lastBlockIndex, 0], offset: expectedOffset },
      focus: { path: [lastBlockIndex, 0], offset: expectedOffset },
    })
    await expectCaretVisibleInScrollableParent(editor)

    const nextBlockTexts = await editor.get.blockTexts()
    expect(nextBlockTexts[lastBlockIndex]).toContain(firstText)
    expect(nextBlockTexts[lastBlockIndex]).toContain(secondText)
    expect(nextBlockTexts[0]).not.toContain(secondText)

    await page.keyboard.press(await getBrowserUndoHotkey(editor))
    await page.waitForTimeout(250)

    await editor.assert.selection({
      anchor: {
        path: [lastBlockIndex, 0],
        offset: blockTexts[lastBlockIndex]!.length,
      },
      focus: {
        path: [lastBlockIndex, 0],
        offset: blockTexts[lastBlockIndex]!.length,
      },
    })

    await scrollContainersAwayFromCaret(editor)
    await page.keyboard.type(' third-scroll')

    await editor.assert.selection({
      anchor: {
        path: [lastBlockIndex, 0],
        offset: blockTexts[lastBlockIndex]!.length + ' third-scroll'.length,
      },
      focus: {
        path: [lastBlockIndex, 0],
        offset: blockTexts[lastBlockIndex]!.length + ' third-scroll'.length,
      },
    })
    await expectCaretVisibleInScrollableParent(editor)

    const finalBlockTexts = await editor.get.blockTexts()
    expect(finalBlockTexts[lastBlockIndex]).toContain('third-scroll')
    expect(finalBlockTexts[0]).not.toContain('third-scroll')
  })
})
