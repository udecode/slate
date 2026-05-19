import { type ReactNode, useCallback, useMemo, useRef } from 'react'
import type { Operation, Path, RuntimeId, SnapshotChange } from 'slate'
import { NodeApi } from 'slate'
import { useEditorSelector } from '../hooks/use-editor-selector'
import type { ReactRuntimeEditor } from '../plugin/react-editor'
import { recordSlateReactRender } from '../render-profiler'
import { createSegmentPlan } from '../rendering-strategy/create-segment-plan'

export type RenderingStrategyRootConfig = {
  overscan: number
  segmentSize: number
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
    ? change.selectionChanged ||
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

const selectRootRuntimeIds = (editor: ReactRuntimeEditor) => {
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
    (editor: ReactRuntimeEditor) =>
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
    (editor: ReactRuntimeEditor) => {
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
    (editor: ReactRuntimeEditor) =>
      editor.read(
        (state) =>
          placeholder &&
          state.value.get().length === 1 &&
          Array.from(NodeApi.texts(editor)).length === 1 &&
          NodeApi.string(editor) === ''
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
    (editor: ReactRuntimeEditor) =>
      editor.read((state) => state.value.lastCommit()?.version ?? 0),
    Object.is,
    {
      profileId: 'editable-root-commit',
      shouldUpdate: shouldUpdateEditableRootCommit,
    }
  )
}

export const useRenderingStrategyRootSources = ({
  renderingStrategyConfig,
  promotedSegmentIndex,
}: {
  renderingStrategyConfig: RenderingStrategyRootConfig | null
  promotedSegmentIndex: number | null
}) => {
  const topLevelRuntimeIds = useRootRuntimeIds()
  const selectedTopLevelIndex = useTopLevelSelectionIndex(
    renderingStrategyConfig != null
  )
  const selectedSegmentIndex =
    renderingStrategyConfig && selectedTopLevelIndex != null
      ? Math.floor(selectedTopLevelIndex / renderingStrategyConfig.segmentSize)
      : 0

  return useMemo(() => {
    recordSlateReactRender({
      id: renderingStrategyConfig
        ? 'rendering-strategy-root-sources'
        : 'root-sources',
      kind: 'root-plan',
    })

    const segmentPlan =
      renderingStrategyConfig &&
      topLevelRuntimeIds.length >= renderingStrategyConfig.threshold
        ? createSegmentPlan({
            overscan: renderingStrategyConfig.overscan,
            defaultActiveSegmentIndex: selectedSegmentIndex,
            segmentSize: renderingStrategyConfig.segmentSize,
            promotedSegmentIndex,
            topLevelRuntimeIds,
          })
        : null
    const mountedTopLevelRuntimeIds = segmentPlan
      ? new Set(
          segmentPlan.segments.flatMap((segment) =>
            segment.isActive ? segment.mountedRuntimeIds : []
          )
        )
      : null
    const mountedTopLevelRanges = segmentPlan
      ? segmentPlan.segments
          .filter((segment) => segment.isActive)
          .map((segment) => ({
            endIndex: segment.endIndex,
            startIndex: segment.startIndex,
          }))
      : null

    return {
      segmentPlan,
      mountedTopLevelRanges,
      mountedTopLevelRuntimeIds,
      topLevelRuntimeIds,
    }
  }, [
    renderingStrategyConfig,
    promotedSegmentIndex,
    selectedSegmentIndex,
    topLevelRuntimeIds,
  ])
}
