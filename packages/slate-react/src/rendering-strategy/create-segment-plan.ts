import type { RuntimeId } from 'slate'

export type RenderingStrategyType =
  | 'auto'
  | 'full'
  | 'staged'
  | 'virtualized'
  | 'shell'

export type RenderingStrategyOptions =
  | RenderingStrategyType
  | {
      overscan?: number
      previewChars?: number
      threshold?: number
      segmentSize?: number
      type: 'shell'
    }
  | {
      /**
       * Experimental viewport-only rendering for pathological documents.
       */
      estimatedBlockSize?: number
      overscan?: number
      previewChars?: number
      threshold?: number
      type: 'virtualized'
    }

export type RenderingStrategySegment = {
  endIndex: number
  segmentIndex: number
  isActive: boolean
  mountedRuntimeIds: readonly RuntimeId[]
  runtimeIds: readonly RuntimeId[]
  startIndex: number
}

export const createSegmentPlan = ({
  overscan,
  defaultActiveSegmentIndex,
  segmentSize,
  promotedSegmentIndex,
  topLevelRuntimeIds,
}: {
  overscan: number
  defaultActiveSegmentIndex: number
  segmentSize: number
  promotedSegmentIndex: number | null
  topLevelRuntimeIds: readonly RuntimeId[]
}) => {
  const segments: RenderingStrategySegment[] = []
  const activeSegmentIndex = promotedSegmentIndex ?? defaultActiveSegmentIndex
  const activeStart = Math.max(0, activeSegmentIndex - overscan)
  const activeEnd = activeSegmentIndex + overscan

  for (
    let startIndex = 0, segmentIndex = 0;
    startIndex < topLevelRuntimeIds.length;
    startIndex += segmentSize, segmentIndex += 1
  ) {
    const endIndex = Math.min(
      topLevelRuntimeIds.length - 1,
      startIndex + segmentSize - 1
    )
    const isActive = segmentIndex >= activeStart && segmentIndex <= activeEnd
    const runtimeIds = topLevelRuntimeIds.slice(startIndex, endIndex + 1)

    segments.push({
      endIndex,
      segmentIndex,
      isActive,
      mountedRuntimeIds: isActive ? runtimeIds : [],
      runtimeIds,
      startIndex,
    })
  }

  return {
    activeSegmentIndex,
    segments,
  }
}
