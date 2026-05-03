import type { RuntimeId } from 'slate'

export type LargeDocumentMode = 'auto' | 'dom-present' | 'off' | 'shell'

export type LargeDocumentOptions =
  | LargeDocumentMode
  | {
      activeRadius?: number
      islandSize?: number
      mode: 'shell'
      previewChars?: number
      threshold?: number
    }

export type LargeDocumentIsland = {
  endIndex: number
  islandIndex: number
  isActive: boolean
  mountedRuntimeIds: readonly RuntimeId[]
  runtimeIds: readonly RuntimeId[]
  startIndex: number
}

export const createIslandPlan = ({
  activeRadius,
  defaultActiveIslandIndex,
  islandSize,
  promotedIslandIndex,
  topLevelRuntimeIds,
}: {
  activeRadius: number
  defaultActiveIslandIndex: number
  islandSize: number
  promotedIslandIndex: number | null
  topLevelRuntimeIds: readonly RuntimeId[]
}) => {
  const islands: LargeDocumentIsland[] = []
  const activeIslandIndex = promotedIslandIndex ?? defaultActiveIslandIndex
  const activeStart = Math.max(0, activeIslandIndex - activeRadius)
  const activeEnd = activeIslandIndex + activeRadius

  for (
    let startIndex = 0, islandIndex = 0;
    startIndex < topLevelRuntimeIds.length;
    startIndex += islandSize, islandIndex += 1
  ) {
    const endIndex = Math.min(
      topLevelRuntimeIds.length - 1,
      startIndex + islandSize - 1
    )
    const isActive = islandIndex >= activeStart && islandIndex <= activeEnd
    const runtimeIds = topLevelRuntimeIds.slice(startIndex, endIndex + 1)

    islands.push({
      endIndex,
      islandIndex,
      isActive,
      mountedRuntimeIds: isActive ? runtimeIds : [],
      runtimeIds,
      startIndex,
    })
  }

  return {
    activeIslandIndex,
    islands,
  }
}
