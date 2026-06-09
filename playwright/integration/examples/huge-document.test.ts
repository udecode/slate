import { expect, test } from '@playwright/test'
import {
  openExample,
  type SlateBrowserEditorHarness,
} from 'slate-browser/playwright'

const hugeDocumentReadyTimeout = 90 * 1000

type SlateBrowserHandleSelection = {
  anchor: { offset: number; path: number[] }
  focus: { offset: number; path: number[] }
}

type SlateBrowserHandleElement = HTMLElement & {
  __slateBrowserHandle?: {
    getSelection?: () => SlateBrowserHandleSelection | null
    scrollPathIntoView?: (path: number[], align: 'center') => boolean
  }
}

test.setTimeout(120 * 1000)

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
    }> = [
      {
        clientHeight: window.innerHeight,
        scrollHeight: document.documentElement.scrollHeight,
        scrollTop: window.scrollY,
      },
    ]

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

const waitForTextBlockMaterialized = async (
  editor: SlateBrowserEditorHarness,
  blockIndex: number
) => {
  await editor.page.waitForFunction(
    (index) => {
      const root = document.querySelector('[data-slate-editor="true"]')
      const materialized = !!root?.querySelector(
        `[data-slate-node="text"][data-slate-path="${index},0"]`
      )

      if (!materialized) {
        const handle = (root as SlateBrowserHandleElement | null)
          ?.__slateBrowserHandle

        handle?.scrollPathIntoView?.([index, 0], 'center')
      }

      return materialized
    },
    blockIndex,
    { timeout: hugeDocumentReadyTimeout }
  )
}

const getTextBlockText = async (
  editor: SlateBrowserEditorHarness,
  blockIndex: number
) =>
  editor.root.evaluate((element: HTMLElement, index) => {
    const textElement = element.querySelector(
      `[data-slate-node="text"][data-slate-path="${index},0"]`
    )
    const block = textElement?.closest('[data-slate-node="element"]')

    return (block ?? textElement)?.textContent?.replace(/\uFEFF/g, '') ?? null
  }, blockIndex)

const selectTextBlockOffsetDOM = async (
  editor: SlateBrowserEditorHarness,
  blockIndex: number,
  offset: number
) => {
  await editor.selection.collapse({ offset, path: [blockIndex, 0] })
  await waitForTextBlockMaterialized(editor, blockIndex)

  await editor.root.evaluate(
    (element: HTMLElement, { index, offset }) => {
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
      const textNode = walker.nextNode()

      if (!textNode) {
        throw new Error(`Missing text node for block ${index}`)
      }

      const range = element.ownerDocument.createRange()
      const selection = element.ownerDocument.getSelection()

      range.setStart(textNode, offset)
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      element.focus()
      element.ownerDocument.dispatchEvent(
        new Event('selectionchange', { bubbles: true })
      )
    },
    { index: blockIndex, offset }
  )

  await editor.assert.selection({
    anchor: { offset, path: [blockIndex, 0] },
    focus: { offset, path: [blockIndex, 0] },
  })
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

        if (!selection || selection.rangeCount === 0) {
          return false
        }

        const range = selection.getRangeAt(0)
        const markerRect = range.getBoundingClientRect()
        const parentRect = scrollParent?.getBoundingClientRect() ?? {
          bottom: window.innerHeight,
          top: 0,
        }

        return (
          markerRect.top >= parentRect.top - 1 &&
          markerRect.bottom <= parentRect.bottom + 1
        )
      })
    )
    .toBe(true)
}

const openSmallHugeDocument = async (
  page: Parameters<typeof openExample>[0],
  query: Record<string, string | number | boolean> = {}
) =>
  openExample(page, 'huge-document', {
    query: {
      blocks: 120,
      content_visibility: 'none',
      strict: 'false',
      ...query,
    },
    ready: { editor: 'visible' },
  })

test.describe('huge document example', () => {
  test('renders huge document without child-count chunking', async ({
    page,
  }) => {
    await page.goto('/examples/huge-document', {
      waitUntil: 'commit',
    })
    await expect(page.getByLabel('Blocks')).toHaveValue('10000')
    await expect(page.getByRole('textbox')).toBeVisible({
      timeout: hugeDocumentReadyTimeout,
    })
    await expect(page.getByLabel('DOM strategy')).toHaveValue('virtualized')
    await expect
      .poll(() =>
        page.getByTestId('huge-document-effective-strategy').textContent()
      )
      .toBe('virtualized')
    await expect
      .poll(async () =>
        Number(
          await page
            .getByTestId('huge-document-mounted-top-level-count')
            .textContent()
        )
      )
      .toBeLessThan(200)
    await expect(page.locator('[data-slate-chunk]')).toHaveCount(0)
  })

  test('exposes staged DOM strategy controls and metrics', async ({ page }) => {
    await openSmallHugeDocument(page, {
      blocks: 1200,
      overscan: 0,
      segment_size: 100,
      strategy: 'staged',
      threshold: 1,
    })

    await expect(page.getByLabel('DOM strategy')).toHaveValue('staged')
    await expect
      .poll(() =>
        page.getByTestId('huge-document-effective-strategy').textContent()
      )
      .toBe('staged')
    await expect
      .poll(async () =>
        Number(
          await page
            .getByTestId('huge-document-mounted-top-level-count')
            .textContent()
        )
      )
      .toBeGreaterThan(0)
    await expect
      .poll(async () =>
        Number(
          await page
            .getByTestId('huge-document-dom-coverage-boundary-count')
            .textContent()
        )
      )
      .toBeGreaterThanOrEqual(0)
  })

  test('keeps auto DOM strategy bounded for huge documents', async ({
    page,
  }) => {
    const editor = await openSmallHugeDocument(page, {
      blocks: 10_000,
      strategy: 'auto',
    })

    await expect(page.getByLabel('DOM strategy')).toHaveValue('auto')
    await expect
      .poll(() =>
        page.getByTestId('huge-document-effective-strategy').textContent()
      )
      .toBe('partial-dom')

    await page.waitForTimeout(1600)

    const proof = await editor.root.evaluate((element: HTMLElement) => ({
      domNodeCount: Number(
        element.ownerDocument
          .querySelector('[data-test-id="huge-document-dom-node-count"]')
          ?.textContent?.replace(/,/g, '') ?? Number.NaN
      ),
      mountedTopLevelCount: Number(
        element.ownerDocument
          .querySelector(
            '[data-test-id="huge-document-mounted-top-level-count"]'
          )
          ?.textContent?.replace(/,/g, '') ?? Number.NaN
      ),
      pendingRootGroupCount: element.querySelectorAll(
        '[data-slate-root-group-state="pending-mount"]'
      ).length,
      pendingTopLevelCount: Number(
        element.ownerDocument
          .querySelector(
            '[data-test-id="huge-document-pending-top-level-count"]'
          )
          ?.textContent?.replace(/,/g, '') ?? Number.NaN
      ),
      placeholderCount: element.querySelectorAll(
        '[data-slate-dom-strategy-placeholder="true"]'
      ).length,
    }))

    expect(proof.mountedTopLevelCount).toBeLessThanOrEqual(80)
    expect(proof.pendingTopLevelCount).toBeGreaterThan(9000)
    expect(proof.domNodeCount).toBeLessThan(2500)
    expect(proof.placeholderCount).toBeGreaterThan(0)
    expect(proof.pendingRootGroupCount).toBe(0)
  })

  test('exposes virtualized DOM strategy controls and metrics', async ({
    page,
  }) => {
    await openSmallHugeDocument(page, {
      blocks: 1200,
      editor_height: 360,
      estimated_block_size: 48,
      overscan: 0,
      strategy: 'virtualized',
      threshold: 1,
    })

    await expect(page.getByLabel('DOM strategy')).toHaveValue('virtualized')
    await expect(page.getByLabel('Editor height')).toHaveValue('360')
    await expect
      .poll(() =>
        page.getByTestId('huge-document-effective-strategy').textContent()
      )
      .toBe('virtualized')
    await expect
      .poll(async () =>
        Number(
          await page
            .getByTestId('huge-document-viewport-boundary-count')
            .textContent()
        )
      )
      .toBeGreaterThan(0)
    await expect(
      page.locator('[data-slate-dom-strategy-virtualizer="true"]')
    ).toBeVisible()
  })

  test('keeps virtualized middle-block fast typing on the selected block', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Desktop typing perf proof')

    const blockIndex = 2500
    const offset = 1
    const typeText = 'X'.repeat(10)
    const editor = await openSmallHugeDocument(page, {
      blocks: 5000,
      editor_height: 600,
      estimated_block_size: 48,
      overscan: 2,
      strategy: 'virtualized',
      threshold: 1,
    })

    await expect
      .poll(() =>
        page.getByTestId('huge-document-effective-strategy').textContent()
      )
      .toBe('virtualized')

    await selectTextBlockOffsetDOM(editor, blockIndex, offset)
    const beforeText = await getTextBlockText(editor, blockIndex)

    if (!beforeText) {
      throw new Error(`Missing text for block ${blockIndex}`)
    }

    const expectedText =
      beforeText.slice(0, offset) + typeText + beforeText.slice(offset)

    await page.keyboard.type(typeText)

    await expect
      .poll(() => getTextBlockText(editor, blockIndex))
      .toBe(expectedText)
    await editor.assert.selection({
      anchor: { offset: offset + typeText.length, path: [blockIndex, 0] },
      focus: { offset: offset + typeText.length, path: [blockIndex, 0] },
    })
  })

  test('keeps virtualized insert-break bursts split at the live caret', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for virtualized insert-break burst routing'
    )

    const blockIndex = 0
    const offset = 4
    const firstText = 'abc'
    const secondText = 'def'
    const editor = await openSmallHugeDocument(page, {
      blocks: 10_000,
      content_visibility: 'element',
      editor_height: 420,
      estimated_block_size: 48,
      overscan: 0,
      strategy: 'virtualized',
      threshold: 2000,
    })

    await expect
      .poll(() =>
        page.getByTestId('huge-document-effective-strategy').textContent()
      )
      .toBe('virtualized')

    await selectTextBlockOffsetDOM(editor, blockIndex, offset)
    const beforeText = await getTextBlockText(editor, blockIndex)

    if (!beforeText) {
      throw new Error(`Missing text for block ${blockIndex}`)
    }

    const expectedFirstBlock = beforeText.slice(0, offset) + firstText
    const expectedSecondBlock = secondText + beforeText.slice(offset)

    await page.keyboard.type(`${firstText}\n${secondText}`, { delay: 0 })
    await waitForTextBlockMaterialized(editor, blockIndex + 1)

    await expect
      .poll(async () => ({
        firstBlock: await getTextBlockText(editor, blockIndex),
        secondBlock: await getTextBlockText(editor, blockIndex + 1),
        selection: await editor.selection.get(),
      }))
      .toEqual({
        firstBlock: expectedFirstBlock,
        secondBlock: expectedSecondBlock,
        selection: {
          anchor: { offset: secondText.length, path: [blockIndex + 1, 0] },
          focus: { offset: secondText.length, path: [blockIndex + 1, 0] },
        },
      })

    await testInfo.attach('huge-document-insert-break-burst-proof', {
      body: JSON.stringify(
        {
          expectedFirstBlock,
          expectedSecondBlock,
          offset,
        },
        null,
        2
      ),
      contentType: 'application/json',
    })
  })

  test('keeps virtualized backward scroll stable over dynamic block heights', async ({
    page,
  }) => {
    const editor = await openSmallHugeDocument(page, {
      blocks: 1200,
      editor_height: 260,
      estimated_block_size: 24,
      overscan: 0,
      strategy: 'virtualized',
      threshold: 1,
    })

    await expect
      .poll(() =>
        page.getByTestId('huge-document-effective-strategy').textContent()
      )
      .toBe('virtualized')

    const proof = await editor.root.evaluate(async (element: HTMLElement) => {
      const nextFrame = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const getRowHeights = () =>
        Array.from(
          element.querySelectorAll<HTMLElement>(
            '[data-slate-dom-strategy-virtual-row="true"]'
          )
        )
          .map((row) => Math.round(row.getBoundingClientRect().height))
          .filter((height) => height > 0)

      await nextFrame()
      await nextFrame()

      element.scrollTop = 4800
      element.dispatchEvent(new Event('scroll', { bubbles: true }))

      await nextFrame()
      await nextFrame()

      const before = element.scrollTop
      const target = Math.max(0, before - 360)
      const heightsBefore = getRowHeights()

      element.scrollTop = target
      element.dispatchEvent(new Event('scroll', { bubbles: true }))

      await nextFrame()
      await nextFrame()

      const after = element.scrollTop
      const heightsAfter = getRowHeights()
      const heightSpread =
        Math.max(...heightsBefore, ...heightsAfter) -
        Math.min(...heightsBefore, ...heightsAfter)

      return {
        after,
        before,
        heightSpread,
        target,
      }
    })

    expect(proof.before).toBeGreaterThan(0)
    expect(proof.heightSpread).toBeGreaterThan(1)
    expect(proof.after).toBeGreaterThanOrEqual(proof.target - 16)
    expect(proof.after).toBeLessThanOrEqual(proof.target + 80)
  })

  test('keeps downward drag selection autoscroll from reversing in virtualized mode', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for drag-selection autoscroll direction'
    )

    await page.setViewportSize({ height: 900, width: 900 })

    const editor = await openSmallHugeDocument(page, {
      blocks: 1000,
      editor_height: 420,
      estimated_block_size: 48,
      overscan: 0,
      strategy: 'virtualized',
      threshold: 1,
    })

    await expect
      .poll(() =>
        page.getByTestId('huge-document-effective-strategy').textContent()
      )
      .toBe('virtualized')

    await editor.root.scrollIntoViewIfNeeded()

    const target = await editor.root.evaluate((element: HTMLElement) => {
      element.scrollTop = 0

      const string = element.querySelector<HTMLElement>('[data-slate-string]')

      if (!string) {
        throw new Error('Missing initial huge-document text target')
      }

      const rootRect = element.getBoundingClientRect()
      const rect = string.getBoundingClientRect()

      return {
        edge: {
          x: rect.left + Math.min(240, rect.width - 4),
          y: rootRect.bottom - 6,
        },
        start: {
          x: rect.left + Math.min(80, rect.width / 2),
          y: rect.top + Math.min(14, rect.height / 2),
        },
      }
    })

    await page.mouse.move(target.start.x, target.start.y)
    await page.mouse.down()
    await page.mouse.move(target.edge.x, target.edge.y, { steps: 24 })

    const samples: Array<{
      collapsed: boolean | null
      focusPath: number[] | null
      modelExpanded: boolean
      scrollTop: number
      selectedLength: number
      viewSelectionCount: number
    }> = []

    for (let index = 0; index < 30; index++) {
      await page.waitForTimeout(16)
      samples.push(
        await editor.root.evaluate((element: HTMLElement) => {
          const selection = element.ownerDocument.getSelection()
          const modelSelection =
            (
              element as SlateBrowserHandleElement
            ).__slateBrowserHandle?.getSelection?.() ?? null
          const modelExpanded = modelSelection
            ? modelSelection.anchor.offset !== modelSelection.focus.offset ||
              modelSelection.anchor.path.join(',') !==
                modelSelection.focus.path.join(',')
            : false

          return {
            collapsed: selection?.isCollapsed ?? null,
            focusPath: modelSelection?.focus.path ?? null,
            modelExpanded,
            scrollTop: Math.round(element.scrollTop),
            selectedLength: selection?.toString().length ?? 0,
            viewSelectionCount: element.querySelectorAll(
              '[data-slate-view-selection="true"]'
            ).length,
          }
        })
      )
    }

    await page.mouse.up()

    const scrollTops = samples.map((sample) => sample.scrollTop)
    const focusBlockIndexes = samples
      .map((sample) => sample.focusPath?.[0])
      .filter((index): index is number => typeof index === 'number')
    const maxBackwardScrollStep = scrollTops.reduce((maxStep, scrollTop, i) => {
      const nextScrollTop = scrollTops[i + 1]

      return nextScrollTop === undefined
        ? maxStep
        : Math.max(maxStep, scrollTop - nextScrollTop)
    }, 0)
    const maxFocusBlockIndex = Math.max(...focusBlockIndexes)
    const focusRegressedToStart = focusBlockIndexes.some(
      (blockIndex, index) =>
        index > 0 &&
        Math.max(...focusBlockIndexes.slice(0, index)) >= 2 &&
        blockIndex === 0
    )

    await testInfo.attach('huge-document-downward-drag-autoscroll', {
      body: JSON.stringify(
        {
          focusBlockIndexes,
          maxBackwardScrollStep,
          samples,
          scrollTops,
        },
        null,
        2
      ),
      contentType: 'application/json',
    })

    expect(Math.max(...scrollTops)).toBeGreaterThan(24)
    expect(maxBackwardScrollStep).toBeLessThanOrEqual(4)
    expect(maxFocusBlockIndex).toBeGreaterThanOrEqual(2)
    expect(focusRegressedToStart).toBe(false)
    expect(
      samples.some(
        (sample) =>
          sample.selectedLength > 0 ||
          sample.viewSelectionCount > 0 ||
          sample.modelExpanded
      )
    ).toBe(true)
    expect(
      samples.every(
        (sample) =>
          sample.collapsed === false ||
          sample.viewSelectionCount > 0 ||
          sample.modelExpanded
      )
    ).toBe(true)
  })

  test('keeps blank-gap drag selection from regressing into the document start', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for blank-gap drag selection geometry'
    )

    await page.setViewportSize({ height: 700, width: 900 })

    const editor = await openSmallHugeDocument(page, {
      blocks: 1000,
      editor_height: 420,
      overscan: 0,
      strategy: 'virtualized',
      threshold: 1,
    })

    await expect
      .poll(() =>
        page.getByTestId('huge-document-effective-strategy').textContent()
      )
      .toBe('virtualized')

    await editor.root.scrollIntoViewIfNeeded()

    const target = await editor.root.evaluate((element: HTMLElement) => {
      element.scrollTop = 0

      const heading = element.querySelector<HTMLElement>(
        '[data-slate-node="text"][data-slate-path="0,0"]'
      )
      const firstParagraph = element.querySelector<HTMLElement>(
        '[data-slate-node="text"][data-slate-path="1,0"]'
      )
      const secondParagraph = element.querySelector<HTMLElement>(
        '[data-slate-node="text"][data-slate-path="2,0"]'
      )
      const thirdBlock = element.querySelector<HTMLElement>(
        '[data-slate-node="element"][data-slate-path="3"]'
      )

      if (!heading || !firstParagraph || !secondParagraph || !thirdBlock) {
        throw new Error('Missing huge-document blank-gap drag targets')
      }

      const firstRect = firstParagraph.getBoundingClientRect()
      const secondRect = secondParagraph.getBoundingClientRect()
      const thirdRect = thirdBlock.getBoundingClientRect()

      return {
        gap: {
          x: secondRect.left + Math.min(250, secondRect.width - 8),
          y: (secondRect.bottom + thirdRect.top) / 2,
        },
        headingText: heading.textContent?.replace(/\uFEFF/g, '') ?? '',
        insideSecond: {
          x: secondRect.left + Math.min(250, secondRect.width - 8),
          y: secondRect.top + Math.min(20, secondRect.height / 2),
        },
        start: {
          x: firstRect.left + Math.min(80, firstRect.width - 8),
          y: firstRect.top + Math.min(12, firstRect.height / 2),
        },
      }
    })

    await page.mouse.move(target.start.x, target.start.y)
    await page.mouse.down()

    const points = [
      ...Array.from({ length: 8 }, (_, index) => ({
        x:
          target.start.x +
          (target.insideSecond.x - target.start.x) * ((index + 1) / 8),
        y:
          target.start.y +
          (target.insideSecond.y - target.start.y) * ((index + 1) / 8),
      })),
      ...Array.from({ length: 8 }, (_, index) => ({
        x:
          target.insideSecond.x +
          (target.gap.x - target.insideSecond.x) * ((index + 1) / 8),
        y:
          target.insideSecond.y +
          (target.gap.y - target.insideSecond.y) * ((index + 1) / 8),
      })),
    ]
    const samples: Array<{
      focusPath: number[] | null
      minSelectedBlockIndex: number | null
      nativeIncludesHeading: boolean
      nativeLength: number
      viewSelectionCount: number
    }> = []

    for (const point of points) {
      await page.mouse.move(point.x, point.y)
      await page.waitForTimeout(20)
      samples.push(
        await editor.root.evaluate(
          (
            element: HTMLElement,
            headingText: string
          ): {
            focusPath: number[] | null
            minSelectedBlockIndex: number | null
            nativeIncludesHeading: boolean
            nativeLength: number
            viewSelectionCount: number
          } => {
            const selection = element.ownerDocument.getSelection()
            const modelSelection =
              (
                element as SlateBrowserHandleElement
              ).__slateBrowserHandle?.getSelection?.() ?? null
            const selectedBlockIndexes = modelSelection
              ? [
                  modelSelection.anchor.path[0],
                  modelSelection.focus.path[0],
                ].filter((index): index is number => typeof index === 'number')
              : []
            const nativeText = selection?.toString() ?? ''

            return {
              focusPath: modelSelection?.focus.path ?? null,
              minSelectedBlockIndex:
                selectedBlockIndexes.length === 0
                  ? null
                  : Math.min(...selectedBlockIndexes),
              nativeIncludesHeading:
                headingText.length > 0 && nativeText.includes(headingText),
              nativeLength: nativeText.length,
              viewSelectionCount: element.querySelectorAll(
                '[data-slate-view-selection="true"]'
              ).length,
            }
          },
          target.headingText
        )
      )
    }

    await page.mouse.up()

    await testInfo.attach('huge-document-blank-gap-drag-selection', {
      body: JSON.stringify({ samples }, null, 2),
      contentType: 'application/json',
    })

    expect(samples.some((sample) => sample.nativeLength > 0)).toBe(true)
    expect(samples.some((sample) => sample.focusPath?.[0] === 2)).toBe(true)
    expect(samples.every((sample) => !sample.nativeIncludesHeading)).toBe(true)
    expect(
      samples.every(
        (sample) =>
          sample.minSelectedBlockIndex === null ||
          sample.minSelectedBlockIndex >= 1
      )
    ).toBe(true)
  })

  test('keeps repeated typing visible after manual scroll-away', async ({
    page,
  }) => {
    const editor = await openSmallHugeDocument(page, {
      strategy: 'full',
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

  test('keeps clicked refocus position visible in a long editor', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile',
      'Desktop refocus scroll proof'
    )

    const editor = await openSmallHugeDocument(page, {
      strategy: 'full',
    })
    const blockTexts = await editor.get.blockTexts()
    const lastBlockIndex = blockTexts.length - 1

    await scrollBlockIntoView(editor, 0)
    await clickTextBlock(editor, 0)
    await expect
      .poll(async () => {
        const selection = await editor.selection.get()

        return {
          anchorPath: selection?.anchor.path,
          focusPath: selection?.focus.path,
        }
      })
      .toEqual({
        anchorPath: [0, 0],
        focusPath: [0, 0],
      })

    await page.getByLabel('Blocks').focus()
    await expect(page.getByLabel('Blocks')).toBeFocused()

    await scrollBlockIntoView(editor, lastBlockIndex)
    const beforeClickScrollTop = Math.max(
      ...(await getScrollableParentState(editor)).map(
        (state) => state.scrollTop
      )
    )

    expect(beforeClickScrollTop).toBeGreaterThan(0)

    await clickTextBlock(editor, lastBlockIndex)

    await expect
      .poll(async () => {
        const selection = await editor.selection.get()

        return {
          anchorPath: selection?.anchor.path,
          focusPath: selection?.focus.path,
        }
      })
      .toEqual({
        anchorPath: [lastBlockIndex, 0],
        focusPath: [lastBlockIndex, 0],
      })
    await expect
      .poll(async () =>
        Math.max(
          ...(await getScrollableParentState(editor)).map(
            (state) => state.scrollTop
          )
        )
      )
      .toBeGreaterThan(beforeClickScrollTop - 120)
    await expectCaretVisibleInScrollableParent(editor)
  })

  test('keeps caret at the edited block end across repeated manual scroll-away typing', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile',
      'Desktop keyboard scroll proof'
    )

    const editor = await openSmallHugeDocument(page, {
      strategy: 'full',
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
