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

const getPaginationTableProof = async (
  root: Awaited<ReturnType<typeof openExample>>['root']
) =>
  root.evaluate(() => {
    const table = document.querySelector(
      '[data-testid="pagination-rich-table"]'
    )
    const tablePath = table?.getAttribute('data-slate-path') ?? null
    const frames = Array.from(
      document.querySelectorAll('[data-testid="pagination-content-frame"]')
    ).map((frame) => frame.getBoundingClientRect())
    const rows = Array.from(
      document.querySelectorAll('[data-testid="pagination-rich-table-row"]')
    )
    const visibleRows = rows
      .map((row) => {
        const rect = row.getBoundingClientRect()

        return {
          display: getComputedStyle(row).display,
          height: rect.height,
          left: rect.left,
          path: row.getAttribute('data-slate-path'),
          rowIndex: row.getAttribute('data-pagination-row-index'),
          top: rect.top,
          width: rect.width,
        }
      })
      .filter((row) => row.display !== 'none' && row.height > 0)
    const rowFrameIndexes = visibleRows.map((row) =>
      frames.findIndex(
        (frame) =>
          row.left >= frame.left - 1 &&
          row.left + row.width <= frame.right + 1 &&
          row.top >= frame.top - 1 &&
          row.top + row.height <= frame.bottom + 1
      )
    )
    const visibleCellCount = Array.from(
      document.querySelectorAll('[data-testid="pagination-rich-table-cell"]')
    ).filter((cell) => cell.getBoundingClientRect().height > 0).length
    const pathCounts = new Map<string, number>()

    if (tablePath) {
      document
        .querySelectorAll(
          `[data-slate-path="${tablePath}"], [data-slate-path^="${tablePath},"]`
        )
        .forEach((element) => {
          const path = element.getAttribute('data-slate-path')

          if (path) {
            pathCounts.set(path, (pathCounts.get(path) ?? 0) + 1)
          }
        })
    }

    return {
      duplicatePaths: [...pathCounts]
        .filter(([, count]) => count > 1)
        .map(([path]) => path),
      mountedCellCount: document.querySelectorAll(
        '[data-testid="pagination-rich-table-cell"]'
      ).length,
      mountedRowCount: rows.length,
      rowFrameIndexes,
      tableCount: document.querySelectorAll(
        '[data-testid="pagination-rich-table"]'
      ).length,
      tablePath,
      visibleCellCount,
      visibleRowCount: visibleRows.length,
    }
  })

const getPaginationVirtualizedTableProof = async (
  root: Awaited<ReturnType<typeof openExample>>['root']
) =>
  root.evaluate(() => {
    const metaText =
      document.querySelector('.slate-pagination-meta')?.textContent ?? ''
    const pageTotal = Number(metaText.match(/pages (\d+)/)?.[1] ?? 0)
    const pageOverscan = Number(metaText.match(/page overscan (\d+)/)?.[1] ?? 0)
    const tablePageCount = Number(metaText.match(/table pages (\d+)/)?.[1] ?? 0)
    const stressPageCount = Number(
      metaText.match(/stress pages (\d+)/)?.[1] ?? 0
    )
    const rows = Array.from(
      document.querySelectorAll('[data-testid="pagination-rich-table-row"]')
    )
    const rowIndexes = rows
      .map((row) => Number(row.getAttribute('data-pagination-row-index')))
      .filter(Number.isFinite)
      .sort((left, right) => left - right)

    return {
      firstRowIndex: rowIndexes[0] ?? null,
      hasRow120: rowIndexes.includes(119),
      lastRowIndex: rowIndexes.at(-1) ?? null,
      mountedCellCount: document.querySelectorAll(
        '[data-testid="pagination-rich-table-cell"]'
      ).length,
      mountedRowCount: rows.length,
      pageSurfaceCount: document.querySelectorAll('[data-slate-page-surface]')
        .length,
      pageTotal,
      pageOverscan,
      pageVirtualizationEnabled: Boolean(
        document.querySelector(
          '[data-slate-paged-editable-page-virtualization="true"]'
        )
      ),
      stressPageCount,
      tablePageCount,
      tableMounted: Boolean(
        document.querySelector('[data-testid="pagination-rich-table"]')
      ),
      totalElementCount: document.querySelectorAll('*').length,
    }
  })

const getMountedPaginationPageIndexes = async (
  root: Awaited<ReturnType<typeof openExample>>['root']
) =>
  root.evaluate(() =>
    Array.from(document.querySelectorAll('[data-slate-page]'))
      .map((page) => Number(page.getAttribute('data-slate-page-index')))
      .filter(Number.isFinite)
      .sort((left, right) => left - right)
  )

type PaginationFastScrollSample = {
  eventToPaintMs: number
  firstRowIndex: number | null
  hitVisibleContentCount: number
  lastRowIndex: number | null
  mountedCellCount: number
  mountedRowCount: number
  pageSurfaceCount: number
  totalElementCount: number
  visibleText: string
}

type PaginationMiddleTypingSample = {
  blockText?: string | null
  blockVisible: boolean
  composeMs: number
  eventToPaintMs: number
  hasExpectedText: boolean
  pageSurfaceCount: number
  profiler?: {
    byKind: Record<string, number>
    byKey: Record<string, number>
    durationsById: Record<string, number>
    total: number
  }
  sampleCount?: number
  textObservedMs?: number | null
  totalElementCount: number
}

type PaginationProjectedTextTarget = {
  blockPath: string
  blockText: string
  firstLeafLeft: number
  firstLeafTop: number
  leafText: string
  visibleLeafCount: number
  x: number
  y: number
}

type PaginationProjectedTextProof = {
  absoluteLeafCount: number
  blockText: string | null
  domSync: string | null
  firstVisibleLeafLeft: number | null
  firstVisibleLeafTop: number | null
  pageSurfaceCount: number
  reason: string | null
  staticLeafCount: number
  totalElementCount: number
  visibleLeafCount: number
}

const getVisibleProjectedPaginationTextTarget = async (
  root: Awaited<ReturnType<typeof openExample>>['root']
) =>
  root.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>(
      '[data-testid="pagination-viewport"]'
    )
    const viewportRect = viewport?.getBoundingClientRect()

    if (!viewportRect) {
      return null
    }

    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-slate-node="element"][data-slate-path]'
      )
    )
      .flatMap((block) => {
        const blockPath = block.getAttribute('data-slate-path')

        if (!blockPath || blockPath.includes(',')) {
          return []
        }

        const textHost = block.querySelector<HTMLElement>(
          `[data-slate-node="text"][data-slate-path="${blockPath},0"]`
        )
        const visibleLeaves = Array.from(
          block.querySelectorAll<HTMLElement>('[data-slate-leaf]')
        )
          .map((leaf) => {
            const rect = leaf.getBoundingClientRect()

            return {
              bottom: rect.bottom,
              left: rect.left,
              right: rect.right,
              text: leaf.textContent?.replace(/\s+/g, ' ').trim() ?? '',
              top: rect.top,
              width: rect.width,
            }
          })
          .filter(
            (leaf) =>
              leaf.text.length > 0 &&
              leaf.width > 0 &&
              leaf.bottom > viewportRect.top + 32 &&
              leaf.top < viewportRect.bottom - 32 &&
              leaf.right > viewportRect.left &&
              leaf.left < viewportRect.right
          )

        if (visibleLeaves.length === 0) {
          return []
        }

        const blockRect = block.getBoundingClientRect()
        const maxLeafWidth = Math.max(
          ...visibleLeaves.map((leaf) => leaf.width)
        )
        const firstLeaf = visibleLeaves[0]!

        if (
          textHost?.getAttribute('data-slate-dom-sync-reason') !==
            'projection' ||
          visibleLeaves.length < 6 ||
          blockRect.width <= maxLeafWidth * 1.5
        ) {
          return []
        }

        return [
          {
            blockPath,
            blockText: block.textContent ?? '',
            firstLeafLeft: firstLeaf.left,
            firstLeafTop: firstLeaf.top,
            leafText: firstLeaf.text,
            visibleLeafCount: visibleLeaves.length,
            x: firstLeaf.left + 40,
            y: (firstLeaf.top + firstLeaf.bottom) / 2,
          } satisfies PaginationProjectedTextTarget,
        ]
      })
      .sort(
        (left, right) =>
          right.visibleLeafCount - left.visibleLeafCount ||
          right.firstLeafTop - left.firstLeafTop
      )

    return candidates[0] ?? null
  })

const getVisiblePaginationTextTargetByPath = async (
  root: Awaited<ReturnType<typeof openExample>>['root'],
  blockPath: string
) =>
  root.evaluate((element: HTMLElement, path) => {
    const viewport = element.ownerDocument.querySelector<HTMLElement>(
      '[data-testid="pagination-viewport"]'
    )
    const viewportRect = viewport?.getBoundingClientRect()
    const block = element.querySelector<HTMLElement>(
      `[data-slate-node="element"][data-slate-path="${path}"]`
    )
    const leaf = block?.querySelector<HTMLElement>('[data-slate-leaf]')

    if (!block || !leaf || !viewportRect) {
      return null
    }

    const rect = leaf.getBoundingClientRect()

    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.bottom <= viewportRect.top + 10 ||
      rect.top >= viewportRect.bottom - 10
    ) {
      return null
    }

    return {
      blockPath: path,
      blockText: block.textContent ?? '',
      x: Math.min(rect.right - 4, rect.left + 60),
      y: (rect.top + rect.bottom) / 2,
    }
  }, blockPath)

const getVisiblePaginationLineMarginTargetByPath = async (
  root: Awaited<ReturnType<typeof openExample>>['root'],
  blockPath: string
) =>
  root.evaluate((element: HTMLElement, path) => {
    const viewport = element.ownerDocument.querySelector<HTMLElement>(
      '[data-testid="pagination-viewport"]'
    )
    const viewportRect = viewport?.getBoundingClientRect()
    const block = element.querySelector<HTMLElement>(
      `[data-slate-node="element"][data-slate-path="${path}"]`
    )
    const leaf = block?.querySelector<HTMLElement>('[data-slate-leaf]')

    if (!block || !leaf || !viewportRect) {
      return null
    }

    const rect = leaf.getBoundingClientRect()

    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.bottom <= viewportRect.top + 10 ||
      rect.top >= viewportRect.bottom - 10
    ) {
      return null
    }

    return {
      blockPath: path,
      blockText: block.textContent ?? '',
      x: rect.left - 60,
      y: (rect.top + rect.bottom) / 2,
    }
  }, blockPath)

const getVisiblePaginationWrappedLineMarginTargets = async (
  root: Awaited<ReturnType<typeof openExample>>['root'],
  side: 'left' | 'right'
) =>
  root.evaluate(
    (element: HTMLElement, targetSide) => {
      const edge = targetSide as 'end' | 'start'
      const getRectVerticalDistance = (rect: DOMRect, y: number) =>
        y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0
      const getLineEdgeOffset = (
        textNode: ChildNode,
        lineRect: DOMRect,
        edge: 'end' | 'start'
      ) => {
        const textLength = textNode.textContent?.length ?? 0
        const y = lineRect.top + lineRect.height / 2
        const range = element.ownerDocument.createRange()
        let best: { distance: number; offset: number } | null = null

        for (let offset = 0; offset < textLength; offset++) {
          range.setStart(textNode, offset)
          range.setEnd(textNode, offset + 1)

          for (const rect of Array.from(range.getClientRects())) {
            const verticalDistance = getRectVerticalDistance(rect, y)
            const verticalCenterDistance = Math.abs(
              rect.top + rect.height / 2 - y
            )
            const horizontalDistance =
              edge === 'start'
                ? Math.abs(rect.left - lineRect.left)
                : Math.abs(rect.right - lineRect.right)
            const distance =
              verticalDistance * 1_000_000 +
              verticalCenterDistance * 1000 +
              horizontalDistance

            if (!best || distance < best.distance) {
              best = {
                distance,
                offset: edge === 'start' ? offset : offset + 1,
              }
            }
          }
        }

        return best?.offset ?? (edge === 'start' ? 0 : textLength)
      }
      const toNumber = (value: string | null) =>
        value === null ? null : Number.parseInt(value, 10)
      const getStringDocumentOffset = (
        textHost: HTMLElement,
        string: HTMLElement,
        lineOffset: number
      ) => {
        const leaf = string.closest<HTMLElement>('[data-slate-leaf]')
        const leafStart = toNumber(
          leaf ? leaf.getAttribute('data-slate-leaf-start') : null
        )
        const leafEnd = toNumber(
          leaf ? leaf.getAttribute('data-slate-leaf-end') : null
        )

        if (
          leafStart !== null &&
          leafEnd !== null &&
          Number.isFinite(leafStart) &&
          Number.isFinite(leafEnd)
        ) {
          return Math.max(leafStart, Math.min(leafStart + lineOffset, leafEnd))
        }

        let offset = 0

        for (const candidate of Array.from(
          textHost.querySelectorAll<HTMLElement>(
            '[data-slate-string], [data-slate-zero-width]'
          )
        )) {
          const length = candidate.hasAttribute('data-slate-zero-width')
            ? 0
            : (candidate.textContent?.length ?? 0)

          if (candidate === string) {
            return offset + lineOffset
          }

          offset += length
        }

        return null
      }
      const viewport = element.ownerDocument.querySelector<HTMLElement>(
        '[data-testid="pagination-viewport"]'
      )
      const viewportRect = viewport?.getBoundingClientRect()

      if (!viewportRect) {
        return null
      }

      for (const block of Array.from(
        element.querySelectorAll<HTMLElement>(
          '[data-slate-node="element"][data-slate-path]'
        )
      )) {
        const blockPath = block.getAttribute('data-slate-path')

        if (!blockPath || blockPath.includes(',')) {
          continue
        }

        const textHost = block.querySelector<HTMLElement>(
          '[data-slate-node="text"]'
        )
        const page = Array.from(
          element.ownerDocument.querySelectorAll<HTMLElement>(
            '[data-slate-page]'
          )
        ).find((candidate) => {
          const rect = candidate.getBoundingClientRect()
          const blockRect = block.getBoundingClientRect()

          return blockRect.top < rect.bottom && blockRect.bottom > rect.top
        })
        if (!textHost || !page) {
          continue
        }

        const frame = page.querySelector<HTMLElement>(
          '[data-testid="pagination-content-frame"]'
        )
        const rectEntries = Array.from(
          textHost.querySelectorAll<HTMLElement>('[data-slate-string]')
        ).flatMap((string) =>
          Array.from(string.getClientRects())
            .filter(
              (rect) =>
                rect.width > 0 &&
                rect.height > 0 &&
                rect.bottom > viewportRect.top + 10 &&
                rect.top < viewportRect.bottom - 10
            )
            .map((rect) => ({ rect, string }))
        )

        if (rectEntries.length < 3) {
          continue
        }

        const lineGroups: { rect: DOMRect; string: HTMLElement }[][] = []

        for (const entry of rectEntries.sort(
          (left, right) => left.rect.top - right.rect.top
        )) {
          const group = lineGroups.find(
            (candidate) => Math.abs(candidate[0]!.rect.top - entry.rect.top) < 2
          )

          if (group) {
            group.push(entry)
          } else {
            lineGroups.push([entry])
          }
        }

        if (lineGroups.length < 3) {
          continue
        }

        const pageRect = page.getBoundingClientRect()
        const frameRect = frame?.getBoundingClientRect()
        const targets = lineGroups
          .slice(1, Math.min(lineGroups.length, 6))
          .flatMap((group, lineIndex) => {
            const sortedGroup = group.sort(
              (left, right) => left.rect.left - right.rect.left
            )
            const entry =
              edge === 'start' ? sortedGroup[0]! : sortedGroup.at(-1)!
            const textNode = Array.from(entry.string.childNodes).find(
              (node) => node.nodeType === Node.TEXT_NODE
            )

            if (!textNode) {
              return []
            }

            const expectedOffset = getStringDocumentOffset(
              textHost,
              entry.string,
              getLineEdgeOffset(textNode, entry.rect, edge)
            )
            const expectedDOMOffset = getLineEdgeOffset(
              textNode,
              entry.rect,
              edge
            )

            if (expectedOffset === null || !Number.isFinite(expectedOffset)) {
              return []
            }

            const x =
              edge === 'start'
                ? Math.max(
                    pageRect.left + 4,
                    frameRect
                      ? Math.max(
                          (pageRect.left + frameRect.left) / 2,
                          entry.rect.left - 52
                        )
                      : entry.rect.left - 52
                  )
                : Math.min(
                    pageRect.right - 4,
                    frameRect
                      ? Math.min(
                          (frameRect.right + pageRect.right) / 2,
                          entry.rect.right + 52
                        )
                      : entry.rect.right + 52
                  )

            return [
              {
                blockPath,
                expectedDOMOffset,
                expectedDOMText: entry.string.textContent ?? '',
                expectedOffset,
                lineIndex: lineIndex + 1,
                lineText: entry.string.textContent ?? '',
                x,
                y: (entry.rect.top + entry.rect.bottom) / 2,
              },
            ]
          })

        if (targets.length > 0) {
          return targets
        }
      }

      return []
    },
    side === 'left' ? 'start' : 'end'
  )

const getVisiblePaginationRightLineMarginTarget = async (
  root: Awaited<ReturnType<typeof openExample>>['root']
) =>
  root.evaluate((element: HTMLElement) => {
    const getLineEndOffset = (textNode: ChildNode, lineRect: DOMRect) => {
      const textLength = textNode.textContent?.length ?? 0
      const y = lineRect.top + lineRect.height / 2
      const range = element.ownerDocument.createRange()
      let best: { distance: number; offset: number } | null = null

      for (let offset = 0; offset < textLength; offset++) {
        range.setStart(textNode, offset)
        range.setEnd(textNode, offset + 1)

        for (const rect of Array.from(range.getClientRects())) {
          const verticalDistance =
            y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0
          const horizontalDistance = Math.abs(rect.right - lineRect.right)
          const distance = verticalDistance * 1000 + horizontalDistance

          if (!best || distance < best.distance) {
            best = { distance, offset: offset + 1 }
          }
        }
      }

      return best?.offset ?? null
    }
    const viewport = element.ownerDocument.querySelector<HTMLElement>(
      '[data-testid="pagination-viewport"]'
    )
    const viewportRect = viewport?.getBoundingClientRect()

    if (!viewportRect) {
      return null
    }

    for (const block of Array.from(
      element.querySelectorAll<HTMLElement>('[data-slate-path]')
    )) {
      const path = block.getAttribute('data-slate-path')

      if (!path || path.includes(',')) {
        continue
      }

      const strings = Array.from(
        block.querySelectorAll<HTMLElement>('[data-slate-string]')
      )
      const blockRect = block.getBoundingClientRect()
      const rootRect = element.getBoundingClientRect()

      for (const string of strings) {
        const textNode = Array.from(string.childNodes).find(
          (node) => node.nodeType === Node.TEXT_NODE
        )
        const rects = Array.from(string.getClientRects()).filter(
          (rect) => rect.width > 0 && rect.height > 0
        )

        if (!textNode || rects.length === 0) {
          continue
        }

        const rect = rects[0]!
        const lineOffset = getLineEndOffset(textNode, rect)
        const leaf = string.closest<HTMLElement>('[data-slate-leaf]')
        const leafStartAttribute = leaf?.getAttribute('data-slate-leaf-start')
        const leafEndAttribute = leaf?.getAttribute('data-slate-leaf-end')
        const leafStart =
          leafStartAttribute == null
            ? 0
            : Number.parseInt(leafStartAttribute, 10)
        const leafEnd =
          leafEndAttribute == null
            ? null
            : Number.parseInt(leafEndAttribute, 10)
        const blockText = block.textContent ?? ''
        const expectedOffset =
          leafEnd !== null && Number.isFinite(leafEnd)
            ? leafEnd
            : lineOffset == null || !Number.isFinite(leafStart)
              ? null
              : leafStart + lineOffset
        const x = Math.min(rootRect.right - 12, rect.right + 60)

        if (
          expectedOffset == null ||
          expectedOffset >= blockText.length ||
          rect.bottom <= viewportRect.top + 10 ||
          rect.top >= viewportRect.bottom - 10 ||
          x <= rect.right + 8 ||
          x <= blockRect.left ||
          x >= rootRect.right
        ) {
          continue
        }

        return {
          blockPath: path,
          blockText,
          expectedOffset,
          x,
          y: (rect.top + rect.bottom) / 2,
        }
      }
    }

    return null
  })

const getVisiblePaginationTableRowMarginTargets = async (
  root: Awaited<ReturnType<typeof openExample>>['root'],
  rowIndex: number
) =>
  root.evaluate(async (element: HTMLElement, index) => {
    const row = element.ownerDocument.querySelector<HTMLElement>(
      `[data-testid="pagination-rich-table-row"][data-pagination-row-index="${index}"]`
    )
    const viewport = element.ownerDocument.querySelector<HTMLElement>(
      '[data-testid="pagination-viewport"]'
    )

    if (!row || !viewport) {
      return null
    }

    row.scrollIntoView({ block: 'center' })
    await new Promise(requestAnimationFrame)

    const rowRect = row.getBoundingClientRect()
    const page = Array.from(
      element.ownerDocument.querySelectorAll<HTMLElement>(
        '[data-slate-page-index]'
      )
    ).find((candidate) => {
      const rect = candidate.getBoundingClientRect()

      return rowRect.top < rect.bottom && rowRect.bottom > rect.top
    })

    if (!page) {
      return null
    }

    const pageIndex = page.getAttribute('data-slate-page-index')
    const frame =
      pageIndex == null
        ? null
        : element.ownerDocument.querySelector<HTMLElement>(
            `[data-slate-page-index="${pageIndex}"] [data-testid="pagination-content-frame"]`
          )
    const cells = Array.from(
      row.querySelectorAll<HTMLElement>(
        '[data-testid="pagination-rich-table-cell"]'
      )
    )
    const firstTextHost = cells[0]?.querySelector<HTMLElement>(
      '[data-slate-node="text"]'
    )
    const lastTextHost = cells
      .at(-1)
      ?.querySelector<HTMLElement>('[data-slate-node="text"]')

    if (!frame || !firstTextHost || !lastTextHost) {
      return null
    }

    const pageRect = page.getBoundingClientRect()
    const frameRect = frame.getBoundingClientRect()
    const y = (rowRect.top + rowRect.bottom) / 2
    const leftPath = firstTextHost.getAttribute('data-slate-path')
    const rightPath = lastTextHost.getAttribute('data-slate-path')
    const rightText = lastTextHost.textContent ?? ''

    if (!leftPath || !rightPath) {
      return null
    }

    return {
      left: {
        expectedOffset: 0,
        expectedPath: leftPath.split(',').map(Number),
        x: (pageRect.left + frameRect.left) / 2,
        y,
      },
      right: {
        expectedOffset: rightText.length,
        expectedPath: rightPath.split(',').map(Number),
        x: (frameRect.right + pageRect.right) / 2,
        y,
      },
    }
  }, rowIndex)

const getFirstPageMarginClickMatrix = async (
  root: Awaited<ReturnType<typeof openExample>>['root']
) =>
  root.evaluate((element: HTMLElement) => {
    const pageElement = element.ownerDocument.querySelector<HTMLElement>(
      '[data-slate-page-index="0"]'
    )
    const frameElement = element.ownerDocument.querySelector<HTMLElement>(
      '[data-slate-page-index="0"] [data-testid="pagination-content-frame"]'
    )
    const viewport = element.ownerDocument.querySelector<HTMLElement>(
      '[data-testid="pagination-viewport"]'
    )
    const table = element.ownerDocument.querySelector<HTMLElement>(
      '[data-testid="pagination-rich-table"]'
    )
    const tablePathText = table?.getAttribute('data-slate-path')
    const tableTopLevelPath = tablePathText
      ? Number(tablePathText.split(',')[0])
      : null

    if (
      !pageElement ||
      !frameElement ||
      !viewport ||
      tableTopLevelPath == null ||
      !Number.isFinite(tableTopLevelPath)
    ) {
      return null
    }

    const pageRect = pageElement.getBoundingClientRect()
    const frameRect = frameElement.getBoundingClientRect()
    const midpoint = (start: number, end: number) => (start + end) / 2
    const insidePage = (point: { x: number; y: number }) =>
      point.x > pageRect.left + 2 &&
      point.x < pageRect.right - 2 &&
      point.y > pageRect.top + 2 &&
      point.y < pageRect.bottom - 2
    const outsideContent = (point: { x: number; y: number }) =>
      point.x < frameRect.left ||
      point.x > frameRect.right ||
      point.y < frameRect.top ||
      point.y > frameRect.bottom

    const firstPageTopLevelPaths = Array.from(
      element.querySelectorAll<HTMLElement>(
        '[data-slate-node="element"][data-slate-path]'
      )
    )
      .flatMap((node) => {
        const path = node.getAttribute('data-slate-path')

        if (!path || path.includes(',')) {
          return []
        }

        const rect = node.getBoundingClientRect()
        const intersectsPage =
          rect.width > 0 &&
          rect.height > 0 &&
          rect.right > pageRect.left &&
          rect.left < pageRect.right &&
          rect.bottom > pageRect.top &&
          rect.top < pageRect.bottom

        return intersectsPage ? [Number(path)] : []
      })
      .filter((path) => Number.isFinite(path) && path < tableTopLevelPath)

    const targetCandidates = [
      {
        name: 'top-left-corner',
        x: midpoint(pageRect.left, frameRect.left),
        y: midpoint(pageRect.top, frameRect.top),
      },
      {
        name: 'top-center',
        x: midpoint(frameRect.left, frameRect.right),
        y: midpoint(pageRect.top, frameRect.top),
      },
      {
        name: 'top-right-corner',
        x: midpoint(frameRect.right, pageRect.right),
        y: midpoint(pageRect.top, frameRect.top),
      },
      {
        name: 'left-upper-side',
        x: midpoint(pageRect.left, frameRect.left),
        y: frameRect.top + frameRect.height * 0.25,
      },
      {
        name: 'left-middle-side',
        x: midpoint(pageRect.left, frameRect.left),
        y: midpoint(frameRect.top, frameRect.bottom),
      },
      {
        name: 'left-lower-side',
        x: midpoint(pageRect.left, frameRect.left),
        y: frameRect.top + frameRect.height * 0.75,
      },
      {
        name: 'right-upper-side',
        x: midpoint(frameRect.right, pageRect.right),
        y: frameRect.top + frameRect.height * 0.25,
      },
      {
        name: 'right-middle-side',
        x: midpoint(frameRect.right, pageRect.right),
        y: midpoint(frameRect.top, frameRect.bottom),
      },
      {
        name: 'right-lower-side',
        x: midpoint(frameRect.right, pageRect.right),
        y: frameRect.top + frameRect.height * 0.75,
      },
      {
        name: 'bottom-left-corner',
        x: midpoint(pageRect.left, frameRect.left),
        y: midpoint(frameRect.bottom, pageRect.bottom),
      },
      {
        name: 'bottom-center',
        x: midpoint(frameRect.left, frameRect.right),
        y: midpoint(frameRect.bottom, pageRect.bottom),
      },
      {
        name: 'bottom-right-corner',
        x: midpoint(frameRect.right, pageRect.right),
        y: midpoint(frameRect.bottom, pageRect.bottom),
      },
    ]
    const targets = targetCandidates.filter(
      (target) => insidePage(target) && outsideContent(target)
    )

    return {
      firstPageTopLevelPaths: [...new Set(firstPageTopLevelPaths)].sort(
        (left, right) => left - right
      ),
      initialScrollTop: viewport.scrollTop,
      tableTopLevelPath,
      targets,
    }
  })

const getVisiblePaginationTablePageCornerMatrix = async (
  root: Awaited<ReturnType<typeof openExample>>['root'],
  rowIndex: number
) =>
  root.evaluate(async (element: HTMLElement, index) => {
    const row = element.ownerDocument.querySelector<HTMLElement>(
      `[data-testid="pagination-rich-table-row"][data-pagination-row-index="${index}"]`
    )
    const viewport = element.ownerDocument.querySelector<HTMLElement>(
      '[data-testid="pagination-viewport"]'
    )
    const table = element.ownerDocument.querySelector<HTMLElement>(
      '[data-testid="pagination-rich-table"]'
    )
    const tablePathText = table?.getAttribute('data-slate-path')
    const tableTopLevelPath = tablePathText
      ? Number(tablePathText.split(',')[0])
      : null

    if (
      !row ||
      !viewport ||
      tableTopLevelPath == null ||
      !Number.isFinite(tableTopLevelPath)
    ) {
      return null
    }

    row.scrollIntoView({ block: 'center' })
    await new Promise(requestAnimationFrame)

    const rowRect = row.getBoundingClientRect()
    const page = Array.from(
      element.ownerDocument.querySelectorAll<HTMLElement>(
        '[data-slate-page-index]'
      )
    ).find((candidate) => {
      const rect = candidate.getBoundingClientRect()

      return rowRect.top < rect.bottom && rowRect.bottom > rect.top
    })

    if (!page) {
      return null
    }

    const pageIndex = page.getAttribute('data-slate-page-index')
    const frame =
      pageIndex == null
        ? null
        : element.ownerDocument.querySelector<HTMLElement>(
            `[data-slate-page-index="${pageIndex}"] [data-testid="pagination-content-frame"]`
          )

    if (!frame) {
      return null
    }

    const pageRect = page.getBoundingClientRect()
    const frameRect = frame.getBoundingClientRect()
    const midpoint = (start: number, end: number) => (start + end) / 2

    return {
      initialScrollTop: viewport.scrollTop,
      tableTopLevelPath,
      targets: [
        {
          name: 'visible-table-page-top-left-corner',
          x: midpoint(pageRect.left, frameRect.left),
          y: midpoint(pageRect.top, frameRect.top),
        },
        {
          name: 'visible-table-page-top-right-corner',
          x: midpoint(frameRect.right, pageRect.right),
          y: midpoint(pageRect.top, frameRect.top),
        },
        {
          name: 'visible-table-page-bottom-left-corner',
          x: midpoint(pageRect.left, frameRect.left),
          y: midpoint(frameRect.bottom, pageRect.bottom),
        },
        {
          name: 'visible-table-page-bottom-right-corner',
          x: midpoint(frameRect.right, pageRect.right),
          y: midpoint(frameRect.bottom, pageRect.bottom),
        },
      ],
    }
  }, rowIndex)

const getDOMSelectionTextPath = async (
  root: Awaited<ReturnType<typeof openExample>>['root']
) =>
  root.evaluate(() => {
    const selection = document.getSelection()
    const anchorNode = selection?.anchorNode ?? null
    const anchorElement =
      anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement
    const textHost = anchorElement?.closest('[data-slate-node="text"]')

    return textHost?.getAttribute('data-slate-path') ?? null
  })

const getProjectedPaginationTextProof = async (
  root: Awaited<ReturnType<typeof openExample>>['root'],
  blockPath: string
) =>
  root.evaluate((element: HTMLElement, path) => {
    const viewport = element.ownerDocument.querySelector<HTMLElement>(
      '[data-testid="pagination-viewport"]'
    )
    const viewportRect = viewport?.getBoundingClientRect()
    const block = element.querySelector<HTMLElement>(
      `[data-slate-node="element"][data-slate-path="${path}"]`
    )
    const textHost = element.querySelector<HTMLElement>(
      `[data-slate-node="text"][data-slate-path="${path},0"]`
    )
    const visibleLeaves = Array.from(
      block?.querySelectorAll<HTMLElement>('[data-slate-leaf]') ?? []
    )
      .map((leaf) => {
        const rect = leaf.getBoundingClientRect()

        return {
          bottom: rect.bottom,
          left: rect.left,
          position: getComputedStyle(leaf).position,
          right: rect.right,
          text: leaf.textContent?.replace(/\s+/g, ' ').trim() ?? '',
          top: rect.top,
          width: rect.width,
        }
      })
      .filter(
        (leaf) =>
          viewportRect &&
          leaf.text.length > 0 &&
          leaf.width > 0 &&
          leaf.bottom > viewportRect.top + 32 &&
          leaf.top < viewportRect.bottom - 32 &&
          leaf.right > viewportRect.left &&
          leaf.left < viewportRect.right
      )
    const firstVisibleLeaf = visibleLeaves[0]

    return {
      absoluteLeafCount: visibleLeaves.filter(
        (leaf) => leaf.position === 'absolute'
      ).length,
      blockText: block?.textContent ?? null,
      domSync: textHost?.getAttribute('data-slate-dom-sync') ?? null,
      firstVisibleLeafLeft: firstVisibleLeaf?.left ?? null,
      firstVisibleLeafTop: firstVisibleLeaf?.top ?? null,
      pageSurfaceCount: element.ownerDocument.querySelectorAll(
        '[data-slate-page-surface]'
      ).length,
      reason: textHost?.getAttribute('data-slate-dom-sync-reason') ?? null,
      staticLeafCount: visibleLeaves.filter(
        (leaf) => leaf.position === 'static'
      ).length,
      totalElementCount: element.ownerDocument.querySelectorAll('*').length,
      visibleLeafCount: visibleLeaves.length,
    } satisfies PaginationProjectedTextProof
  }, blockPath)

const getPaginationFastScrollSample = async (
  root: Awaited<ReturnType<typeof openExample>>['root'],
  eventStart: number
) =>
  root.evaluate((element: HTMLElement, startedAt) => {
    const viewport = element.ownerDocument.querySelector<HTMLElement>(
      '[data-testid="pagination-viewport"]'
    )
    const viewportRect = viewport?.getBoundingClientRect()
    const contentCandidates = Array.from(
      element.ownerDocument.querySelectorAll<HTMLElement>(
        '[data-slate-node="element"], [data-testid="pagination-rich-table-row"]'
      )
    )
    const getText = (node: HTMLElement) =>
      (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim()
    const visibleContent = contentCandidates
      .map((node) => ({
        rect: node.getBoundingClientRect(),
        text: getText(node),
      }))
      .filter(({ rect, text }) => {
        if (!viewportRect || text.length === 0) {
          return false
        }

        return (
          rect.height > 0 &&
          rect.width > 0 &&
          rect.bottom > viewportRect.top + 24 &&
          rect.top < viewportRect.bottom - 24 &&
          rect.right > viewportRect.left &&
          rect.left < viewportRect.right
        )
      })
    const hitVisibleContent = new Set<HTMLElement>()

    if (viewportRect) {
      for (const xRatio of [0.25, 0.5, 0.75]) {
        for (const yRatio of [0.2, 0.35, 0.5, 0.65, 0.8]) {
          const x = viewportRect.left + viewportRect.width * xRatio
          const y = viewportRect.top + viewportRect.height * yRatio
          const hit = element.ownerDocument
            .elementsFromPoint(x, y)
            .map((candidate) =>
              candidate.closest<HTMLElement>(
                '[data-slate-node="element"], [data-testid="pagination-rich-table-row"]'
              )
            )
            .find((candidate): candidate is HTMLElement =>
              Boolean(candidate && getText(candidate).length > 0)
            )

          if (hit) {
            hitVisibleContent.add(hit)
          }
        }
      }
    }
    const rows = Array.from(
      element.ownerDocument.querySelectorAll<HTMLElement>(
        '[data-testid="pagination-rich-table-row"]'
      )
    )
    const rowIndexes = rows
      .map((row) => Number(row.getAttribute('data-pagination-row-index')))
      .filter(Number.isFinite)
      .sort((left, right) => left - right)
    const visibleText = visibleContent
      .map((content) => content.text)
      .concat([...hitVisibleContent].map(getText))
      .join(' ')
      .slice(0, 500)

    return {
      eventToPaintMs: performance.now() - startedAt,
      firstRowIndex: rowIndexes[0] ?? null,
      hitVisibleContentCount: hitVisibleContent.size,
      lastRowIndex: rowIndexes.at(-1) ?? null,
      mountedCellCount: element.ownerDocument.querySelectorAll(
        '[data-testid="pagination-rich-table-cell"]'
      ).length,
      mountedRowCount: rows.length,
      pageSurfaceCount: element.ownerDocument.querySelectorAll(
        '[data-slate-page-surface]'
      ).length,
      totalElementCount: element.ownerDocument.querySelectorAll('*').length,
      visibleText,
    } satisfies PaginationFastScrollSample
  }, eventStart)

const getPaginationMiddleTypingSample = async (
  root: Awaited<ReturnType<typeof openExample>>['root'],
  {
    eventStart,
    expectedText,
    path,
  }: {
    eventStart: number
    expectedText: string
    path: number
  }
) =>
  root.evaluate(
    (
      element: HTMLElement,
      payload: {
        eventStart: number
        expectedText: string
        path: number
      }
    ) => {
      const block = element.ownerDocument.querySelector<HTMLElement>(
        `[data-slate-path="${payload.path}"]`
      )
      const viewport = element.ownerDocument.querySelector<HTMLElement>(
        '[data-testid="pagination-viewport"]'
      )
      const hasExpectedText =
        block?.textContent?.includes(payload.expectedText) ?? false
      const blockRect = hasExpectedText ? block?.getBoundingClientRect() : null
      const viewportRect = hasExpectedText
        ? viewport?.getBoundingClientRect()
        : null
      const metaText =
        element.ownerDocument.querySelector('.slate-pagination-meta')
          ?.textContent ?? ''

      return {
        blockVisible: Boolean(
          blockRect &&
            viewportRect &&
            blockRect.bottom > viewportRect.top + 24 &&
            blockRect.top < viewportRect.bottom - 24
        ),
        blockText: block?.textContent?.slice(0, 160) ?? null,
        composeMs: Number(metaText.match(/compose ([\d.]+)ms/)?.[1] ?? 0),
        eventToPaintMs: performance.now() - payload.eventStart,
        hasExpectedText,
        pageSurfaceCount: element.ownerDocument.querySelectorAll(
          '[data-slate-page-surface]'
        ).length,
        totalElementCount: element.ownerDocument.querySelectorAll('*').length,
      } satisfies PaginationMiddleTypingSample
    },
    { eventStart, expectedText, path }
  )

const armPaginationMiddleTypingProbe = async (
  root: Awaited<ReturnType<typeof openExample>>['root'],
  {
    expectedText,
    path,
    timeoutMs = 5000,
  }: {
    expectedText: string
    path: number
    timeoutMs?: number
  }
) =>
  root.evaluate(
    (
      _element: HTMLElement,
      payload: {
        expectedText: string
        path: number
        timeoutMs: number
      }
    ) => {
      const startedAt = performance.now()
      let inputStartedAt = startedAt
      let sampleCount = 0
      let textObservedAt: number | null = null
      const global = window as typeof window & {
        __paginationMiddleTypingProfilerEvents?: {
          duration?: number
          id?: string | null
          kind?: string
        }[]
        __paginationMiddleTypingProbe?: Promise<PaginationMiddleTypingSample>
        __SLATE_REACT_RENDER_PROFILER__?: {
          record: (event: {
            duration?: number
            id?: string | null
            kind?: string
          }) => void
        }
      }
      const profilerEvents: NonNullable<
        typeof global.__paginationMiddleTypingProfilerEvents
      > = []

      global.__paginationMiddleTypingProfilerEvents = profilerEvents
      global.__SLATE_REACT_RENDER_PROFILER__ = {
        record(event) {
          profilerEvents.push({ ...event })
        },
      }
      document.addEventListener(
        'beforeinput',
        () => {
          inputStartedAt = performance.now()
          profilerEvents.length = 0
        },
        { capture: true, once: true }
      )
      const observedBlock = document.querySelector<HTMLElement>(
        `[data-slate-path="${payload.path}"]`
      )
      const observer = observedBlock
        ? new MutationObserver(() => {
            if (
              textObservedAt === null &&
              observedBlock.textContent?.includes(payload.expectedText)
            ) {
              textObservedAt = performance.now()
            }
          })
        : null

      observer?.observe(observedBlock!, {
        characterData: true,
        childList: true,
        subtree: true,
      })

      global.__paginationMiddleTypingProbe = new Promise((resolve, reject) => {
        const deadline = startedAt + payload.timeoutMs
        const getSample = (
          frameObservedAt = performance.now()
        ): PaginationMiddleTypingSample => {
          const block = document.querySelector<HTMLElement>(
            `[data-slate-path="${payload.path}"]`
          )
          const viewport = document.querySelector<HTMLElement>(
            '[data-testid="pagination-viewport"]'
          )
          const hasExpectedText =
            block?.textContent?.includes(payload.expectedText) ?? false
          const blockRect = hasExpectedText
            ? block?.getBoundingClientRect()
            : null
          const viewportRect = hasExpectedText
            ? viewport?.getBoundingClientRect()
            : null
          const metaText =
            document.querySelector('.slate-pagination-meta')?.textContent ?? ''
          const byKind: Record<string, number> = {}
          const byKey: Record<string, number> = {}
          const durationsById: Record<string, number> = {}

          for (const event of profilerEvents) {
            if (event.kind) {
              byKind[event.kind] = (byKind[event.kind] ?? 0) + 1
              const key = event.id ? `${event.kind}:${event.id}` : event.kind
              byKey[key] = (byKey[key] ?? 0) + 1
            }

            if (event.duration !== undefined && event.id) {
              durationsById[event.id] =
                (durationsById[event.id] ?? 0) + event.duration
            }
          }

          return {
            blockVisible: Boolean(
              blockRect &&
                viewportRect &&
                blockRect.bottom > viewportRect.top + 24 &&
                blockRect.top < viewportRect.bottom - 24
            ),
            blockText: block?.textContent?.slice(0, 160) ?? null,
            composeMs: Number(metaText.match(/compose ([\d.]+)ms/)?.[1] ?? 0),
            eventToPaintMs: frameObservedAt - inputStartedAt,
            hasExpectedText,
            pageSurfaceCount: document.querySelectorAll(
              '[data-slate-page-surface]'
            ).length,
            profiler: {
              byKind,
              byKey,
              durationsById,
              total: profilerEvents.length,
            },
            sampleCount,
            textObservedMs:
              textObservedAt === null ? null : textObservedAt - inputStartedAt,
            totalElementCount: document.querySelectorAll('*').length,
          }
        }

        const tick = () => {
          sampleCount += 1
          const sample = getSample(performance.now())

          if (sample.blockVisible && sample.hasExpectedText) {
            observer?.disconnect()
            resolve(sample)
            return
          }

          if (performance.now() > deadline) {
            observer?.disconnect()
            reject(
              new Error(
                `Timed out waiting for pagination typing paint: ${JSON.stringify(
                  sample
                )}`
              )
            )
            return
          }

          requestAnimationFrame(tick)
        }

        requestAnimationFrame(tick)
      })
    },
    { expectedText, path, timeoutMs }
  )

const readPaginationMiddleTypingProbe = async (
  root: Awaited<ReturnType<typeof openExample>>['root']
) =>
  root.evaluate(() => {
    const global = window as typeof window & {
      __paginationMiddleTypingProbe?: Promise<PaginationMiddleTypingSample>
    }

    if (!global.__paginationMiddleTypingProbe) {
      throw new Error('Pagination middle typing probe was not armed')
    }

    return global.__paginationMiddleTypingProbe
  })

const getPercentile = (values: number[], percentile: number) => {
  if (values.length === 0) {
    return 0
  }

  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * percentile) - 1)
  )

  return sorted[index] ?? 0
}

test.describe('pagination example', () => {
  test('renders the existing pagination route as the canonical paged editable surface', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only smoke proof for canonical pagination route'
    )

    const editor = await openExample(page, 'pagination', {
      ready: {
        editor: 'visible',
        text: /Premirror Milestone 1 test document/,
      },
    })

    const proof = await editor.root.evaluate(() => {
      return {
        hasDOMStrategyControl: Boolean(
          Array.from(document.querySelectorAll('label')).some((label) =>
            label.textContent?.includes('DOM strategy')
          )
        ),
        hasMediaSplitControl: Boolean(
          Array.from(document.querySelectorAll('label')).some((label) =>
            label.textContent?.includes('Media split')
          )
        ),
        hasPagedEditable: Boolean(
          document.querySelector('[data-slate-paged-editable]')
        ),
        hasRowsControl: Boolean(
          Array.from(document.querySelectorAll('label')).some((label) =>
            label.textContent?.includes('Rows')
          )
        ),
        pageSurfaceCount: document.querySelectorAll('[data-slate-page-surface]')
          .length,
        text: document.body.textContent,
      }
    })

    expect(proof.hasPagedEditable).toBe(true)
    expect(proof.hasDOMStrategyControl).toBe(true)
    expect(proof.hasMediaSplitControl).toBe(true)
    expect(proof.hasRowsControl).toBe(true)
    expect(proof.pageSurfaceCount).toBeGreaterThan(1)
    expect(proof.text).toContain('Premirror Milestone 1 test document')
  })

  test('renders a multi-page table as one editable Slate subtree', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for experimental pagination table fragments'
    )

    const editor = await openExample(page, 'pagination', {
      ready: {
        editor: 'visible',
        text: /Rich Markdown pagination proof/,
      },
    })

    await page.getByRole('switch', { name: 'Debug' }).click()

    const proof = await getPaginationTableProof(editor.root)

    expect(proof.tableCount).toBe(1)
    expect(proof.mountedRowCount).toBe(240)
    expect(proof.mountedCellCount).toBe(720)
    expect(proof.visibleRowCount).toBe(240)
    expect(proof.visibleCellCount).toBe(720)
    expect(new Set(proof.rowFrameIndexes).size).toBeGreaterThan(1)
    expect(proof.rowFrameIndexes.every((index) => index >= 0)).toBe(true)
    expect(proof.duplicatePaths).toEqual([])
  })

  test('materializes table rows only for the selected row count', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for pagination table stress controls'
    )

    const editor = await openExample(page, 'pagination', {
      ready: {
        editor: 'visible',
        text: /Rich Markdown pagination proof/,
      },
    })

    await expect
      .poll(async () => getPaginationTableProof(editor.root))
      .toEqual(
        expect.objectContaining({
          mountedCellCount: 720,
          mountedRowCount: 240,
          visibleCellCount: 720,
          visibleRowCount: 240,
        })
      )

    await page.getByLabel('Rows').fill('96')

    await expect
      .poll(async () => getPaginationTableProof(editor.root))
      .toEqual(
        expect.objectContaining({
          mountedCellCount: 288,
          mountedRowCount: 96,
          visibleCellCount: 288,
          visibleRowCount: 96,
        })
      )
  })

  test('edits a visually second-page table cell without splitting the table DOM', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for experimental pagination table editing'
    )

    const editor = await openExample(page, 'pagination', {
      ready: {
        editor: 'visible',
        text: /Rich Markdown pagination proof/,
      },
    })
    const tablePathAttribute = await editor.root
      .locator('[data-testid="pagination-rich-table"]')
      .getAttribute('data-slate-path')

    expect(tablePathAttribute).toBeTruthy()

    const tablePath = Number(tablePathAttribute)
    const targetText = 'Path-aware cell 29'

    await editor.selection.collapse({
      path: [tablePath, 28, 1, 0],
      offset: targetText.length,
    })
    await editor.focus()
    await page.keyboard.insertText(' edited')

    await expect
      .poll(async () => editor.get.modelText())
      .toContain(`${targetText} edited`)

    const proof = await getPaginationTableProof(editor.root)

    expect(proof.tableCount).toBe(1)
    expect(proof.duplicatePaths).toEqual([])
  })

  test('copies a selection across table rows split by a page boundary', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for experimental pagination table copy'
    )

    const editor = await openExample(page, 'pagination', {
      ready: {
        editor: 'visible',
        text: /Rich Markdown pagination proof/,
      },
    })
    const tablePathAttribute = await editor.root
      .locator('[data-testid="pagination-rich-table"]')
      .getAttribute('data-slate-path')

    expect(tablePathAttribute).toBeTruthy()

    const tablePath = Number(tablePathAttribute)

    await editor.selection.select({
      anchor: { path: [tablePath, 24, 0, 0], offset: 0 },
      focus: { path: [tablePath, 25, 2, 0], offset: 'Fragment 26'.length },
    })
    await editor.focus()
    await editor.root.press('ControlOrMeta+C')

    const text = await editor.clipboard.readText()

    expect(text).toContain('Row 25')
    expect(text).toContain('Fragment 26')

    const proof = await getPaginationTableProof(editor.root)

    expect(proof.tableCount).toBe(1)
    expect(proof.duplicatePaths).toEqual([])
  })

  test('does not jump to the table when clicking unfocused first-page margins and corners', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for pagination page-margin hit testing'
    )

    const editor = await openExample(page, 'pagination', {
      query: { debug: 'true' },
      ready: {
        editor: 'visible',
        text: /Rich Markdown pagination proof/,
      },
    })
    const matrix = await getFirstPageMarginClickMatrix(editor.root)

    expect(matrix).toBeTruthy()
    expect(matrix!.targets.length).toBeGreaterThanOrEqual(12)
    expect(matrix!.firstPageTopLevelPaths.length).toBeGreaterThan(0)
    expect(matrix!.firstPageTopLevelPaths).not.toContain(
      matrix!.tableTopLevelPath
    )

    for (const target of matrix!.targets) {
      await editor.selection.collapse({
        path: [0, 0],
        offset: 0,
      })
      await page.getByLabel('Rows').focus()
      await page.mouse.click(target.x, target.y)

      await expect
        .poll(
          async () => {
            const selection = await editor.selection.get()
            const selectedTopLevelPaths = [
              selection?.anchor.path[0],
              selection?.focus.path[0],
            ]
            const scrollTop = await editor.root.evaluate(
              (element: HTMLElement) => {
                const viewport =
                  element.ownerDocument.querySelector<HTMLElement>(
                    '[data-testid="pagination-viewport"]'
                  )

                return viewport?.scrollTop ?? null
              }
            )

            return {
              jumpedToTable: selectedTopLevelPaths.includes(
                matrix!.tableTopLevelPath
              ),
              leftFirstPage: selectedTopLevelPaths.some(
                (path) =>
                  path !== undefined &&
                  !matrix!.firstPageTopLevelPaths.includes(path)
              ),
              scrollJumped:
                scrollTop === null ||
                Math.abs(scrollTop - matrix!.initialScrollTop) > 1,
            }
          },
          { message: target.name }
        )
        .toEqual({
          jumpedToTable: false,
          leftFirstPage: false,
          scrollJumped: false,
        })
    }
  })

  test('does not jump to the table when clicking a fresh single-layout page corner', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for fresh pagination page-corner hit testing'
    )

    const editor = await openExample(page, 'pagination', {
      query: { debug: 'true', page_layout: 'single' },
      ready: {
        editor: 'visible',
        text: /Rich Markdown pagination proof/,
      },
    })
    const matrix = await getFirstPageMarginClickMatrix(editor.root)

    expect(matrix).toBeTruthy()

    const target = matrix!.targets.find(
      (candidate) => candidate.name === 'top-right-corner'
    )

    expect(target).toBeTruthy()
    await expect.poll(async () => editor.selection.get()).toBeNull()

    await page.getByLabel('Rows').focus()
    await page.mouse.click(target!.x, target!.y)

    await expect
      .poll(async () => {
        const selection = await editor.selection.get()
        const selectedTopLevelPaths = [
          selection?.anchor.path[0],
          selection?.focus.path[0],
        ]
        const scrollTop = await editor.root.evaluate((element: HTMLElement) => {
          const viewport = element.ownerDocument.querySelector<HTMLElement>(
            '[data-testid="pagination-viewport"]'
          )

          return viewport?.scrollTop ?? null
        })

        return {
          jumpedToTable: selectedTopLevelPaths.includes(
            matrix!.tableTopLevelPath
          ),
          leftFirstPage: selectedTopLevelPaths.some(
            (path) =>
              path !== undefined &&
              !matrix!.firstPageTopLevelPaths.includes(path)
          ),
          scrollJumped:
            scrollTop === null ||
            Math.abs(scrollTop - matrix!.initialScrollTop) > 1,
        }
      })
      .toEqual({
        jumpedToTable: false,
        leftFirstPage: false,
        scrollJumped: false,
      })
  })

  test('does not jump to the table when clicking a focused single-layout page corner', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for focused pagination page-corner hit testing'
    )

    const editor = await openExample(page, 'pagination', {
      query: { debug: 'true', page_layout: 'single' },
      ready: {
        editor: 'visible',
        text: /Rich Markdown pagination proof/,
      },
    })
    const matrix = await getFirstPageMarginClickMatrix(editor.root)

    expect(matrix).toBeTruthy()

    const target = matrix!.targets.find(
      (candidate) => candidate.name === 'top-right-corner'
    )

    expect(target).toBeTruthy()

    await editor.selection.collapse({
      path: [0, 0],
      offset: 0,
    })
    await editor.focus()
    await page.mouse.click(target!.x, target!.y)

    await expect
      .poll(async () => {
        const selection = await editor.selection.get()
        const selectedTopLevelPaths = [
          selection?.anchor.path[0],
          selection?.focus.path[0],
        ]
        const scrollTop = await editor.root.evaluate((element: HTMLElement) => {
          const viewport = element.ownerDocument.querySelector<HTMLElement>(
            '[data-testid="pagination-viewport"]'
          )

          return viewport?.scrollTop ?? null
        })

        return {
          jumpedToTable: selectedTopLevelPaths.includes(
            matrix!.tableTopLevelPath
          ),
          leftFirstPage: selectedTopLevelPaths.some(
            (path) =>
              path !== undefined &&
              !matrix!.firstPageTopLevelPaths.includes(path)
          ),
          scrollJumped:
            scrollTop === null ||
            Math.abs(scrollTop - matrix!.initialScrollTop) > 1,
        }
      })
      .toEqual({
        jumpedToTable: false,
        leftFirstPage: false,
        scrollJumped: false,
      })
  })

  test('places blurred single-layout table row side-margin clicks on the clicked row', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for blurred pagination margin hit testing'
    )

    const editor = await openExample(page, 'pagination', {
      query: { debug: 'true', page_layout: 'single' },
      ready: {
        editor: 'visible',
        text: /Rich Markdown pagination proof/,
      },
    })
    const targets = await getVisiblePaginationTableRowMarginTargets(
      editor.root,
      238
    )

    expect(targets).toBeTruthy()

    for (const target of [targets!.left, targets!.right]) {
      await page.getByLabel('Rows').focus()
      await page.mouse.click(target.x, target.y)

      await expect
        .poll(async () => editor.selection.get())
        .toEqual({
          anchor: {
            offset: target.expectedOffset,
            path: target.expectedPath,
          },
          focus: {
            offset: target.expectedOffset,
            path: target.expectedPath,
          },
        })
    }
  })

  test('does not jump to the table when clicking current visible page corners', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for current pagination page-corner hit testing'
    )

    const editor = await openExample(page, 'pagination', {
      query: { debug: 'true', page_layout: 'single' },
      ready: {
        editor: 'visible',
        text: /Rich Markdown pagination proof/,
      },
    })
    await editor.selection.collapse({
      path: [0, 0],
      offset: 0,
    })
    const matrix = await getVisiblePaginationTablePageCornerMatrix(
      editor.root,
      238
    )

    expect(matrix).toBeTruthy()

    for (const target of matrix!.targets) {
      await page.getByLabel('Rows').focus()
      await page.mouse.click(target.x, target.y)

      await expect
        .poll(
          async () => {
            const selection = await editor.selection.get()
            const selectedTopLevelPaths = [
              selection?.anchor.path[0],
              selection?.focus.path[0],
            ]
            const scrollTop = await editor.root.evaluate(
              (element: HTMLElement) => {
                const viewport =
                  element.ownerDocument.querySelector<HTMLElement>(
                    '[data-testid="pagination-viewport"]'
                  )

                return viewport?.scrollTop ?? null
              }
            )

            return {
              jumpedToTable: selectedTopLevelPaths.includes(
                matrix!.tableTopLevelPath
              ),
              scrollJumped:
                scrollTop === null ||
                Math.abs(scrollTop - matrix!.initialScrollTop) > 1,
            }
          },
          { message: target.name }
        )
        .toEqual({
          jumpedToTable: false,
          scrollJumped: false,
        })
    }
  })

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

  test('places selection at wrapped line end when clicking the right page margin', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for pagination right-margin hit testing'
    )

    const editor = await openExample(page, 'pagination', {
      ready: {
        editor: 'visible',
        text: /Premirror Milestone 1 test document/,
      },
    })
    const secondBlockText = (await editor.get.blockTexts())[1]!
    const point = await getVisiblePaginationRightLineMarginTarget(editor.root)

    expect(point).toBeTruthy()

    await editor.selection.collapse({
      path: [1, 0],
      offset: Math.min(4, secondBlockText.length),
    })
    await editor.focus()
    await page.mouse.click(point!.x, point!.y)

    await expect
      .poll(async () => editor.selection.get())
      .toEqual({
        anchor: {
          path: [Number(point!.blockPath), 0],
          offset: point!.expectedOffset,
        },
        focus: {
          path: [Number(point!.blockPath), 0],
          offset: point!.expectedOffset,
        },
      })
  })

  test('places selection at wrapped line starts when clicking the left paragraph gutter', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for pagination left-margin hit testing'
    )

    await page.setViewportSize({ height: 814, width: 1994 })

    const editor = await openExample(page, 'pagination', {
      query: { page_layout: 'single' },
      ready: {
        editor: 'visible',
        text: /Rich Markdown pagination proof/,
      },
    })
    const targets = await getVisiblePaginationWrappedLineMarginTargets(
      editor.root,
      'left'
    )

    expect(targets.length).toBeGreaterThanOrEqual(3)

    for (const target of targets) {
      await editor.selection.collapse({
        path: [0, 0],
        offset: 0,
      })
      await editor.focus()
      await page.mouse.click(target.x, target.y)

      await expect
        .poll(async () => ({
          activeIsEditor: await editor.root.evaluate(
            (element) => element.ownerDocument.activeElement === element
          ),
          nativeSelection: await editor.root.evaluate(() => {
            const selection = document.getSelection()

            return {
              anchorOffset: selection?.anchorOffset ?? null,
              anchorText: selection?.anchorNode?.textContent ?? null,
            }
          }),
          selection: await editor.selection.get(),
        }))
        .toEqual({
          activeIsEditor: true,
          nativeSelection: {
            anchorOffset: target.expectedDOMOffset,
            anchorText: target.expectedDOMText,
          },
          selection: {
            anchor: {
              path: [Number(target.blockPath), 0],
              offset: target.expectedOffset,
            },
            focus: {
              path: [Number(target.blockPath), 0],
              offset: target.expectedOffset,
            },
          },
        })
    }
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

  test('keeps projected block offsets when page-level virtualization is active', async ({
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
    await page.getByLabel('Page overscan').fill('0')

    await expect
      .poll(async () =>
        editor.root.evaluate(() => {
          const rowCount = document.querySelectorAll(
            '[data-slate-dom-strategy-virtual-row="true"]'
          ).length
          const boundaryCount = document.querySelectorAll(
            '[data-slate-dom-strategy-virtualized-boundary="true"]'
          ).length

          return (
            document.querySelector(
              '[data-slate-dom-strategy-virtualizer="true"]'
            ) != null &&
            rowCount > 0 &&
            boundaryCount > 0
          )
        })
      )
      .toBe(true)

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

  test('loads the direct virtualized pagination route without replaying the stress fixture', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for pagination virtualized startup latency'
    )

    await page.setViewportSize({ height: 900, width: 720 })

    const editor = await openExample(page, 'pagination', {
      query: { strategy: 'virtualized' },
      ready: {
        editor: 'visible',
      },
    })
    const proof = await getPaginationVirtualizedTableProof(editor.root)
    const startup = await editor.root.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined
      const metaText =
        document.querySelector('.slate-pagination-meta')?.textContent ?? ''

      return {
        appAfterDOMContentLoadedMs: nav
          ? performance.now() - nav.domContentLoadedEventEnd
          : performance.now(),
        composeMs: Number(metaText.match(/compose ([\d.]+)ms/)?.[1] ?? 0),
        domContentLoadedMs: nav?.domContentLoadedEventEnd ?? null,
        totalMs: performance.now(),
      }
    })

    await testInfo.attach('pagination-virtualized-startup', {
      body: JSON.stringify({ proof, startup }, null, 2),
      contentType: 'application/json',
    })

    expect(proof.pageVirtualizationEnabled).toBe(true)
    expect(proof.stressPageCount).toBeGreaterThanOrEqual(900)
    expect(proof.pageTotal).toBeGreaterThanOrEqual(950)
    expect(proof.pageTotal).toBeLessThanOrEqual(1150)
    expect(proof.totalElementCount).toBeLessThan(1000)
    expect(proof.pageSurfaceCount).toBeLessThanOrEqual(8)
    expect(startup.appAfterDOMContentLoadedMs).toBeLessThanOrEqual(5000)
  })

  test('switches from staged to virtualized without replaying stress nodes one by one', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for pagination virtualized dropdown latency'
    )

    await page.setViewportSize({ height: 900, width: 720 })

    const editor = await openExample(page, 'pagination', {
      ready: {
        editor: 'visible',
      },
    })
    const before = await getPaginationVirtualizedTableProof(editor.root)

    expect(before.stressPageCount).toBe(0)
    expect(before.pageVirtualizationEnabled).toBe(false)

    const startedAt = Date.now()

    await page.getByLabel('DOM strategy').selectOption('virtualized')

    const selectReturnedMs = Date.now() - startedAt
    let proof = await getPaginationVirtualizedTableProof(editor.root)

    await expect
      .poll(async () => {
        proof = await getPaginationVirtualizedTableProof(editor.root)

        return {
          boundedDOM: proof.totalElementCount < 1000,
          boundedPages: proof.pageSurfaceCount <= 8,
          pageTotalInRange: proof.pageTotal >= 950 && proof.pageTotal <= 1150,
          stressPagesConfigured: proof.stressPageCount >= 900,
          virtualized: proof.pageVirtualizationEnabled,
        }
      })
      .toEqual({
        boundedDOM: true,
        boundedPages: true,
        pageTotalInRange: true,
        stressPagesConfigured: true,
        virtualized: true,
      })

    const readyMs = Date.now() - startedAt

    await testInfo.attach('pagination-virtualized-dropdown-startup', {
      body: JSON.stringify(
        { before, proof, readyMs, selectReturnedMs },
        null,
        2
      ),
      contentType: 'application/json',
    })

    expect(selectReturnedMs).toBeLessThanOrEqual(5000)
    expect(readyMs).toBeLessThanOrEqual(5000)
  })

  test('moves the cursor between the first two virtualized pagination blocks on click', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for virtualized pagination hit testing'
    )

    await page.setViewportSize({ height: 637, width: 1533 })

    const editor = await openExample(page, 'pagination', {
      query: { strategy: 'virtualized' },
      ready: {
        editor: 'visible',
      },
    })

    await expect
      .poll(async () => {
        const proof = await getPaginationVirtualizedTableProof(editor.root)

        return {
          boundedDOM: proof.totalElementCount < 1400,
          boundedPages: proof.pageSurfaceCount <= 8,
          virtualized: proof.pageVirtualizationEnabled,
        }
      })
      .toEqual({
        boundedDOM: true,
        boundedPages: true,
        virtualized: true,
      })

    const firstTarget = await getVisiblePaginationTextTargetByPath(
      editor.root,
      '0'
    )
    const secondTarget = await getVisiblePaginationTextTargetByPath(
      editor.root,
      '1'
    )

    expect(firstTarget).toBeTruthy()
    expect(secondTarget).toBeTruthy()

    await page.mouse.click(firstTarget!.x, firstTarget!.y)
    await expect
      .poll(async () => ({
        domPath: await getDOMSelectionTextPath(editor.root),
        selection: await editor.selection.get(),
      }))
      .toEqual({
        domPath: '0,0',
        selection: expect.objectContaining({
          anchor: expect.objectContaining({ path: [0, 0] }),
          focus: expect.objectContaining({ path: [0, 0] }),
        }),
      })

    await page.mouse.click(secondTarget!.x, secondTarget!.y)
    await expect
      .poll(async () => ({
        domPath: await getDOMSelectionTextPath(editor.root),
        selection: await editor.selection.get(),
      }))
      .toEqual({
        domPath: '1,0',
        selection: expect.objectContaining({
          anchor: expect.objectContaining({ path: [1, 0] }),
          focus: expect.objectContaining({ path: [1, 0] }),
        }),
      })
  })

  test('selects virtualized pagination text when dragging from the page line margin', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for virtualized pagination margin hit testing'
    )

    await page.setViewportSize({ height: 637, width: 1533 })

    const editor = await openExample(page, 'pagination', {
      query: { strategy: 'virtualized' },
      ready: {
        editor: 'visible',
      },
    })

    await expect
      .poll(async () => {
        const proof = await getPaginationVirtualizedTableProof(editor.root)

        return {
          boundedDOM: proof.totalElementCount < 1400,
          boundedPages: proof.pageSurfaceCount <= 8,
          virtualized: proof.pageVirtualizationEnabled,
        }
      })
      .toEqual({
        boundedDOM: true,
        boundedPages: true,
        virtualized: true,
      })

    const startTarget = await getVisiblePaginationLineMarginTargetByPath(
      editor.root,
      '0'
    )
    const endTarget = await getVisiblePaginationTextTargetByPath(
      editor.root,
      '2'
    )

    expect(startTarget).toBeTruthy()
    expect(endTarget).toBeTruthy()

    await page.mouse.move(startTarget!.x, startTarget!.y)
    await page.mouse.down()
    await page.mouse.move(endTarget!.x, endTarget!.y, { steps: 30 })
    await page.mouse.up()

    await expect
      .poll(async () => {
        const domSelectionText = await page.evaluate(
          () => document.getSelection()?.toString() ?? ''
        )
        const selection = await editor.selection.get()
        const focusBlock = selection?.focus.path[0] ?? null

        return {
          anchorAtDocumentStart:
            selection?.anchor.path.join(',') === '0,0' &&
            selection.anchor.offset === 0,
          expanded:
            !!selection &&
            (selection.anchor.path.join(',') ===
              selection.focus.path.join(',') &&
              selection.anchor.offset === selection.focus.offset) === false,
          focusInVisiblePageText:
            typeof focusBlock === 'number' &&
            focusBlock >= 2 &&
            focusBlock < 20,
          includesDraggedText: domSelectionText.includes(
            'Premirror Milestone 1 test document'
          ),
          notVirtualTail: focusBlock !== 3020,
        }
      })
      .toEqual({
        anchorAtDocumentStart: true,
        expanded: true,
        focusInVisiblePageText: true,
        includesDraggedText: true,
        notVirtualTail: true,
      })
  })

  test('places virtualized pagination selection at line start from the page margin', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for virtualized pagination margin focus ownership'
    )

    await page.setViewportSize({ height: 637, width: 1533 })

    const editor = await openExample(page, 'pagination', {
      query: { strategy: 'virtualized' },
      ready: {
        editor: 'visible',
      },
    })

    await expect
      .poll(async () => {
        const proof = await getPaginationVirtualizedTableProof(editor.root)

        return {
          boundedDOM: proof.totalElementCount < 1400,
          boundedPages: proof.pageSurfaceCount <= 8,
          virtualized: proof.pageVirtualizationEnabled,
        }
      })
      .toEqual({
        boundedDOM: true,
        boundedPages: true,
        virtualized: true,
      })

    const textTarget = await getVisiblePaginationTextTargetByPath(
      editor.root,
      '1'
    )
    const marginTarget = await getVisiblePaginationLineMarginTargetByPath(
      editor.root,
      '0'
    )

    expect(textTarget).toBeTruthy()
    expect(marginTarget).toBeTruthy()

    await page.mouse.click(textTarget!.x, textTarget!.y)
    await expect
      .poll(async () => (await editor.selection.get())?.anchor.path ?? null)
      .toEqual([1, 0])

    await page.mouse.click(marginTarget!.x, marginTarget!.y)

    await expect
      .poll(async () => ({
        activeIsEditor: await editor.root.evaluate(
          (element) => element.ownerDocument.activeElement === element
        ),
        selection: await editor.selection.get(),
      }))
      .toEqual({
        activeIsEditor: true,
        selection: {
          anchor: { path: [Number(marginTarget!.blockPath), 0], offset: 0 },
          focus: { path: [Number(marginTarget!.blockPath), 0], offset: 0 },
        },
      })
  })

  test('keeps split projected paragraphs stable when clicked, navigated, and edited', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for virtualized pagination click/edit alignment'
    )

    await page.setViewportSize({ height: 637, width: 1533 })

    const editor = await openExample(page, 'pagination', {
      query: { strategy: 'virtualized' },
      ready: {
        editor: 'visible',
      },
    })

    await expect
      .poll(async () => {
        const proof = await getPaginationVirtualizedTableProof(editor.root)

        return {
          boundedDOM: proof.totalElementCount < 1400,
          boundedPages: proof.pageSurfaceCount <= 8,
          virtualized: proof.pageVirtualizationEnabled,
        }
      })
      .toEqual({
        boundedDOM: true,
        boundedPages: true,
        virtualized: true,
      })

    await page
      .locator('[data-testid="pagination-viewport"]')
      .evaluate(async (element) => {
        const viewport = element as HTMLElement
        const maxScrollTop = viewport.scrollHeight - viewport.clientHeight

        viewport.scrollTop = Math.round(maxScrollTop * 0.895)
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
      })

    const target = await getVisibleProjectedPaginationTextTarget(editor.root)

    expect(target).toBeTruthy()

    const targetPath = Number(target!.blockPath)

    expect(Number.isFinite(targetPath)).toBe(true)

    await page.mouse.click(target!.x, target!.y)

    await expect
      .poll(async () => {
        const selection = await editor.selection.get()

        return selection
          ? {
              anchorPath: selection.anchor.path.join(','),
              collapsed:
                selection.anchor.path.join(',') ===
                  selection.focus.path.join(',') &&
                selection.anchor.offset === selection.focus.offset,
            }
          : null
      })
      .toEqual({
        anchorPath: `${targetPath},0`,
        collapsed: true,
      })

    const clickedSelection = await editor.selection.get()
    const clickedOffset = clickedSelection!.anchor.offset
    const clickedProof = await getProjectedPaginationTextProof(
      editor.root,
      target!.blockPath
    )

    await testInfo.attach('pagination-projected-click-proof', {
      body: JSON.stringify({ clickedProof, target }, null, 2),
      contentType: 'application/json',
    })

    expect(clickedOffset).toBeGreaterThan(0)
    expect(clickedOffset).toBeLessThan(target!.blockText.length)
    expect(clickedProof.reason).toBe('projection')
    expect(clickedProof.domSync).toBe(null)
    expect(clickedProof.staticLeafCount).toBe(0)
    expect(clickedProof.absoluteLeafCount).toBeGreaterThan(0)
    expect(clickedProof.totalElementCount).toBeLessThan(1400)
    expect(clickedProof.pageSurfaceCount).toBeLessThanOrEqual(8)
    expect(clickedProof.firstVisibleLeafLeft).toBeCloseTo(
      target!.firstLeafLeft,
      0
    )
    expect(clickedProof.firstVisibleLeafTop).toBeCloseTo(
      target!.firstLeafTop,
      0
    )

    await page.keyboard.press('ArrowRight')
    await expect
      .poll(async () => (await editor.selection.get())?.anchor.offset)
      .toBe(clickedOffset + 1)

    await page.keyboard.press('ArrowLeft')
    await expect
      .poll(async () => (await editor.selection.get())?.anchor.offset)
      .toBe(clickedOffset)

    await page.keyboard.insertText('Q')

    const expectedText = `${target!.blockText.slice(
      0,
      clickedOffset
    )}Q${target!.blockText.slice(clickedOffset)}`

    await expect
      .poll(async () => {
        const proof = await getProjectedPaginationTextProof(
          editor.root,
          target!.blockPath
        )

        return {
          blockText: proof.blockText,
          selection: await editor.selection.get(),
          staticLeafCount: proof.staticLeafCount,
        }
      })
      .toEqual({
        blockText: expectedText,
        selection: {
          anchor: { offset: clickedOffset + 1, path: [targetPath, 0] },
          focus: { offset: clickedOffset + 1, path: [targetPath, 0] },
        },
        staticLeafCount: 0,
      })
  })

  test('imports deferred virtualized table input after selection moves', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for deferred native input repair target capture'
    )

    await page.setViewportSize({ height: 900, width: 720 })

    const editor = await openExample(page, 'pagination', {
      ready: {
        editor: 'visible',
        text: /Rich Markdown pagination proof/,
      },
    })
    const tablePathAttribute = await editor.root
      .locator('[data-testid="pagination-rich-table"]')
      .getAttribute('data-slate-path')

    expect(tablePathAttribute).toBeTruthy()

    const tablePath = Number(tablePathAttribute)
    const tableCellText = 'Path-aware cell 120'

    await page.getByLabel('DOM strategy').selectOption('virtualized')
    await page.getByLabel('Page overscan').fill('4')

    await expect
      .poll(async () => {
        const proof = await getPaginationVirtualizedTableProof(editor.root)

        return {
          boundedDOM: proof.totalElementCount < 3600,
          virtualized: proof.pageVirtualizationEnabled,
        }
      })
      .toEqual({
        boundedDOM: true,
        virtualized: true,
      })

    await editor.selection.collapse({
      path: [tablePath, 119, 1, 0],
      offset: tableCellText.length,
    })
    await editor.focus()

    await expect
      .poll(async () => {
        const proof = await getPaginationVirtualizedTableProof(editor.root)

        return {
          hasRow120: proof.hasRow120,
          mountedCellCount: proof.mountedCellCount <= 660,
          mountedRowCount: proof.mountedRowCount <= 220,
        }
      })
      .toEqual({
        hasRow120: true,
        mountedCellCount: true,
        mountedRowCount: true,
      })

    await page.keyboard.insertText('x')
    await editor.selection.collapse({ path: [0, 0], offset: 0 })

    await expect
      .poll(async () => ({
        modelHasTableText: (await editor.get.modelText()).includes(
          `${tableCellText}x`
        ),
        selection: await editor.selection.get(),
      }))
      .toEqual({
        modelHasTableText: true,
        selection: {
          anchor: { offset: 0, path: [0, 0] },
          focus: { offset: 0, path: [0, 0] },
        },
      })
  })

  test('keeps a 1000-page virtualized document with a 10-page table bounded', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for pagination page virtualization stress'
    )

    const editor = await openExample(page, 'pagination', {
      ready: {
        editor: 'visible',
        text: /Rich Markdown pagination proof/,
      },
    })
    const tablePathAttribute = await editor.root
      .locator('[data-testid="pagination-rich-table"]')
      .getAttribute('data-slate-path')

    expect(tablePathAttribute).toBeTruthy()

    const tablePath = Number(tablePathAttribute)

    await page.getByLabel('DOM strategy').selectOption('virtualized')
    await page.getByLabel('Page overscan').fill('0')

    let defaultMountedElementCount = 0
    let defaultMountedPageCount = 0

    await expect
      .poll(
        async () => {
          const proof = await getPaginationVirtualizedTableProof(editor.root)
          defaultMountedElementCount = proof.totalElementCount
          defaultMountedPageCount = proof.pageSurfaceCount

          return {
            boundedDOM: proof.totalElementCount < 1000,
            boundedPages: proof.pageSurfaceCount <= 8,
            pageTotalInRange: proof.pageTotal >= 950 && proof.pageTotal <= 1150,
            stressPagesConfigured: proof.stressPageCount >= 900,
            tablePagesInRange:
              proof.tablePageCount >= 8 && proof.tablePageCount <= 12,
            virtualized: proof.pageVirtualizationEnabled,
          }
        },
        { timeout: 15_000 }
      )
      .toEqual({
        boundedDOM: true,
        boundedPages: true,
        pageTotalInRange: true,
        stressPagesConfigured: true,
        tablePagesInRange: true,
        virtualized: true,
      })

    await page
      .locator('[data-testid="pagination-viewport"]')
      .evaluate(async (element) => {
        const viewport = element as HTMLElement
        const maxScrollTop = viewport.scrollHeight - viewport.clientHeight

        viewport.scrollTop = Math.round(maxScrollTop * 0.0125)
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
      })

    await expect
      .poll(
        async () => {
          const proof = await getPaginationVirtualizedTableProof(editor.root)

          return {
            boundedDOM: proof.totalElementCount < 1400,
            boundedPages: proof.pageSurfaceCount <= 8,
            boundedRows: proof.mountedRowCount <= 80,
            boundedCells: proof.mountedCellCount <= 240,
          }
        },
        { timeout: 15_000 }
      )
      .toEqual({
        boundedDOM: true,
        boundedPages: true,
        boundedRows: true,
        boundedCells: true,
      })

    await page
      .locator('[data-testid="pagination-viewport"]')
      .evaluate((element) => ((element as HTMLElement).scrollTop = 0))

    await expect
      .poll(
        async () => {
          const proof = await getPaginationVirtualizedTableProof(editor.root)

          return proof.mountedRowCount
        },
        { timeout: 15_000 }
      )
      .toBe(0)

    await page.getByLabel('Page overscan').fill('4')

    await expect
      .poll(
        async () => {
          const proof = await getPaginationVirtualizedTableProof(editor.root)

          return {
            boundedDOM: proof.totalElementCount < 3600,
            mountedMoreDOM:
              proof.totalElementCount > defaultMountedElementCount,
            mountedMorePages: proof.pageSurfaceCount > defaultMountedPageCount,
            mountedPagesStayBounded: proof.pageSurfaceCount <= 14,
            pageOverscan: proof.pageOverscan,
          }
        },
        { timeout: 15_000 }
      )
      .toEqual({
        boundedDOM: true,
        mountedMoreDOM: true,
        mountedMorePages: true,
        mountedPagesStayBounded: true,
        pageOverscan: 4,
      })

    await editor.selection.collapse({
      path: [tablePath, 119, 1, 0],
      offset: 'Path-aware cell 120'.length,
    })
    await editor.focus()

    await expect
      .poll(
        async () => {
          const proof = await getPaginationVirtualizedTableProof(editor.root)

          return (
            proof.hasRow120 &&
            typeof proof.firstRowIndex === 'number' &&
            proof.firstRowIndex <= 119 &&
            typeof proof.lastRowIndex === 'number' &&
            proof.lastRowIndex >= 119 &&
            proof.pageSurfaceCount <= 18 &&
            proof.mountedRowCount <= 220 &&
            proof.mountedCellCount <= 660 &&
            proof.totalElementCount < 3600
          )
        },
        { timeout: 15_000 }
      )
      .toBe(true)

    let targetText = 'Path-aware cell 120'

    for (const char of ['x', 'y', 'z']) {
      targetText += char
      await page.keyboard.insertText(char)

      await expect
        .poll(async () => ({
          modelHasText: (await editor.get.modelText()).includes(targetText),
          selection: await editor.selection.get(),
        }))
        .toEqual({
          modelHasText: true,
          selection: {
            anchor: { path: [tablePath, 119, 1, 0], offset: targetText.length },
            focus: { path: [tablePath, 119, 1, 0], offset: targetText.length },
          },
        })
    }
  })

  test('keeps middle-document typing responsive in a 1000-page virtualized document', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for pagination middle-document typing latency'
    )

    await page.setViewportSize({ height: 900, width: 720 })
    const editor = await openExample(page, 'pagination', {
      ready: {
        editor: 'visible',
        text: /Rich Markdown pagination proof/,
      },
    })

    await page.getByLabel('DOM strategy').selectOption('virtualized')

    await expect
      .poll(async () => {
        const proof = await getPaginationVirtualizedTableProof(editor.root)

        return {
          boundedDOM: proof.totalElementCount < 1400,
          boundedPages: proof.pageSurfaceCount <= 8,
          pageTotalInRange: proof.pageTotal >= 950 && proof.pageTotal <= 1150,
          stressPagesConfigured: proof.stressPageCount >= 900,
          virtualized: proof.pageVirtualizationEnabled,
        }
      })
      .toEqual({
        boundedDOM: true,
        boundedPages: true,
        pageTotalInRange: true,
        stressPagesConfigured: true,
        virtualized: true,
      })

    const targetBlockPath = 1532
    const targetTextPrefix = 'Release '

    await editor.selection.collapse({
      path: [targetBlockPath, 0],
      offset: targetTextPrefix.length,
    })
    await expect
      .poll(async () =>
        editor.root.locator(`[data-slate-path="${targetBlockPath}"]`).count()
      )
      .toBeGreaterThan(0)
    await editor.root
      .locator(`[data-slate-path="${targetBlockPath}"]`)
      .evaluate(async (block) => {
        block.scrollIntoView({ block: 'center' })
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
      })
    await editor.selection.collapse({
      path: [targetBlockPath, 0],
      offset: targetTextPrefix.length,
    })
    await expect
      .poll(async () =>
        editor.root.evaluate((element: HTMLElement, path) => {
          const text = element.querySelector(`[data-slate-path="${path},0"]`)

          return {
            domSync: text?.getAttribute('data-slate-dom-sync') ?? null,
            reason: text?.getAttribute('data-slate-dom-sync-reason') ?? null,
          }
        }, targetBlockPath)
      )
      .toEqual({ domSync: 'true', reason: null })
    await editor.focus()
    await expect
      .poll(async () => editor.selection.get())
      .toEqual({
        anchor: {
          path: [targetBlockPath, 0],
          offset: targetTextPrefix.length,
        },
        focus: {
          path: [targetBlockPath, 0],
          offset: targetTextPrefix.length,
        },
      })
    const rafCadenceMs = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          requestAnimationFrame((first) => {
            requestAnimationFrame((second) => {
              resolve(second - first)
            })
          })
        })
    )

    await expect
      .poll(async () => {
        const sample = await getPaginationMiddleTypingSample(editor.root, {
          eventStart: 0,
          expectedText: 'Release readiness memo',
          path: targetBlockPath,
        })

        return {
          blockVisible: sample.blockVisible,
          boundedDOM: sample.totalElementCount < 1400,
          boundedPages: sample.pageSurfaceCount <= 10,
        }
      })
      .toEqual({
        blockVisible: true,
        boundedDOM: true,
        boundedPages: true,
      })

    let typedPrefix = ''

    typedPrefix += 'x'
    await armPaginationMiddleTypingProbe(editor.root, {
      expectedText: `${targetTextPrefix}${typedPrefix}readiness memo`,
      path: targetBlockPath,
    })
    await page.keyboard.insertText('x')
    const warmupSample = await readPaginationMiddleTypingProbe(editor.root)

    expect(warmupSample.blockVisible).toBe(true)
    expect(warmupSample.hasExpectedText).toBe(true)
    await expect
      .poll(async () => editor.selection.get())
      .toEqual({
        anchor: {
          path: [targetBlockPath, 0],
          offset: targetTextPrefix.length + typedPrefix.length,
        },
        focus: {
          path: [targetBlockPath, 0],
          offset: targetTextPrefix.length + typedPrefix.length,
        },
      })

    const samples: PaginationMiddleTypingSample[] = []

    for (const char of [
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
      'i',
      'j',
      'k',
      'l',
      'm',
      'n',
      'o',
      'p',
    ]) {
      typedPrefix += char
      const expectedText = `${targetTextPrefix}${typedPrefix}readiness memo`

      await armPaginationMiddleTypingProbe(editor.root, {
        expectedText,
        path: targetBlockPath,
      })
      await page.keyboard.insertText(char)
      const sample = await readPaginationMiddleTypingProbe(editor.root)

      expect(sample.blockVisible).toBe(true)
      expect(sample.hasExpectedText).toBe(true)
      expect(sample.totalElementCount).toBeLessThan(1400)
      expect(sample.pageSurfaceCount).toBeLessThanOrEqual(10)
      samples.push(sample)
      await expect
        .poll(async () => editor.selection.get())
        .toEqual({
          anchor: {
            path: [targetBlockPath, 0],
            offset: targetTextPrefix.length + typedPrefix.length,
          },
          focus: {
            path: [targetBlockPath, 0],
            offset: targetTextPrefix.length + typedPrefix.length,
          },
        })
    }

    const p95EventToPaint = getPercentile(
      samples.map((sample) => sample.eventToPaintMs),
      0.95
    )
    const p95ComposeMs = getPercentile(
      samples.map((sample) => sample.composeMs),
      0.95
    )

    await testInfo.attach('pagination-middle-typing-metrics', {
      body: JSON.stringify(
        {
          maxDOM: Math.max(
            ...samples.map((sample) => sample.totalElementCount)
          ),
          maxPageSurfaces: Math.max(
            ...samples.map((sample) => sample.pageSurfaceCount)
          ),
          p95ComposeMs,
          p95EventToPaint,
          rafCadenceMs,
          samples,
        },
        null,
        2
      ),
      contentType: 'application/json',
    })

    expect(p95EventToPaint).toBeLessThanOrEqual(80)
  })

  test('keeps fast burst typing intact in a 1000-page virtualized document', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for pagination middle-document burst typing'
    )

    await page.setViewportSize({ height: 900, width: 720 })
    const editor = await openExample(page, 'pagination', {
      ready: {
        editor: 'visible',
        text: /Rich Markdown pagination proof/,
      },
    })

    await page.getByLabel('DOM strategy').selectOption('virtualized')

    await expect
      .poll(async () => {
        const proof = await getPaginationVirtualizedTableProof(editor.root)

        return {
          boundedDOM: proof.totalElementCount < 1400,
          boundedPages: proof.pageSurfaceCount <= 8,
          virtualized: proof.pageVirtualizationEnabled,
        }
      })
      .toEqual({
        boundedDOM: true,
        boundedPages: true,
        virtualized: true,
      })

    const targetBlockPath = 1532
    const targetTextPrefix = 'Release '
    const burstText = 'abcdefghijklmnop'
    const expectedText = `${targetTextPrefix}${burstText}readiness memo`

    await editor.selection.collapse({
      path: [targetBlockPath, 0],
      offset: targetTextPrefix.length,
    })
    await expect
      .poll(async () =>
        editor.root.locator(`[data-slate-path="${targetBlockPath}"]`).count()
      )
      .toBeGreaterThan(0)
    await editor.root
      .locator(`[data-slate-path="${targetBlockPath}"]`)
      .evaluate(async (block) => {
        block.scrollIntoView({ block: 'center' })
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
      })
    await editor.selection.collapse({
      path: [targetBlockPath, 0],
      offset: targetTextPrefix.length,
    })
    await editor.focus()
    await expect
      .poll(async () => editor.selection.get())
      .toEqual({
        anchor: {
          path: [targetBlockPath, 0],
          offset: targetTextPrefix.length,
        },
        focus: {
          path: [targetBlockPath, 0],
          offset: targetTextPrefix.length,
        },
      })

    const startedAt = await page.evaluate(() => performance.now())

    await page.keyboard.type(burstText, { delay: 0 })

    await expect
      .poll(
        async () => {
          const sample = await getPaginationMiddleTypingSample(editor.root, {
            eventStart: startedAt,
            expectedText,
            path: targetBlockPath,
          })

          return {
            blockText: sample.blockText,
            blockVisible: sample.blockVisible,
            boundedDOM: sample.totalElementCount < 1400,
            boundedPages: sample.pageSurfaceCount <= 10,
            hasExpectedText: sample.hasExpectedText,
            modelHasExpectedText: (await editor.get.modelText()).includes(
              expectedText
            ),
            selection: await editor.selection.get(),
          }
        },
        { timeout: 5000 }
      )
      .toEqual({
        blockText: expect.stringContaining(expectedText),
        blockVisible: true,
        boundedDOM: true,
        boundedPages: true,
        hasExpectedText: true,
        modelHasExpectedText: true,
        selection: {
          anchor: {
            path: [targetBlockPath, 0],
            offset: targetTextPrefix.length + burstText.length,
          },
          focus: {
            path: [targetBlockPath, 0],
            offset: targetTextPrefix.length + burstText.length,
          },
        },
      })
  })

  test('resets deferred virtualized text offset after moving the caret in the same block', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for virtualized deferred input offset reset'
    )

    await page.setViewportSize({ height: 900, width: 720 })
    const editor = await openExample(page, 'pagination', {
      ready: {
        editor: 'visible',
        text: /Rich Markdown pagination proof/,
      },
    })

    await page.getByLabel('DOM strategy').selectOption('virtualized')

    await expect
      .poll(async () => {
        const proof = await getPaginationVirtualizedTableProof(editor.root)

        return {
          boundedDOM: proof.totalElementCount < 1400,
          boundedPages: proof.pageSurfaceCount <= 8,
          virtualized: proof.pageVirtualizationEnabled,
        }
      })
      .toEqual({
        boundedDOM: true,
        boundedPages: true,
        virtualized: true,
      })

    const targetBlockPath = 1532
    const targetTextPrefix = 'Release '

    await editor.selection.collapse({
      path: [targetBlockPath, 0],
      offset: targetTextPrefix.length,
    })
    await editor.root
      .locator(`[data-slate-path="${targetBlockPath}"]`)
      .evaluate(async (block) => {
        block.scrollIntoView({ block: 'center' })
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
      })
    await editor.selection.collapse({
      path: [targetBlockPath, 0],
      offset: targetTextPrefix.length,
    })
    await editor.focus()

    await page.keyboard.type('abc', { delay: 0 })
    await expect
      .poll(async () => ({
        modelHasExpectedText: (await editor.get.modelText()).includes(
          'Release abcreadiness memo'
        ),
        selection: await editor.selection.get(),
      }))
      .toEqual({
        modelHasExpectedText: true,
        selection: {
          anchor: {
            path: [targetBlockPath, 0],
            offset: targetTextPrefix.length + 3,
          },
          focus: {
            path: [targetBlockPath, 0],
            offset: targetTextPrefix.length + 3,
          },
        },
      })

    await editor.selection.collapse({
      path: [targetBlockPath, 0],
      offset: targetTextPrefix.length + 1,
    })
    await editor.focus()
    await page.keyboard.insertText('X')

    await expect
      .poll(async () => {
        const sample = await getPaginationMiddleTypingSample(editor.root, {
          eventStart: 0,
          expectedText: 'Release aXbcreadiness memo',
          path: targetBlockPath,
        })

        return {
          hasExpectedText: sample.hasExpectedText,
          modelHasExpectedText: (await editor.get.modelText()).includes(
            'Release aXbcreadiness memo'
          ),
          selection: await editor.selection.get(),
        }
      })
      .toEqual({
        hasExpectedText: true,
        modelHasExpectedText: true,
        selection: {
          anchor: {
            path: [targetBlockPath, 0],
            offset: targetTextPrefix.length + 2,
          },
          focus: {
            path: [targetBlockPath, 0],
            offset: targetTextPrefix.length + 2,
          },
        },
      })
  })

  test('keeps visible content mounted during fast wheel scrolling through the virtualized table', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for pagination fast-scroll replay'
    )

    await page.setViewportSize({ height: 900, width: 720 })
    const editor = await openExample(page, 'pagination', {
      ready: {
        editor: 'visible',
        text: /Rich Markdown pagination proof/,
      },
    })

    await page.getByLabel('DOM strategy').selectOption('virtualized')

    await expect
      .poll(async () => {
        const proof = await getPaginationVirtualizedTableProof(editor.root)

        return {
          boundedDOM: proof.totalElementCount < 1400,
          boundedPages: proof.pageSurfaceCount <= 8,
          tablePagesInRange:
            proof.tablePageCount >= 8 && proof.tablePageCount <= 12,
          virtualized: proof.pageVirtualizationEnabled,
        }
      })
      .toEqual({
        boundedDOM: true,
        boundedPages: true,
        tablePagesInRange: true,
        virtualized: true,
      })

    const viewport = page.locator('[data-testid="pagination-viewport"]')

    await viewport.evaluate(async (element) => {
      const scrollRoot = element as HTMLElement

      scrollRoot.scrollTop = 0
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
    })

    await expect
      .poll(async () => {
        const sample = await getPaginationFastScrollSample(editor.root, 0)

        return {
          boundedPages: sample.pageSurfaceCount <= 8,
          hasTopContent: /Premirror/.test(sample.visibleText),
          noTableRowsMounted: sample.mountedRowCount === 0,
        }
      })
      .toEqual({
        boundedPages: true,
        hasTopContent: true,
        noTableRowsMounted: true,
      })

    const box = await viewport.boundingBox()

    expect(box).toBeTruthy()

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)

    const samples: PaginationFastScrollSample[] = []

    for (const deltaY of [900, 900, 900, 900, 900, 900, 900, 900, 900, 900]) {
      const startedAt = await page.evaluate(() => performance.now())
      let passingSample: PaginationFastScrollSample | null = null

      await page.mouse.wheel(0, deltaY)

      await expect
        .poll(
          async () => {
            const sample = await getPaginationFastScrollSample(
              editor.root,
              startedAt
            )

            const result = {
              boundedCells: sample.mountedCellCount <= 240,
              boundedDOM: sample.totalElementCount < 1400,
              boundedPages: sample.pageSurfaceCount <= 10,
              boundedRows: sample.mountedRowCount <= 80,
              hitVisibleContent: sample.hitVisibleContentCount > 0,
              hasVisibleText: sample.visibleText.length > 0,
            }

            if (Object.values(result).every(Boolean)) {
              passingSample = sample
            }

            return result
          },
          { timeout: 5000 }
        )
        .toEqual({
          boundedCells: true,
          boundedDOM: true,
          boundedPages: true,
          boundedRows: true,
          hasVisibleText: true,
          hitVisibleContent: true,
        })

      if (passingSample) {
        samples.push(passingSample)
      }
    }

    const rowSamples = samples.filter(
      (sample) => sample.mountedRowCount > 0 && sample.firstRowIndex !== null
    )
    const eventToPaintSamples = samples.map((sample) => sample.eventToPaintMs)
    const p50EventToPaint = getPercentile(eventToPaintSamples, 0.5)
    const p95EventToPaint = getPercentile(eventToPaintSamples, 0.95)

    await testInfo.attach('pagination-fast-scroll-metrics', {
      body: JSON.stringify(
        {
          p50EventToPaint,
          p95EventToPaint,
          samples,
        },
        null,
        2
      ),
      contentType: 'application/json',
    })

    expect(rowSamples.length).toBeGreaterThan(0)
    expect(p50EventToPaint).toBeLessThanOrEqual(80)
    expect(p95EventToPaint).toBeLessThanOrEqual(500)
  })

  test('keeps scaled virtualized page surfaces aligned with scroll position', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium-only proof for transformed page virtualization coordinates'
    )

    await page.setViewportSize({ height: 900, width: 720 })
    const editor = await openExample(page, 'pagination', {
      ready: {
        editor: 'visible',
        text: /Rich Markdown pagination proof/,
      },
    })

    await page.getByLabel('DOM strategy').selectOption('virtualized')
    await expect
      .poll(async () => {
        const proof = await getPaginationVirtualizedTableProof(editor.root)

        return {
          enoughPages: proof.pageTotal > 80,
          virtualized: proof.pageVirtualizationEnabled,
        }
      })
      .toEqual({
        enoughPages: true,
        virtualized: true,
      })

    const targetPageIndex = 40
    const scrollProof = await page
      .locator('[data-testid="pagination-viewport"]')
      .evaluate(async (element, pageIndex) => {
        const viewport = element as HTMLElement
        const root = document.querySelector<HTMLElement>(
          '[data-slate-paged-editable]'
        )
        const pageSurfaces = Array.from(
          document.querySelectorAll<HTMLElement>('[data-slate-page-surface]')
        )
        const firstPage = pageSurfaces[0]

        if (!root || !firstPage) {
          throw new Error('Cannot inspect mounted pagination surfaces')
        }

        const scale = root.getBoundingClientRect().height / root.offsetHeight
        const rowTops = [
          ...new Set(pageSurfaces.map((surface) => surface.offsetTop)),
        ].sort((left, right) => left - right)
        const pageStride = rowTops[1] - rowTops[0]
        const pagesPerRow = pageSurfaces.filter(
          (surface) => surface.offsetTop === firstPage.offsetTop
        ).length

        if (
          !Number.isFinite(pageStride) ||
          pageStride <= 0 ||
          pagesPerRow < 1
        ) {
          throw new Error('Cannot resolve mounted pagination row stride')
        }

        viewport.scrollTop = Math.round(
          pageStride * Math.floor(pageIndex / pagesPerRow) * scale
        )
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )

        return { pageStride, scale }
      }, targetPageIndex)

    expect(scrollProof.scale).toBeLessThan(1)

    await expect
      .poll(() => getMountedPaginationPageIndexes(editor.root), {
        timeout: 15_000,
      })
      .toContain(targetPageIndex)
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
      const visibleTableRows = Array.from(
        document.querySelectorAll('[data-testid="pagination-rich-table-row"]')
      ).filter((row) => row.getBoundingClientRect().height > 0)
      const visibleTableCells = Array.from(
        document.querySelectorAll('[data-testid="pagination-rich-table-cell"]')
      ).filter((cell) => cell.getBoundingClientRect().height > 0)
      const tableRowsInsideFrame = visibleTableRows.every(isInsideFrame)

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
        tableRowsInsideFrame,
        visibleTableCellCount: visibleTableCells.length,
        visibleTableRowCount: visibleTableRows.length,
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
      tableRowsInsideFrame: true,
      visibleTableCellCount: 720,
      visibleTableRowCount: 240,
      thematicBreakInsideFrame: true,
    })
    expect(proof.frameCount).toBeGreaterThan(1)
    expect(proof.mixedInlineLeafCount).toBeGreaterThan(1)
  })
})
