import {
  defaultRangeExtractor,
  useVirtualizer,
  type VirtualItem,
  type Range as VirtualRange,
} from '@tanstack/react-virtual'
import React from 'react'
import type { RuntimeId } from 'slate'

import type { MountedTopLevelRange } from './rendering-strategy-commands'

export type RenderingStrategyVirtualizedConfig = {
  estimatedBlockSize: number
  overscan: number
  threshold: number
}

export type VirtualizedTopLevelItem = {
  index: number
  key: VirtualItem['key']
  runtimeId: RuntimeId
  size: number
  start: number
}

export type VirtualizedMissingTopLevelRange = {
  boundaryId: string
  endIndex: number
  focusRuntimeId: RuntimeId | null
  runtimeIds: readonly RuntimeId[]
  startIndex: number
  anchorRuntimeId: RuntimeId | null
}

const SCROLLABLE_OVERFLOW_PATTERN = /(auto|scroll|overlay)/

const parseCSSPixels = (value: string | null | undefined) => {
  if (!value || value === 'auto' || value === 'none') {
    return 0
  }

  const parsed = Number.parseFloat(value)

  return Number.isFinite(parsed) ? parsed : 0
}

const getElementViewportHeight = (
  element: HTMLElement | null,
  fallback: number
) => {
  if (!element) {
    return fallback
  }

  if (element.clientHeight > 0) {
    return element.clientHeight
  }

  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  const styleHeight = parseCSSPixels(style?.height)

  if (styleHeight > 0) {
    return styleHeight
  }

  const maxHeight = parseCSSPixels(style?.maxHeight)

  return maxHeight > 0 ? maxHeight : fallback
}

export const canUseElementAsVirtualizerScrollRoot = (
  element: HTMLElement | null
) => {
  if (!element) {
    return false
  }

  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  const overflow = `${style?.overflow ?? ''} ${style?.overflowY ?? ''}`
  const hasScrollableOverflow = SCROLLABLE_OVERFLOW_PATTERN.test(overflow)
  const hasBoundedHeight =
    element.clientHeight > 0 ||
    parseCSSPixels(style?.height) > 0 ||
    parseCSSPixels(style?.maxHeight) > 0

  return hasScrollableOverflow && hasBoundedHeight
}

const createRetainedRangeExtractor =
  ({
    count,
    promotedTopLevelIndex,
    selectedTopLevelIndex,
  }: {
    count: number
    promotedTopLevelIndex: number | null
    selectedTopLevelIndex: number | null
  }) =>
  (range: VirtualRange) => {
    const indexes = new Set(defaultRangeExtractor(range))

    for (const index of [selectedTopLevelIndex, promotedTopLevelIndex]) {
      if (typeof index === 'number' && index >= 0 && index < count) {
        indexes.add(index)
      }
    }

    return [...indexes].sort((left, right) => left - right)
  }

const coalesceIndexes = (
  indexes: readonly number[]
): readonly MountedTopLevelRange[] => {
  const ranges: MountedTopLevelRange[] = []
  let start: number | null = null
  let end: number | null = null

  for (const index of indexes) {
    if (start == null || end == null) {
      start = index
      end = index
      continue
    }

    if (index === end + 1) {
      end = index
      continue
    }

    ranges.push({ endIndex: end, startIndex: start })
    start = index
    end = index
  }

  if (start != null && end != null) {
    ranges.push({ endIndex: end, startIndex: start })
  }

  return ranges
}

const getMissingRanges = ({
  count,
  mountedRanges,
  topLevelRuntimeIds,
}: {
  count: number
  mountedRanges: readonly MountedTopLevelRange[]
  topLevelRuntimeIds: readonly RuntimeId[]
}): readonly VirtualizedMissingTopLevelRange[] => {
  const ranges: VirtualizedMissingTopLevelRange[] = []
  let nextIndex = 0

  const pushRange = (startIndex: number, endIndex: number) => {
    if (startIndex > endIndex) {
      return
    }

    const runtimeIds = topLevelRuntimeIds.slice(startIndex, endIndex + 1)

    ranges.push({
      anchorRuntimeId: runtimeIds[0] ?? null,
      boundaryId: `viewport-virtualization:${startIndex}-${endIndex}`,
      endIndex,
      focusRuntimeId: runtimeIds.at(-1) ?? null,
      runtimeIds,
      startIndex,
    })
  }

  for (const range of mountedRanges) {
    pushRange(nextIndex, range.startIndex - 1)
    nextIndex = range.endIndex + 1
  }

  pushRange(nextIndex, count - 1)

  return ranges
}

export const useVirtualizedRootPlan = ({
  config,
  enabled,
  promotedTopLevelIndex,
  rootElement,
  selectedTopLevelIndex,
  topLevelRuntimeIds,
}: {
  config: RenderingStrategyVirtualizedConfig | null
  enabled: boolean
  promotedTopLevelIndex: number | null
  rootElement: HTMLElement | null
  selectedTopLevelIndex: number | null
  topLevelRuntimeIds: readonly RuntimeId[]
}) => {
  const count = config ? topLevelRuntimeIds.length : 0
  const estimatedBlockSize = config?.estimatedBlockSize ?? 32
  const rangeExtractor = React.useMemo(
    () =>
      createRetainedRangeExtractor({
        count,
        promotedTopLevelIndex,
        selectedTopLevelIndex,
      }),
    [count, promotedTopLevelIndex, selectedTopLevelIndex]
  )
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns imperative helpers; this hook owns them locally.
  const virtualizer = useVirtualizer<HTMLElement, HTMLElement>({
    count,
    enabled: Boolean(config && enabled),
    estimateSize: () => estimatedBlockSize,
    getItemKey: (index) => topLevelRuntimeIds[index] ?? index,
    getScrollElement: () => rootElement,
    initialRect: {
      height: getElementViewportHeight(rootElement, estimatedBlockSize * 8),
      width: rootElement?.clientWidth || 1024,
    },
    overscan: config?.overscan ?? 0,
    rangeExtractor,
  })

  if (!config || !enabled || count < config.threshold) {
    return null
  }

  const virtualItemsByIndex = new Map(
    virtualizer
      .getVirtualItems()
      .map<VirtualizedTopLevelItem>((item) => ({
        index: item.index,
        key: item.key,
        runtimeId: topLevelRuntimeIds[item.index]!,
        size: item.size,
        start: item.start,
      }))
      .filter((item) => item.runtimeId)
      .map((item) => [item.index, item])
  )

  for (const index of [selectedTopLevelIndex, promotedTopLevelIndex]) {
    if (
      typeof index !== 'number' ||
      index < 0 ||
      index >= count ||
      virtualItemsByIndex.has(index)
    ) {
      continue
    }

    const runtimeId = topLevelRuntimeIds[index]

    if (!runtimeId) {
      continue
    }

    virtualItemsByIndex.set(index, {
      index,
      key: runtimeId,
      runtimeId,
      size: estimatedBlockSize,
      start: index * estimatedBlockSize,
    })
  }

  const virtualItems = [...virtualItemsByIndex.values()].sort(
    (left, right) => left.index - right.index
  )
  const mountedIndexes = virtualItems.map((item) => item.index)
  const mountedTopLevelRanges = coalesceIndexes(mountedIndexes)
  const mountedTopLevelRuntimeIds = new Set(
    virtualItems.map((item) => item.runtimeId)
  )
  const missingRanges = getMissingRanges({
    count,
    mountedRanges: mountedTopLevelRanges,
    topLevelRuntimeIds,
  })

  return {
    estimatedBlockSize,
    missingRanges,
    mountedTopLevelRanges,
    mountedTopLevelRuntimeIds,
    scrollToTopLevelIndex: (
      index: number,
      align: 'start' | 'center' | 'end' | 'auto' = 'auto'
    ) => {
      virtualizer.scrollToIndex(index, { align })
    },
    totalSize: virtualizer.getTotalSize(),
    virtualItems,
    virtualizerMeasuredCount: virtualItems.length,
    measureElement: virtualizer.measureElement,
  }
}
