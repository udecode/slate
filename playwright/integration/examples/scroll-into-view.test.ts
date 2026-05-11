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

        const range = selection.getRangeAt(0).cloneRange()
        const marker = element.ownerDocument.createElement('span')

        marker.textContent = '|'
        range.insertNode(marker)

        const markerRect = marker.getBoundingClientRect()
        const parentRect = scrollParent.getBoundingClientRect()

        marker.remove()

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
})
