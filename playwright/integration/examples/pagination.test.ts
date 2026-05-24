import { expect, test } from '@playwright/test'
import { openExample } from 'slate-browser/playwright'

const getLeadingElementBoxes = async (
  root: Awaited<ReturnType<typeof openExample>>['root'],
  count: number
) =>
  root.locator('[data-slate-node="element"]').evaluateAll(
    (elements, expectedCount) =>
      elements.slice(0, expectedCount).map((element) => {
        const rect = element.getBoundingClientRect()

        return {
          height: rect.height,
          top: rect.top,
        }
      }),
    count
  )

const getCaretAndFrameLeft = async (
  root: Awaited<ReturnType<typeof openExample>>['root']
) =>
  root.evaluate((element: HTMLElement) => {
    const selection = element.ownerDocument.getSelection()
    const frame = element.ownerDocument.querySelector(
      '[data-testid="pagination-content-frame"]'
    )

    if (!selection || selection.rangeCount === 0 || !frame) {
      return null
    }

    const range = selection.getRangeAt(0).cloneRange()
    const marker = element.ownerDocument.createElement('span')

    marker.textContent = '|'
    range.insertNode(marker)

    const caretRect = marker.getBoundingClientRect()
    const frameRect = frame.getBoundingClientRect()
    marker.remove()

    return {
      caretLeft: caretRect.left,
      frameLeft: frameRect.left,
    }
  })

const getParagraphBlankTailPoint = async (
  root: Awaited<ReturnType<typeof openExample>>['root'],
  path: string
) =>
  root.evaluate((element: HTMLElement, paragraphPath) => {
    const paragraph = element.querySelector(
      `[data-slate-path="${paragraphPath}"]`
    )
    const strings = paragraph
      ? Array.from(paragraph.querySelectorAll('[data-slate-string]'))
      : []
    const lastString = strings.at(-1)

    if (!paragraph || !lastString) {
      return null
    }

    const paragraphRect = paragraph.getBoundingClientRect()
    const lastStringRect = lastString.getBoundingClientRect()

    return {
      x: Math.min(paragraphRect.right - 12, lastStringRect.right + 80),
      y: (lastStringRect.top + lastStringRect.bottom) / 2,
    }
  }, path)

const getParagraphGapPoint = async (
  root: Awaited<ReturnType<typeof openExample>>['root'],
  beforePath: string,
  afterPath: string
) =>
  root.evaluate(
    (element: HTMLElement, paths) => {
      const before = element.querySelector(
        `[data-slate-path="${paths.beforePath}"]`
      )
      const after = element.querySelector(
        `[data-slate-path="${paths.afterPath}"]`
      )

      if (!before || !after) {
        return null
      }

      const beforeRect = before.getBoundingClientRect()
      const afterRect = after.getBoundingClientRect()
      const strings = Array.from(before.querySelectorAll('[data-slate-string]'))
      const lastStringRect = strings.at(-1)?.getBoundingClientRect()

      return {
        x: lastStringRect
          ? Math.min(beforeRect.right - 12, lastStringRect.right + 80)
          : beforeRect.left + beforeRect.width / 2,
        y: (beforeRect.bottom + afterRect.top) / 2,
      }
    },
    { afterPath, beforePath }
  )

test.describe('pagination example', () => {
  test('places selection on an adjacent paragraph when clicking the paragraph gap', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for experimental pagination editing'
    )

    const editor = await openExample(page, 'pagination', {
      ready: {
        editor: 'visible',
        text: /Premirror Milestone 1 test document/,
      },
    })
    const firstBlockText = (await editor.get.blockTexts())[0]!
    const point = await getParagraphGapPoint(editor.root, '0', '1')

    expect(point).toBeTruthy()

    await page.mouse.click(point!.x, point!.y)

    await expect
      .poll(async () => editor.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: firstBlockText.length },
        focus: { path: [0, 0], offset: firstBlockText.length },
      })
  })

  test('places selection at paragraph end when clicking the blank tail', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for experimental pagination editing'
    )

    const editor = await openExample(page, 'pagination', {
      ready: {
        editor: 'visible',
        text: /Premirror Milestone 1 test document/,
      },
    })
    const firstBlockText = (await editor.get.blockTexts())[0]!
    const point = await getParagraphBlankTailPoint(editor.root, '0')

    expect(point).toBeTruthy()

    await page.mouse.click(point!.x, point!.y)

    await expect
      .poll(async () => editor.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: firstBlockText.length },
        focus: { path: [0, 0], offset: firstBlockText.length },
      })
  })

  test('keeps typed trailing spaces at the paragraph end', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for experimental pagination editing'
    )

    const editor = await openExample(page, 'pagination', {
      ready: {
        editor: 'visible',
        text: /Premirror Milestone 1 test document/,
      },
    })
    const firstBlockText = (await editor.get.blockTexts())[0]!

    await editor.selection.collapse({
      path: [0, 0],
      offset: firstBlockText.length,
    })
    await editor.focus()
    await page.keyboard.insertText('   ')

    await expect
      .poll(async () => (await editor.get.blockTexts())[0])
      .toBe(`${firstBlockText}   `)
    await expect
      .poll(async () => editor.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: firstBlockText.length + 3 },
        focus: { path: [0, 0], offset: firstBlockText.length + 3 },
      })
    await expect
      .poll(async () =>
        editor.root.evaluate(() => {
          const firstText = document.querySelector('[data-slate-path="0,0"]')
          const leaves = Array.from(
            firstText?.querySelectorAll('[data-slate-leaf]') ?? []
          )
          const lastLeaf = leaves.at(-1)

          return {
            lastLeafPosition: lastLeaf
              ? getComputedStyle(lastLeaf).position
              : null,
            lastLeafTextEndsWithSpaces:
              lastLeaf?.textContent?.endsWith('   ') ?? false,
          }
        })
      )
      .toEqual({
        lastLeafPosition: 'absolute',
        lastLeafTextEndsWithSpaces: true,
      })
  })

  test('keeps projected block offsets when virtualized strategy degrades', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for experimental pagination DOM strategy fallback'
    )

    const editor = await openExample(page, 'pagination', {
      ready: {
        editor: 'visible',
        text: /Premirror Milestone 1 test document/,
      },
    })

    await page.getByLabel('DOM strategy').selectOption('virtualized')

    await expect
      .poll(async () => {
        const leadingBoxes = await getLeadingElementBoxes(editor.root, 4)

        return (
          leadingBoxes.length === 4 &&
          leadingBoxes
            .slice(1)
            .every((box, index) => box.top > leadingBoxes[index]!.top + 8)
        )
      })
      .toBe(true)
  })

  test('keeps repeated leading breaks as separate editable paragraphs', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for experimental pagination editing'
    )

    const editor = await openExample(page, 'pagination', {
      ready: {
        editor: 'visible',
        text: /Premirror Milestone 1 test document/,
      },
    })
    const firstBlockText = (await editor.get.blockTexts())[0]!

    await editor.selection.collapse({ path: [0, 0], offset: 0 })
    await editor.focus()

    for (let index = 0; index < 8; index++) {
      await editor.insertBreak()
    }

    await expect
      .poll(async () => (await editor.get.blockTexts()).slice(0, 9))
      .toEqual([...new Array(8).fill(''), firstBlockText])
    await expect
      .poll(async () => editor.selection.get())
      .toEqual({
        anchor: { path: [8, 0], offset: 0 },
        focus: { path: [8, 0], offset: 0 },
      })

    await page.getByRole('switch', { name: 'Debug' }).click()
    await editor.selection.collapse({ path: [8, 0], offset: 0 })
    await editor.focus()
    await expect
      .poll(async () => {
        const positions = await getCaretAndFrameLeft(editor.root)

        return (
          positions && positions.caretLeft >= Math.floor(positions.frameLeft)
        )
      })
      .toBe(true)

    await expect
      .poll(async () => {
        const leadingBoxes = await getLeadingElementBoxes(editor.root, 9)

        return (
          leadingBoxes.length === 9 &&
          leadingBoxes.slice(0, 8).every((box) => box.height > 8) &&
          leadingBoxes
            .slice(1, 8)
            .every((box, index) => box.top > leadingBoxes[index]!.top)
        )
      })
      .toBe(true)

    await editor.deleteBackward()

    await expect
      .poll(async () => (await editor.get.blockTexts()).slice(0, 8))
      .toEqual([...new Array(7).fill(''), firstBlockText])
    await expect
      .poll(async () => editor.selection.get())
      .toEqual({
        anchor: { path: [7, 0], offset: 0 },
        focus: { path: [7, 0], offset: 0 },
      })
  })

  test('keeps leading breaks when native Backspace merges after a space block', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for experimental pagination editing'
    )

    const editor = await openExample(page, 'pagination', {
      ready: {
        editor: 'visible',
        text: /Premirror Milestone 1 test document/,
      },
    })
    const firstBlockText = (await editor.get.blockTexts())[0]!

    await editor.selection.collapse({ path: [0, 0], offset: 0 })
    await editor.focus()

    for (let index = 0; index < 4; index++) {
      await page.keyboard.press('Enter')
    }

    await page.keyboard.insertText(' ')
    await page.keyboard.press('Enter')

    await expect
      .poll(async () => (await editor.get.blockTexts()).slice(0, 6))
      .toEqual([...new Array(4).fill(''), ' ', firstBlockText])

    await page.keyboard.press('Backspace')

    await expect
      .poll(async () => (await editor.get.blockTexts()).slice(0, 5))
      .toEqual([...new Array(4).fill(''), ` ${firstBlockText}`])
    await expect
      .poll(async () => editor.selection.get())
      .toEqual({
        anchor: { path: [4, 0], offset: 1 },
        focus: { path: [4, 0], offset: 1 },
      })
  })

  test('does not seed blank spacer paragraphs in the pagination fixture', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for experimental pagination fixture data'
    )

    const editor = await openExample(page, 'pagination', {
      ready: {
        editor: 'visible',
        text: /Premirror Milestone 1 test document/,
      },
    })

    await expect
      .poll(async () => {
        const texts = (await editor.get.blockTexts()).slice(0, 42)

        return {
          firstFixtureCount: texts.length,
          fourthFollowsThird: texts[3]?.startsWith('Fourth paragraph'),
          hasBlankFixtureParagraph: texts.some((text) => text.length === 0),
          thirdIsThird: texts[2]?.startsWith('Third paragraph'),
        }
      })
      .toEqual({
        firstFixtureCount: 42,
        fourthFollowsThird: true,
        hasBlankFixtureParagraph: false,
        thirdIsThird: true,
      })
  })

  test('renders mixed rich Markdown content inside the page frame', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for experimental pagination rendering'
    )

    const editor = await openExample(page, 'pagination', {
      ready: {
        editor: 'visible',
        text: /Rich Markdown pagination proof/,
      },
    })

    await page.getByRole('switch', { name: 'Debug' }).click()

    const proof = await editor.root.evaluate(() => {
      const viewport = document.querySelector(
        '[data-testid="pagination-viewport"]'
      )
      const table = document.querySelector(
        '[data-testid="pagination-rich-table"]'
      )
      const image = document.querySelector(
        '[data-testid="pagination-rich-image"]'
      )
      const thematicBreak = document.querySelector(
        '[data-testid="pagination-rich-thematic-break"]'
      )
      const codeBlock = document.querySelector(
        '[data-testid="pagination-rich-code-block"]'
      )
      const mixedBlock = Array.from(
        document.querySelectorAll('[data-slate-node="element"]')
      ).find((element) =>
        element.textContent?.includes('This mixed block carries')
      )
      const mixedLeafRows = new Map<
        number,
        {
          left: number
          right: number
          stringRight: number
          text: string | null
        }[]
      >()
      const frames = Array.from(
        document.querySelectorAll('[data-testid="pagination-content-frame"]')
      ).map((frame) => frame.getBoundingClientRect())
      const isInsideFrame = (element: Element | null) => {
        if (!element) {
          return false
        }

        const rect = element.getBoundingClientRect()

        return frames.some(
          (frame) =>
            rect.left >= frame.left - 1 &&
            rect.right <= frame.right + 1 &&
            rect.top >= frame.top - 1 &&
            rect.bottom <= frame.bottom + 1
        )
      }
      const mixedLeafRects = Array.from(
        mixedBlock?.querySelectorAll('[data-slate-leaf]') ?? []
      ).map((leaf) => {
        const rect = leaf.getBoundingClientRect()
        const string =
          leaf.querySelector('[data-slate-string]') ??
          leaf.firstElementChild ??
          leaf
        const stringRect = string.getBoundingClientRect()

        return {
          left: rect.left,
          looseSpacing: rect.right - stringRect.right,
          right: rect.right,
          stringRight: stringRect.right,
          text: leaf.textContent,
          top: Math.round(rect.top),
          width: rect.width,
        }
      })

      mixedLeafRects.forEach((rect) => {
        const row = mixedLeafRows.get(rect.top) ?? []

        row.push({
          left: rect.left,
          right: rect.right,
          stringRight: rect.stringRight,
          text: rect.text,
        })
        mixedLeafRows.set(rect.top, row)
      })

      const mixedInlineRows = [...mixedLeafRows.values()].map((row) =>
        row.slice().sort((a, b) => a.left - b.left || a.right - b.right)
      )
      const mixedInlineOverlaps = mixedInlineRows.flatMap((sorted) =>
        sorted.slice(1).filter((rect, index) => {
          const previous = sorted[index]!

          return rect.left < previous.right - 1
        })
      )
      const mixedInlineLooseSpacing = mixedInlineRows.flatMap((sorted) =>
        sorted.slice(0, -1).filter((rect) => rect.right - rect.stringRight > 8)
      )

      return {
        frameCount: frames.length,
        hasRichText: document.body.textContent?.includes(
          'Rich Markdown pagination proof'
        ),
        codeBlockInsideFrame: isInsideFrame(codeBlock),
        imageInsideFrame: isInsideFrame(image),
        mixedInlineLeafCount: mixedLeafRects.length,
        mixedInlineLooseSpacingCount: mixedInlineLooseSpacing.length,
        mixedInlineOverlapCount: mixedInlineOverlaps.length,
        noHorizontalScroll: viewport
          ? viewport.scrollWidth <= viewport.clientWidth + 1
          : false,
        tableCellCount: document.querySelectorAll(
          '[data-testid="pagination-rich-table-cell"]'
        ).length,
        tableInsideFrame: isInsideFrame(table),
        thematicBreakInsideFrame: isInsideFrame(thematicBreak),
      }
    })

    expect(proof).toEqual({
      frameCount: expect.any(Number),
      hasRichText: true,
      codeBlockInsideFrame: true,
      imageInsideFrame: true,
      mixedInlineLeafCount: expect.any(Number),
      mixedInlineLooseSpacingCount: 0,
      mixedInlineOverlapCount: 0,
      noHorizontalScroll: true,
      tableCellCount: 6,
      tableInsideFrame: true,
      thematicBreakInsideFrame: true,
    })
    expect(proof.frameCount).toBeGreaterThan(1)
    expect(proof.mixedInlineLeafCount).toBeGreaterThan(1)
  })
})
