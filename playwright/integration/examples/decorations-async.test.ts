import { expect, type Locator, test } from '@playwright/test'

import { openExample } from 'slate-browser/playwright'

const INITIAL_TEXT = 'This is some text here about. there'
const INSERTED_TEXT = ' there'
const FINAL_TEXT = `${INITIAL_TEXT}${INSERTED_TEXT}`
const FINAL_CARET_OFFSET = FINAL_TEXT.length

const getDOMCaretOffsetInFirstText = async (root: Locator) =>
  root.evaluate((element: HTMLElement) => {
    const rootNode = element.getRootNode() as Document | ShadowRoot
    const selection =
      'getSelection' in rootNode
        ? rootNode.getSelection()
        : element.ownerDocument.getSelection()
    const textElement = element.querySelector(
      '[data-slate-node="text"][data-slate-path="0,0"]'
    )

    if (
      !selection?.isCollapsed ||
      selection.rangeCount === 0 ||
      !selection.anchorNode ||
      !textElement
    ) {
      return null
    }

    const range = element.ownerDocument.createRange()

    try {
      range.setStart(textElement, 0)
      range.setEnd(selection.anchorNode, selection.anchorOffset)
    } catch {
      return null
    }

    return {
      offset: range.toString().length,
      text: textElement.textContent,
    }
  })

test.describe('async decorations', () => {
  for (const source of ['prop', 'hook'] as const) {
    test(`keeps the caret at the typed end when delayed ${source} decorations restructure text`, async ({
      page,
    }, testInfo) => {
      const editor = await openExample(page, 'decorations-async', {
        query: source === 'hook' ? { source } : undefined,
        ready: {
          editor: 'visible',
          text: INITIAL_TEXT,
        },
      })

      await expect(
        page.locator('[data-cy="async-decoration-highlight"]')
      ).toHaveCount(2)
      await editor.selection.collapse({
        path: [0, 0],
        offset: INITIAL_TEXT.length,
      })
      await editor.focus()

      if (testInfo.project.name === 'mobile') {
        await editor.insertText(INSERTED_TEXT)
      } else {
        await page.keyboard.type(INSERTED_TEXT)
      }

      await editor.assert.selection({
        anchor: { path: [0, 0], offset: FINAL_CARET_OFFSET },
        focus: { path: [0, 0], offset: FINAL_CARET_OFFSET },
      })
      await expect(
        page.locator('[data-cy="async-decoration-highlight"]')
      ).toHaveCount(2)

      await expect(
        page.locator('[data-cy="async-decoration-highlight"]')
      ).toHaveCount(3)
      await editor.assert.selection({
        anchor: { path: [0, 0], offset: FINAL_CARET_OFFSET },
        focus: { path: [0, 0], offset: FINAL_CARET_OFFSET },
      })
      await expect
        .poll(() => getDOMCaretOffsetInFirstText(editor.root))
        .toEqual({
          offset: FINAL_CARET_OFFSET,
          text: FINAL_TEXT,
        })
    })
  }
})
