import { type ReactNode, useCallback, useMemo, useRef } from 'react'
import type { Operation, Path, RuntimeId, SnapshotChange } from 'slate'
import { NodeApi } from 'slate'
import { getSelectionRoot } from '../hooks/root-selection-cache'
import { useEditor } from '../hooks/use-editor'
import { useEditorSelector } from '../hooks/use-editor-selector'
import type { ReactRuntimeEditor } from '../plugin/react-editor'
import { recordSlateReactRender } from '../render-profiler'

export type DOMStrategyRootConfig = {
  overscan: number
  segmentSize: number
  previewChars: number
  threshold: number
}

const EMPTY_RUNTIME_IDS: readonly RuntimeId[] = []

type SegmentRuntimeIdGroup = {
  endIndex: number
  runtimeIds: readonly RuntimeId[]
  segmentIndex: number
  startIndex: number
}

const createSegmentRuntimeIdGroups = ({
  segmentSize,
  topLevelRuntimeIds,
}: {
  segmentSize: number
  topLevelRuntimeIds: readonly RuntimeId[]
}) => {
  const groups: SegmentRuntimeIdGroup[] = []

  for (
    let startIndex = 0, segmentIndex = 0;
    startIndex < topLevelRuntimeIds.length;
    startIndex += segmentSize, segmentIndex += 1
  ) {
    const endIndex = Math.min(
      topLevelRuntimeIds.length - 1,
      startIndex + segmentSize - 1
    )

    groups.push({
      endIndex,
      runtimeIds: topLevelRuntimeIds.slice(startIndex, endIndex + 1),
      segmentIndex,
      startIndex,
    })
  }

  return groups
}

const createSegmentPlanFromGroups = ({
  defaultActiveSegmentIndex,
  groups,
  overscan,
  promotedSegmentIndex,
}: {
  defaultActiveSegmentIndex: number
  groups: readonly SegmentRuntimeIdGroup[]
  overscan: number
  promotedSegmentIndex: number | null
}) => {
  const activeSegmentIndex = promotedSegmentIndex ?? defaultActiveSegmentIndex
  const activeStart = Math.max(0, activeSegmentIndex - overscan)
  const activeEnd = activeSegmentIndex + overscan

  return {
    activeSegmentIndex,
    segments: groups.map((group) => {
      const isActive =
        group.segmentIndex >= activeStart && group.segmentIndex <= activeEnd

      return {
        ...group,
        isActive,
        mountedRuntimeIds: isActive ? group.runtimeIds : EMPTY_RUNTIME_IDS,
      }
    }),
  }
}

const isTextOperation = (operation: Operation | undefined) =>
  operation?.type === 'insert_text' || operation?.type === 'remove_text'

const isSelectionOperation = (operation: Operation | undefined) =>
  operation?.type === 'set_selection'

const hasNoOperations = (operations: readonly Operation[] | undefined) =>
  !operations || operations.length === 0

const getOperationRoot = (operation: Operation) =>
  ((operation as { root?: string }).root ?? 'main') as string

const getChangedOperations = (
  operations?: readonly Operation[],
  change?: SnapshotChange
) => operations ?? change?.operations

const hasOperationForRoot = (root: string, operations?: readonly Operation[]) =>
  operations?.some((operation) => getOperationRoot(operation) === root)

const isRuntimeIdOperationForRoot = (operation: Operation, root: string) =>
  !isTextOperation(operation) &&
  !isSelectionOperation(operation) &&
  getOperationRoot(operation) === root

const isStructureOperationForRoot = (operation: Operation, root: string) =>
  !isTextOperation(operation) &&
  !isSelectionOperation(operation) &&
  getOperationRoot(operation) === root

const isSelectionChangeForRoot = (root: string, change: SnapshotChange) =>
  change.selectionChanged &&
  (getSelectionRoot(change.selectionBefore) === root ||
    getSelectionRoot(change.selectionAfter) === root)

const topLevelRangesIncludeIndex = (
  ranges: readonly (readonly [number, number])[] | null | undefined,
  index: number
) =>
  ranges == null ||
  ranges.some(([start, end]) => start <= index && end >= index)

const shouldUpdateRootRuntimeIds = (
  root: string,
  operations?: readonly Operation[],
  change?: SnapshotChange
) => {
  const changedOperations = getChangedOperations(operations, change)

  return change
    ? change.fullDocumentChanged ||
        ((change.rootRuntimeIdsChanged || change.topLevelOrderChanged) &&
          (changedOperations?.some((operation) =>
            isRuntimeIdOperationForRoot(operation, root)
          ) ??
            true))
    : hasNoOperations(changedOperations) ||
        (changedOperations ?? []).some((operation) =>
          isRuntimeIdOperationForRoot(operation, root)
        )
}

const shouldUpdateSelectedTopLevelIndex = (
  root: string,
  operations?: readonly Operation[],
  change?: SnapshotChange
) => {
  const changedOperations = getChangedOperations(operations, change)

  return change
    ? change.fullDocumentChanged ||
        isSelectionChangeForRoot(root, change) ||
        ((change.rootRuntimeIdsChanged || change.topLevelOrderChanged) &&
          (hasOperationForRoot(root, changedOperations) ?? true))
    : hasNoOperations(changedOperations) ||
        (changedOperations ?? []).some(
          (operation) =>
            isSelectionOperation(operation) || !isTextOperation(operation)
        )
}

const shouldUpdatePlaceholderValue = (
  root: string,
  operations?: readonly Operation[],
  change?: SnapshotChange
) => {
  const changedOperations = getChangedOperations(operations, change)
  const firstTopLevelChanged = topLevelRangesIncludeIndex(
    change?.dirtyTopLevelRanges,
    0
  )

  return change
    ? change.fullDocumentChanged ||
        ((change.topLevelOrderChanged ||
          ((change.textChanged || change.structureChanged) &&
            firstTopLevelChanged)) &&
          (hasOperationForRoot(root, changedOperations) ?? true))
    : hasNoOperations(changedOperations) ||
        (changedOperations ?? []).some(
          (operation) => !isSelectionOperation(operation)
        )
}

const shouldUpdateEditableRootCommit = (
  root: string,
  operations?: readonly Operation[],
  change?: SnapshotChange
) => {
  const changedOperations = getChangedOperations(operations, change)

  return change
    ? change.fullDocumentChanged ||
        ((change.rootRuntimeIdsChanged ||
          change.structureChanged ||
          change.topLevelOrderChanged) &&
          (changedOperations?.some((operation) =>
            isStructureOperationForRoot(operation, root)
          ) ??
            true)) ||
        change.dirtyStateKeys.length > 0
    : hasNoOperations(changedOperations) ||
        (changedOperations ?? []).some((operation) =>
          isStructureOperationForRoot(operation, root)
        )
}

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
    return state.nodes
      .children()
      .map((_node: unknown, index: number) => {
        const path = [index] as Path

        return state.runtime.idAt(path)
      })
      .filter(Boolean) as RuntimeId[]
  })
}

export const useRootRuntimeIds = () => {
  const editor = useEditor<ReactRuntimeEditor>()
  const root = editor.read((state) => state.view.root())
  const shouldUpdate = useCallback(
    (operations?: readonly Operation[], change?: SnapshotChange) =>
      shouldUpdateRootRuntimeIds(root, operations, change),
    [root]
  )

  return useEditorSelector(
    selectRootRuntimeIds,
    (left, right) => {
      return left != null && sameRuntimeIds(left as RuntimeId[], right)
    },
    {
      profileId: 'root-runtime-ids',
      shouldUpdate,
    }
  )
}

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
  const editor = useEditor<ReactRuntimeEditor>()
  const root = editor.read((state) => state.view.root())
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
      enabled && shouldUpdateSelectedTopLevelIndex(root, operations, change),
    [enabled, root]
  )

  return useEditorSelector(selector, Object.is, {
    profileId: 'top-level-selection-index',
    shouldUpdate,
  })
}

const sameSelectionPaths = (
  left: readonly Path[] | null,
  right: readonly Path[] | null
) =>
  left === right ||
  (left != null &&
    right != null &&
    left.length === right.length &&
    left.every(
      (leftPath, pathIndex) =>
        leftPath.length === right[pathIndex]!.length &&
        leftPath.every(
          (segment, segmentIndex) => segment === right[pathIndex]![segmentIndex]
        )
    ))

export const useSelectionPaths = (enabled: boolean) => {
  const editor = useEditor<ReactRuntimeEditor>()
  const root = editor.read((state) => state.view.root())
  const selector = useCallback(
    (editor: ReactRuntimeEditor) => {
      if (!enabled) {
        return null
      }

      const selection = editor.read((state) => state.selection.get())

      if (!selection) {
        return null
      }

      return [selection.anchor.path, selection.focus.path] as const
    },
    [enabled]
  )
  const shouldUpdate = useCallback(
    (operations?: readonly Operation[], change?: SnapshotChange) =>
      enabled && shouldUpdateSelectedTopLevelIndex(root, operations, change),
    [enabled, root]
  )

  return useEditorSelector(selector, sameSelectionPaths, {
    profileId: 'selection-paths',
    shouldUpdate,
  })
}

export const usePlaceholderValue = (placeholder?: ReactNode) => {
  const editor = useEditor<ReactRuntimeEditor>()
  const root = editor.read((state) => state.view.root())
  const selector = useCallback(
    (editor: ReactRuntimeEditor) =>
      editor.read(
        (state) =>
          placeholder &&
          state.nodes.children().length === 1 &&
          Array.from(NodeApi.texts(editor)).length === 1 &&
          NodeApi.string(editor) === ''
      )
        ? placeholder
        : undefined,
    [placeholder]
  )

  const shouldUpdate = useCallback(
    (operations?: readonly Operation[], change?: SnapshotChange) =>
      shouldUpdatePlaceholderValue(root, operations, change),
    [root]
  )

  return useEditorSelector(selector, Object.is, {
    profileId: 'placeholder',
    shouldUpdate,
  })
}

export const useEditableRootCommitWakeup = () => {
  const editor = useEditor<ReactRuntimeEditor>()
  const root = editor.read((state) => state.view.root())
  const shouldUpdate = useCallback(
    (operations?: readonly Operation[], change?: SnapshotChange) =>
      shouldUpdateEditableRootCommit(root, operations, change),
    [root]
  )

  useEditorSelector(
    (editor: ReactRuntimeEditor) =>
      editor.read((state) => state.value.lastCommit()?.version ?? 0),
    Object.is,
    {
      profileId: 'editable-root-commit',
      shouldUpdate,
    }
  )
}

export const useInternalSegmentDOMStrategyRootSources = ({
  internalSegmentDOMStrategyConfig,
  promotedSegmentIndex,
  promotedSegmentOverscan,
}: {
  internalSegmentDOMStrategyConfig: DOMStrategyRootConfig | null
  promotedSegmentIndex: number | null
  promotedSegmentOverscan?: number | null
}) => {
  const topLevelRuntimeIds = useRootRuntimeIds()
  const selectedTopLevelIndex = useTopLevelSelectionIndex(
    internalSegmentDOMStrategyConfig != null
  )
  const selectedSegmentIndex =
    internalSegmentDOMStrategyConfig && selectedTopLevelIndex != null
      ? Math.floor(
          selectedTopLevelIndex / internalSegmentDOMStrategyConfig.segmentSize
        )
      : 0
  const segmentRuntimeIdGroups = useMemo(
    () =>
      internalSegmentDOMStrategyConfig &&
      topLevelRuntimeIds.length >= internalSegmentDOMStrategyConfig.threshold
        ? createSegmentRuntimeIdGroups({
            segmentSize: internalSegmentDOMStrategyConfig.segmentSize,
            topLevelRuntimeIds,
          })
        : null,
    [internalSegmentDOMStrategyConfig, topLevelRuntimeIds]
  )

  return useMemo(() => {
    recordSlateReactRender({
      id: internalSegmentDOMStrategyConfig
        ? 'dom-strategy-root-sources'
        : 'root-sources',
      kind: 'root-plan',
    })

    const segmentPlan =
      internalSegmentDOMStrategyConfig && segmentRuntimeIdGroups
        ? createSegmentPlanFromGroups({
            overscan:
              promotedSegmentOverscan ??
              internalSegmentDOMStrategyConfig.overscan,
            defaultActiveSegmentIndex: selectedSegmentIndex,
            groups: segmentRuntimeIdGroups,
            promotedSegmentIndex,
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
    internalSegmentDOMStrategyConfig,
    promotedSegmentIndex,
    promotedSegmentOverscan,
    segmentRuntimeIdGroups,
    selectedSegmentIndex,
    topLevelRuntimeIds,
  ])
}
