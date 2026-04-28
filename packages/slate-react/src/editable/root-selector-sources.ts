import { type ReactNode, useCallback, useMemo } from 'react'
import type { Operation, Path, RuntimeId } from 'slate'
import { Editor, Node } from 'slate'
import { useSlateSelector } from '../hooks/use-slate-selector'
import { createIslandPlan } from '../large-document/create-island-plan'
import type { ReactEditor } from '../plugin/react-editor'

export type LargeDocumentRootConfig = {
  activeRadius: number
  islandSize: number
  previewChars: number
  threshold: number
}

const isTextOperation = (operation: Operation | undefined) =>
  operation?.type === 'insert_text' || operation?.type === 'remove_text'

const isSelectionOperation = (operation: Operation | undefined) =>
  operation?.type === 'set_selection'

const hasNoOperations = (operations: readonly Operation[] | undefined) =>
  !operations || operations.length === 0

const getRootPathKey = (path: Path) => path.join('.')

const shouldUpdateRootRuntimeIds = (operations?: readonly Operation[]) =>
  hasNoOperations(operations) ||
  (operations ?? []).some(
    (operation) =>
      !isTextOperation(operation) && !isSelectionOperation(operation)
  )

const shouldUpdateSelectedTopLevelIndex = (operations?: readonly Operation[]) =>
  hasNoOperations(operations) ||
  (operations ?? []).some(
    (operation) =>
      isSelectionOperation(operation) || !isTextOperation(operation)
  )

const shouldUpdatePlaceholderValue = (operations?: readonly Operation[]) =>
  hasNoOperations(operations) ||
  (operations ?? []).some((operation) => !isSelectionOperation(operation))

const shouldUpdateEditableRootCommit = (operations?: readonly Operation[]) =>
  hasNoOperations(operations) ||
  (operations ?? []).some(
    (operation) =>
      !isTextOperation(operation) && !isSelectionOperation(operation)
  )

const sameRuntimeIds = (
  left: readonly RuntimeId[],
  right: readonly RuntimeId[]
) =>
  left.length === right.length &&
  left.every((runtimeId, index) => runtimeId === right[index])

const selectRootRuntimeIds = (editor: ReactEditor) => {
  const snapshot = Editor.getSnapshot(editor)

  return snapshot.children
    .map((_node: unknown, index: number) => {
      const path = [index] as Path
      const pathKey = getRootPathKey(path)

      return (
        snapshot.index.pathToId[pathKey] ?? Editor.getRuntimeId(editor, path)
      )
    })
    .filter(Boolean) as RuntimeId[]
}

export const useRootRuntimeIds = () =>
  useSlateSelector(
    selectRootRuntimeIds,
    (left, right) => {
      return left != null && sameRuntimeIds(left as RuntimeId[], right)
    },
    {
      shouldUpdate: shouldUpdateRootRuntimeIds,
    }
  )

export const useSelectedTopLevelIndex = (enabled: boolean) => {
  const selector = useCallback(
    (editor: ReactEditor) => {
      if (!enabled) {
        return null
      }

      const selection = Editor.getSnapshot(editor).selection
      const anchorIndex = selection?.anchor.path[0]
      const focusIndex = selection?.focus.path[0]

      if (typeof anchorIndex !== 'number' || typeof focusIndex !== 'number') {
        return null
      }

      return Math.min(anchorIndex, focusIndex)
    },
    [enabled]
  )
  const shouldUpdate = useCallback(
    (operations?: readonly Operation[]) =>
      enabled && shouldUpdateSelectedTopLevelIndex(operations),
    [enabled]
  )

  return useSlateSelector(selector, Object.is, { shouldUpdate })
}

export const usePlaceholderValue = (placeholder?: ReactNode) => {
  const selector = useCallback(
    (editor: ReactEditor) =>
      placeholder &&
      Editor.getChildren(editor).length === 1 &&
      Array.from(Node.texts(editor)).length === 1 &&
      Node.string(editor) === ''
        ? placeholder
        : undefined,
    [placeholder]
  )

  return useSlateSelector(selector, Object.is, {
    shouldUpdate: shouldUpdatePlaceholderValue,
  })
}

export const useEditableRootCommitWakeup = () => {
  useSlateSelector(
    (editor: ReactEditor) => Editor.getLastCommit(editor)?.version ?? 0,
    Object.is,
    {
      shouldUpdate: shouldUpdateEditableRootCommit,
    }
  )
}

export const useLargeDocumentRootSources = ({
  largeDocumentConfig,
  promotedIslandIndex,
}: {
  largeDocumentConfig: LargeDocumentRootConfig | null
  promotedIslandIndex: number | null
}) => {
  const topLevelRuntimeIds = useRootRuntimeIds()
  const selectedTopLevelIndex = useSelectedTopLevelIndex(
    largeDocumentConfig != null
  )

  return useMemo(() => {
    const islandPlan =
      largeDocumentConfig &&
      topLevelRuntimeIds.length >= largeDocumentConfig.threshold
        ? createIslandPlan({
            activeRadius: largeDocumentConfig.activeRadius,
            defaultActiveIslandIndex:
              selectedTopLevelIndex == null
                ? 0
                : Math.floor(
                    selectedTopLevelIndex / largeDocumentConfig.islandSize
                  ),
            islandSize: largeDocumentConfig.islandSize,
            promotedIslandIndex,
            topLevelRuntimeIds,
          })
        : null
    const mountedTopLevelRuntimeIds = islandPlan
      ? new Set(
          islandPlan.islands.flatMap((island) =>
            island.isActive ? island.mountedRuntimeIds : []
          )
        )
      : null
    const mountedTopLevelRanges = islandPlan
      ? islandPlan.islands
          .filter((island) => island.isActive)
          .map((island) => ({
            endIndex: island.endIndex,
            startIndex: island.startIndex,
          }))
      : null

    return {
      islandPlan,
      mountedTopLevelRanges,
      mountedTopLevelRuntimeIds,
      topLevelRuntimeIds,
    }
  }, [
    largeDocumentConfig,
    promotedIslandIndex,
    selectedTopLevelIndex,
    topLevelRuntimeIds,
  ])
}
