import { type ReactNode, useCallback, useMemo, useRef } from 'react'
import type { Operation, Path, RuntimeId, SnapshotChange } from 'slate'
import { Node } from 'slate'
import { useEditorSelector } from '../hooks/use-editor-selector'
import { createIslandPlan } from '../large-document/create-island-plan'
import type { ReactEditor } from '../plugin/react-editor'
import { recordSlateReactRender } from '../render-profiler'

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

const topLevelRangesIncludeIndex = (
  ranges: readonly (readonly [number, number])[] | null | undefined,
  index: number
) =>
  ranges == null ||
  ranges.some(([start, end]) => start <= index && end >= index)

const shouldUpdateRootRuntimeIds = (
  operations?: readonly Operation[],
  change?: SnapshotChange
) =>
  change
    ? change.rootRuntimeIdsChanged
    : hasNoOperations(operations) ||
      (operations ?? []).some(
        (operation) =>
          !isTextOperation(operation) && !isSelectionOperation(operation)
      )

const shouldUpdateSelectedTopLevelIndex = (
  operations?: readonly Operation[],
  change?: SnapshotChange
) =>
  change
    ? (change.selectionChanged && change.selectionImpactRuntimeIds !== null) ||
      change.rootRuntimeIdsChanged ||
      change.topLevelOrderChanged
    : hasNoOperations(operations) ||
      (operations ?? []).some(
        (operation) =>
          isSelectionOperation(operation) || !isTextOperation(operation)
      )

const shouldUpdatePlaceholderValue = (
  operations?: readonly Operation[],
  change?: SnapshotChange
) =>
  change
    ? change.fullDocumentChanged ||
      change.topLevelOrderChanged ||
      (change.textChanged &&
        topLevelRangesIncludeIndex(change.dirtyTopLevelRanges, 0))
    : hasNoOperations(operations) ||
      (operations ?? []).some((operation) => !isSelectionOperation(operation))

const shouldUpdateEditableRootCommit = (
  operations?: readonly Operation[],
  change?: SnapshotChange
) =>
  change
    ? change.fullDocumentChanged ||
      change.rootRuntimeIdsChanged ||
      change.structureChanged ||
      change.topLevelOrderChanged
    : hasNoOperations(operations) ||
      (operations ?? []).some(
        (operation) =>
          !isTextOperation(operation) && !isSelectionOperation(operation)
      )

const shouldUpdateRootDocumentEpoch = (
  operations?: readonly Operation[],
  change?: SnapshotChange
) => (change ? change.fullDocumentChanged : hasNoOperations(operations))

const sameRuntimeIds = (
  left: readonly RuntimeId[],
  right: readonly RuntimeId[]
) =>
  left.length === right.length &&
  left.every((runtimeId, index) => runtimeId === right[index])

const selectRootRuntimeIds = (editor: ReactEditor) => {
  return editor.read((state) => {
    return state.value
      .get()
      .map((_node: unknown, index: number) => {
        const path = [index] as Path

        return state.runtime.idAt(path)
      })
      .filter(Boolean) as RuntimeId[]
  })
}

export const useRootRuntimeIds = () =>
  useEditorSelector(
    selectRootRuntimeIds,
    (left, right) => {
      return left != null && sameRuntimeIds(left as RuntimeId[], right)
    },
    {
      profileId: 'root-runtime-ids',
      shouldUpdate: shouldUpdateRootRuntimeIds,
    }
  )

export const useRootDocumentEpoch = () => {
  const lastEpochRef = useRef(0)
  const selector = useCallback(
    (editor: ReactEditor) =>
      editor.read((state) => {
        const commit = state.value.lastCommit()

        if (commit?.fullDocumentChanged) {
          lastEpochRef.current = commit.version
        }

        return lastEpochRef.current
      }),
    []
  )

  return useEditorSelector(selector, Object.is, {
    profileId: 'root-document-epoch',
    shouldUpdate: shouldUpdateRootDocumentEpoch,
  })
}

export const useTopLevelSelectionIndex = (enabled: boolean) => {
  const selector = useCallback(
    (editor: ReactEditor) => {
      if (!enabled) {
        return null
      }

      const selection = editor.read((state) => state.selection.get())
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
    (operations?: readonly Operation[], change?: SnapshotChange) =>
      enabled && shouldUpdateSelectedTopLevelIndex(operations, change),
    [enabled]
  )

  return useEditorSelector(selector, Object.is, {
    profileId: 'top-level-selection-index',
    shouldUpdate,
  })
}

export const usePlaceholderValue = (placeholder?: ReactNode) => {
  const selector = useCallback(
    (editor: ReactEditor) =>
      editor.read(
        (state) =>
          placeholder &&
          state.value.get().length === 1 &&
          Array.from(Node.texts(editor)).length === 1 &&
          Node.string(editor) === ''
      )
        ? placeholder
        : undefined,
    [placeholder]
  )

  return useEditorSelector(selector, Object.is, {
    profileId: 'placeholder',
    shouldUpdate: shouldUpdatePlaceholderValue,
  })
}

export const useEditableRootCommitWakeup = () => {
  useEditorSelector(
    (editor: ReactEditor) =>
      editor.read((state) => state.value.lastCommit()?.version ?? 0),
    Object.is,
    {
      profileId: 'editable-root-commit',
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
  const selectedTopLevelIndex = useTopLevelSelectionIndex(
    largeDocumentConfig != null
  )

  return useMemo(() => {
    recordSlateReactRender({
      id: largeDocumentConfig ? 'large-document-root-sources' : 'root-sources',
      kind: 'root-plan',
    })

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
