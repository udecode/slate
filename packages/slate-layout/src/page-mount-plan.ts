import type {
  SlatePageLayoutFragment,
  SlatePageLayoutGeometry,
  SlatePageLayoutMode,
  SlatePageLayoutPage,
} from './index'

type PageFragmentIndex = Pick<
  SlatePageLayoutFragment,
  'blockIndex' | 'pageIndex'
>

export type PagedEditablePageMountItem = {
  index: number
  key: string
  pageIndexes: readonly number[]
  size: number
  start: number
  topLevelIndexes: readonly number[]
}

export type PagedEditablePageMountPlan = {
  itemIndexesByTopLevelIndex: ReadonlyMap<number, readonly number[]>
  items: readonly PagedEditablePageMountItem[]
}

const getPageMountGroups = (
  pages: readonly SlatePageLayoutPage[],
  mode: SlatePageLayoutMode
) => {
  if (mode === 'spread') {
    const groups: number[][] = []

    for (let index = 0; index < pages.length; index += 2) {
      const pageIndexes = [pages[index]?.index, pages[index + 1]?.index].filter(
        (pageIndex): pageIndex is number => typeof pageIndex === 'number'
      )

      if (pageIndexes.length > 0) {
        groups.push(pageIndexes)
      }
    }

    return groups
  }

  return pages.map((page) => [page.index])
}

export const createPagedEditablePageMountPlan = ({
  fragments,
  geometry,
  mode,
  pages,
}: {
  fragments: readonly PageFragmentIndex[]
  geometry: SlatePageLayoutGeometry
  mode: SlatePageLayoutMode
  pages: readonly SlatePageLayoutPage[]
}): PagedEditablePageMountPlan => {
  const itemIndexesByTopLevelIndex = new Map<number, number[]>()
  const pageArrayIndexByPageIndex = new Map(
    pages.map((page, index) => [page.index, index] as const)
  )
  const groups = getPageMountGroups(pages, mode)
  const items = groups.map<PagedEditablePageMountItem>((pageIndexes, index) => {
    const pageIndexSet = new Set(pageIndexes)
    const topLevelIndexes = [
      ...new Set(
        fragments
          .filter((fragment) => pageIndexSet.has(fragment.pageIndex))
          .map((fragment) => fragment.blockIndex)
      ),
    ].sort((left, right) => left - right)
    const placements = pageIndexes.map((pageIndex) => {
      const pageArrayIndex = pageArrayIndexByPageIndex.get(pageIndex)

      return pageArrayIndex == null
        ? { left: 0, top: 0 }
        : (geometry.pagePlacements[pageArrayIndex] ?? { left: 0, top: 0 })
    })
    const start = Math.min(...placements.map((placement) => placement.top))
    const size = pageIndexes.reduce((height, pageIndex) => {
      const pageArrayIndex = pageArrayIndexByPageIndex.get(pageIndex)
      const page = pageArrayIndex == null ? null : pages[pageArrayIndex]
      const placement =
        pageArrayIndex == null ? null : geometry.pagePlacements[pageArrayIndex]

      if (!page || !placement) {
        return height
      }

      return Math.max(height, placement.top + page.height - start)
    }, 0)

    for (const topLevelIndex of topLevelIndexes) {
      const current = itemIndexesByTopLevelIndex.get(topLevelIndex) ?? []

      current.push(index)
      itemIndexesByTopLevelIndex.set(topLevelIndex, current)
    }

    return {
      index,
      key: `page-mount:${pageIndexes.join('-')}`,
      pageIndexes,
      size,
      start,
      topLevelIndexes,
    }
  })

  return { itemIndexesByTopLevelIndex, items }
}

export const getPagedEditableMountedPageIndexes = (
  plan: PagedEditablePageMountPlan,
  {
    composingTopLevelIndex,
    promotedTopLevelIndex,
    selectedTopLevelIndex,
    visibleItemIndexes,
  }: {
    composingTopLevelIndex?: number | null
    promotedTopLevelIndex?: number | null
    selectedTopLevelIndex?: number | null
    visibleItemIndexes: Iterable<number>
  }
): readonly number[] => {
  const itemIndexes = new Set(visibleItemIndexes)

  for (const topLevelIndex of [
    selectedTopLevelIndex,
    promotedTopLevelIndex,
    composingTopLevelIndex,
  ]) {
    if (typeof topLevelIndex !== 'number') {
      continue
    }

    for (const itemIndex of plan.itemIndexesByTopLevelIndex.get(
      topLevelIndex
    ) ?? []) {
      itemIndexes.add(itemIndex)
    }
  }

  const pageIndexes = new Set<number>()

  for (const itemIndex of itemIndexes) {
    const item = plan.items[itemIndex]

    if (!item) {
      continue
    }

    for (const pageIndex of item.pageIndexes) {
      pageIndexes.add(pageIndex)
    }
  }

  return [...pageIndexes].sort((left, right) => left - right)
}
