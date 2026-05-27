import {
  defineEditorExtension,
  type Editor,
  type EditorExtensionSetupContext,
  type EditorStatePatch,
  type EditorUpdateTransaction,
  type Operation,
  OperationApi,
  type Path,
  PathApi,
  PointApi,
  type Range,
  RangeApi,
  type SnapshotChange,
  type Value,
} from 'slate'
import {
  applyStatePatches,
  executeCommand,
  getEditorOperationRoot,
  getEditorSelectionRoot,
  getOperationRoot,
  getRangeRoot as getRangeRootMeta,
  MAIN_ROOT_KEY,
  shouldSaveStatePatch,
} from 'slate/internal'

import type { Batch, History } from './history'

export type HistoryStateApi<V extends Value = Value> = {
  get: () => History<V>
  redos: () => readonly Batch<V>[]
  undos: () => readonly Batch<V>[]
}

export type HistoryTxApi = {
  redo: () => void
  undo: () => void
}

export type HistoryControlApi = {
  isMerging: () => boolean | undefined
  isSaving: () => boolean | undefined
  withMerging: (fn: () => void) => void
  withNewBatch: (fn: () => void) => void
  withoutMerging: (fn: () => void) => void
  withoutSaving: (fn: () => void) => void
}

export type HistoryOptions<TEnabled extends boolean | undefined = undefined> = {
  enabled?: TEnabled
}

declare module 'slate' {
  interface EditorStateExtensionGroups<V extends Value = Value> {
    history: HistoryStateApi<V>
  }

  interface EditorTxExtensionGroups<V extends Value = Value> {
    history: HistoryTxApi
  }
}

const HISTORY = new WeakMap<Editor, History>()
const SAVING = new WeakMap<Editor, boolean | undefined>()
const MERGING = new WeakMap<Editor, boolean | undefined>()
const SPLITTING_ONCE = new WeakMap<Editor, boolean | undefined>()
const WORD_INSERTION_TEXT = /^[\p{L}\p{N}_]+$/u

const getHistory = <V extends Value>(editor: Editor<V>): History<V> => {
  let history = HISTORY.get(editor) as History<V> | undefined

  if (!history) {
    history = { redos: [], undos: [] }
    HISTORY.set(editor, history as unknown as History)
  }

  return history
}

const writeHistory = <V extends Value>(
  editor: Editor<V>,
  stack: 'redos' | 'undos',
  batch: Batch<V>
) => {
  getHistory(editor)[stack].push(batch)
}

const isMerging = (editor: Editor): boolean | undefined => MERGING.get(editor)

const isSaving = (editor: Editor): boolean | undefined => SAVING.get(editor)

const isSplittingOnce = (editor: Editor): boolean | undefined =>
  SPLITTING_ONCE.get(editor)

const setSplittingOnce = (editor: Editor, value: boolean | undefined) => {
  SPLITTING_ONCE.set(editor, value)
}

const withMerging = (editor: Editor, fn: () => void): void => {
  const previous = isMerging(editor)
  MERGING.set(editor, true)
  try {
    fn()
  } finally {
    MERGING.set(editor, previous)
  }
}

const withNewBatch = (editor: Editor, fn: () => void): void => {
  const previous = isMerging(editor)
  MERGING.set(editor, true)
  SPLITTING_ONCE.set(editor, true)
  try {
    fn()
  } finally {
    MERGING.set(editor, previous)
    SPLITTING_ONCE.delete(editor)
  }
}

const withoutMerging = (editor: Editor, fn: () => void): void => {
  const previous = isMerging(editor)
  MERGING.set(editor, false)
  try {
    fn()
  } finally {
    MERGING.set(editor, previous)
  }
}

const withoutSaving = (editor: Editor, fn: () => void): void => {
  const previous = isSaving(editor)
  SAVING.set(editor, false)
  try {
    fn()
  } finally {
    SAVING.set(editor, previous)
  }
}

const runHistoricUpdate = <V extends Value>(
  editor: Editor<V>,
  batch: Batch<V>,
  fn: (tx: EditorUpdateTransaction<V>) => void
) => {
  const stateOnly =
    batch.operations.length === 0 && batch.statePatches.length > 0
  const preserveSelection =
    stateOnly || shouldPreserveHistoricDOMSelection(editor, batch)

  editor.update(fn, {
    metadata: {
      history: { mode: 'skip' },
      ...(preserveSelection
        ? {
            selection: {
              dom: 'preserve',
              focus: false,
              scroll: false,
            },
          }
        : {}),
    },
    tag: 'historic',
  })
}

const applyRedo = <V extends Value>(editor: Editor<V>) => {
  const history = getHistory(editor)
  const batch = history.redos.at(-1)

  if (!batch) {
    return
  }
  const root = getEditorOperationRoot(editor)

  runHistoricUpdate(editor, batch, (tx) => {
    const operations = filterHistoricSelectionOperations(batch.operations, root)

    if (shouldRestoreHistoricSelection(root, batch)) {
      restoreHistoricSelection(tx, batch, root)
    }
    applyStatePatches(editor, batch.statePatches, 'redo')
    tx.operations.replay(operations)
  })

  history.redos.pop()
  writeHistory(editor, 'undos', batch)
}

const applyUndo = <V extends Value>(editor: Editor<V>) => {
  const history = getHistory(editor)
  const batch = history.undos.at(-1)

  if (!batch) {
    return
  }
  const root = getEditorOperationRoot(editor)

  runHistoricUpdate(editor, batch, (tx) => {
    const inverseOps = batch.operations.map(OperationApi.inverse).reverse()
    const operations = filterHistoricSelectionOperations(inverseOps, root)

    applyStatePatches(editor, batch.statePatches, 'undo')
    tx.operations.replay(operations)
    if (shouldRestoreHistoricSelection(root, batch)) {
      restoreHistoricSelection(tx, batch, root)
    }
  })

  writeHistory(editor, 'redos', batch)
  history.undos.pop()
}

export const history = <const TEnabled extends boolean | undefined = undefined>(
  options: HistoryOptions<TEnabled> = {}
) => {
  const extension = {
    enabled: options.enabled as TEnabled,
    name: 'history',
    options,
    state: {
      history(_state: unknown, editor: Editor) {
        return {
          get: () => getHistory(editor),
          redos: () => getHistory(editor).redos,
          undos: () => getHistory(editor).undos,
        }
      },
    },
    tx: {
      history(_tx: unknown, editor: Editor) {
        return {
          redo() {
            executeCommand(editor, { type: 'history_redo' }, () => {
              applyRedo(editor)
              return { handled: true }
            })
          },
          undo() {
            executeCommand(editor, { type: 'history_undo' }, () => {
              applyUndo(editor)
              return { handled: true }
            })
          },
        }
      },
    },
    setup(context: EditorExtensionSetupContext<Editor>) {
      const editor = context.editor

      getHistory(editor)

      return {
        api: {
          history: {
            isMerging: () => isMerging(editor),
            isSaving: () => isSaving(editor),
            withMerging: (fn: () => void) => withMerging(editor, fn),
            withNewBatch: (fn: () => void) => withNewBatch(editor, fn),
            withoutMerging: (fn: () => void) => withoutMerging(editor, fn),
            withoutSaving: (fn: () => void) => withoutSaving(editor, fn),
          },
        },
        cleanup() {
          HISTORY.delete(editor)
          SAVING.delete(editor)
          MERGING.delete(editor)
          SPLITTING_ONCE.delete(editor)
        },
        onCommit({ commit: change }: { commit: SnapshotChange }) {
          const committedOps = [...(change?.operations ?? [])]
          const committedStatePatches = [
            ...(change?.statePatches ?? []),
          ].filter((patch) => shouldSaveStatePatch(editor, patch))

          if (committedOps.length === 0 && committedStatePatches.length === 0) {
            return
          }

          const history = getHistory(editor)
          const { undos } = history
          const lastBatch = undos.at(-1)
          let save = isSaving(editor)
          let merge = isMerging(editor)

          if (save == null) {
            save = shouldSaveCommit(change, committedOps, committedStatePatches)
          }

          if (!save && shouldRebaseHistory(change, committedOps)) {
            rebaseHistory(history.undos, committedOps)
            rebaseHistory(history.redos, committedOps)
          }

          if (save) {
            const preparedBatch = prepareHistoryBatch(
              change?.selectionBefore ?? null,
              getEditorSelectionRoot(editor),
              committedOps,
              committedStatePatches
            )

            if (!preparedBatch) {
              return
            }

            if (merge == null) {
              if (lastBatch == null) {
                merge = false
              } else if (change?.metadata.history?.mode === 'push') {
                merge = false
              } else if (change?.metadata.history?.mode === 'merge') {
                merge = true
              } else if (change?.tags.includes('history-push')) {
                merge = false
              } else if (change?.tags.includes('history-merge')) {
                merge = true
              } else if (preparedBatch.statePatches.length > 0) {
                merge = false
              } else {
                merge = shouldMergeBatch(
                  preparedBatch.operations,
                  lastBatch.operations
                )
              }
            }

            if (isSplittingOnce(editor)) {
              merge = false
              setSplittingOnce(editor, undefined)
            }

            if (lastBatch && merge) {
              lastBatch.operations.push(...preparedBatch.operations)
              appendStatePatches(
                lastBatch.statePatches,
                preparedBatch.statePatches
              )
            } else {
              writeHistory(editor, 'undos', preparedBatch)
            }

            while (undos.length > 100) {
              undos.shift()
            }

            history.redos = []
          }
        },
      }
    },
  } as const

  return defineEditorExtension(extension)
}

const shouldMerge = (op: Operation, prev: Operation | undefined): boolean => {
  if (
    prev &&
    getOperationRoot(op) === getOperationRoot(prev) &&
    op.type === 'insert_text' &&
    prev.type === 'insert_text' &&
    op.offset === prev.offset + prev.text.length &&
    PathApi.equals(op.path, prev.path)
  ) {
    return true
  }

  if (
    prev &&
    getOperationRoot(op) === getOperationRoot(prev) &&
    op.type === 'remove_text' &&
    prev.type === 'remove_text' &&
    op.offset + op.text.length === prev.offset &&
    PathApi.equals(op.path, prev.path)
  ) {
    return true
  }

  return false
}

const shouldMergeBatch = (
  operations: readonly Operation[],
  previousOperations: readonly Operation[]
): boolean => {
  const saveableOperations = operations.filter(shouldSave)
  const previousSaveableOperations = previousOperations.filter(shouldSave)
  const previousOperation = previousSaveableOperations.at(-1)
  const previousRoot = previousOperation
    ? getOperationRoot(previousOperation)
    : MAIN_ROOT_KEY
  const previousBatchIsTextOnly =
    previousOperation != null &&
    previousSaveableOperations.every(
      (operation) =>
        operation.type === previousOperation.type &&
        getOperationRoot(operation) === previousRoot
    )

  if (saveableOperations.length !== 1) {
    return false
  }

  const operation = saveableOperations[0]!

  if (previousBatchIsTextOnly && shouldMerge(operation, previousOperation)) {
    return true
  }

  if (
    shouldMergeInsertIntoTextReplacementBatch(
      operation,
      previousOperation,
      previousSaveableOperations
    )
  ) {
    return true
  }

  if (
    shouldMergeWordInsertIntoSplitStartedBatch(
      operation,
      previousOperation,
      previousSaveableOperations
    )
  ) {
    return true
  }

  return shouldMergeInsertIntoSplitBatch(operation, previousSaveableOperations)
}

const isWordInsertionText = (text: string) => WORD_INSERTION_TEXT.test(text)

const shouldMergeInsertIntoTextReplacementBatch = (
  operation: Operation,
  previousOperation: Operation | undefined,
  previousOperations: readonly Operation[]
) => {
  if (
    operation.type !== 'insert_text' ||
    previousOperation?.type !== 'insert_text' ||
    !shouldMerge(operation, previousOperation)
  ) {
    return false
  }

  const firstReplacementInsert = previousOperations.find(
    (previous) =>
      previous.type === 'insert_text' &&
      getOperationRoot(previous) === getOperationRoot(operation) &&
      PathApi.equals(previous.path, operation.path)
  )

  if (
    !firstReplacementInsert ||
    firstReplacementInsert.type !== 'insert_text'
  ) {
    return false
  }

  return previousOperations.some(
    (previous) =>
      previous.type === 'remove_text' &&
      getOperationRoot(previous) === getOperationRoot(operation) &&
      previous.offset === firstReplacementInsert.offset &&
      PathApi.equals(previous.path, firstReplacementInsert.path)
  )
}

const hasSplitOperation = (operations: readonly Operation[]) =>
  operations.some((operation) => operation.type === 'split_node')

const shouldMergeWordInsertIntoSplitStartedBatch = (
  operation: Operation,
  previousOperation: Operation | undefined,
  previousOperations: readonly Operation[]
) =>
  operation.type === 'insert_text' &&
  previousOperation?.type === 'insert_text' &&
  shouldMerge(operation, previousOperation) &&
  isWordInsertionText(operation.text) &&
  isWordInsertionText(previousOperation.text) &&
  hasSplitOperation(previousOperations)

const shouldMergeInsertIntoSplitBatch = (
  operation: Operation,
  previousOperations: readonly Operation[]
): boolean => {
  if (operation.type !== 'insert_text' || operation.offset !== 0) {
    return false
  }

  const operationRoot = getOperationRoot(operation)

  return previousOperations.some((previousOperation) => {
    if (
      previousOperation.type !== 'split_node' ||
      getOperationRoot(previousOperation) !== operationRoot
    ) {
      return false
    }

    const splitIndex = previousOperation.path.at(-1)

    if (splitIndex == null) {
      return false
    }

    const insertedPath = [
      ...previousOperation.path.slice(0, -1),
      splitIndex + 1,
    ]

    return PathApi.isAncestor(insertedPath, operation.path)
  })
}

const shouldSave = (op: Operation): boolean => {
  if (op.type === 'set_selection') {
    return false
  }

  return true
}

const shouldSaveBatch = (operations: readonly Operation[]): boolean =>
  operations.some((operation) => shouldSave(operation))

const isSameOperationRoot = (operation: Operation, applied: Operation) =>
  getOperationRoot(operation) === getOperationRoot(applied)

const cloneStatePatches = (
  statePatches: readonly EditorStatePatch[]
): EditorStatePatch[] => statePatches.map((patch) => structuredClone(patch))

const isFullStatePatch = (
  patch: EditorStatePatch
): patch is EditorStatePatch & { value: unknown } =>
  Object.hasOwn(patch, 'value')

const appendStatePatches = (
  target: EditorStatePatch[],
  statePatches: readonly EditorStatePatch[]
) => {
  for (const patch of statePatches) {
    const existingPatch = target.find(({ key }) => key === patch.key)

    if (
      existingPatch &&
      isFullStatePatch(existingPatch) &&
      isFullStatePatch(patch)
    ) {
      existingPatch.value = structuredClone(patch.value)
    } else {
      target.push(structuredClone(patch))
    }
  }
}

const clonePoint = (point: Range['anchor'], root?: string): Range['anchor'] => {
  const nextRoot = point.root ?? root

  return {
    offset: point.offset,
    path: [...point.path],
    ...(nextRoot && nextRoot !== MAIN_ROOT_KEY ? { root: nextRoot } : {}),
  }
}

const cloneRange = (range: Range | null, root?: string): Range | null =>
  range
    ? {
        anchor: clonePoint(range.anchor, root),
        focus: clonePoint(range.focus, root),
      }
    : null

const getRangeRoot = (range: Range | null): string | undefined =>
  range ? (getRangeRootMeta(range).root ?? undefined) : undefined

const getRangeRootOrMain = (range: Range | null): string =>
  getRangeRoot(range) ?? MAIN_ROOT_KEY

const getOperationRootOrMain = (operation: Operation): string =>
  getOperationRoot(operation)

const getBatchOperationRoot = <V extends Value>(
  batch: Batch<V>
): string | undefined => {
  let root: string | undefined

  for (const operation of batch.operations) {
    const operationRoot = getOperationRootOrMain(operation)

    if (root === undefined) {
      root = operationRoot
      continue
    }

    if (root !== operationRoot) {
      return undefined
    }
  }

  return root
}

const getHistoricSelectionRoot = <V extends Value>(
  batch: Batch<V>
): string | undefined => {
  const selectionRoot = getRangeRoot(batch.selectionBefore)

  if (selectionRoot) {
    return selectionRoot
  }

  if (batch.selectionBefore == null) {
    return getBatchOperationRoot(batch)
  }

  return batch.selectionBeforeRoot ?? MAIN_ROOT_KEY
}

const batchHasOperationRoot = <V extends Value>(
  batch: Batch<V>,
  root: string
) =>
  batch.operations.some(
    (operation) => getOperationRootOrMain(operation) === root
  )

const filterHistoricSelectionOperations = <V extends Value>(
  operations: readonly Operation<V>[],
  root: string
) =>
  operations.filter(
    (operation) =>
      operation.type !== 'set_selection' ||
      getOperationRootOrMain(operation) === root
  )

const shouldPreserveHistoricDOMSelection = <V extends Value>(
  editor: Editor<V>,
  batch: Batch<V>
) =>
  batch.operations.length > 0 &&
  !batchHasOperationRoot(batch, getEditorOperationRoot(editor))

const shouldRestoreHistoricSelection = <V extends Value>(
  root: string,
  batch: Batch<V>
) => {
  const selectionRoot = getHistoricSelectionRoot(batch)

  return (
    batch.operations.length > 0 &&
    selectionRoot === root &&
    batchHasOperationRoot(batch, root)
  )
}

const createHistoricSelectionOperation = <V extends Value>(
  previous: Range | null,
  next: Range | null,
  root: string
): Extract<Operation<V>, { type: 'set_selection' }> | null => {
  if (previous == null && next == null) {
    return null
  }

  if (previous == null) {
    return {
      newProperties: cloneRange(next)!,
      properties: null,
      root,
      type: 'set_selection',
    }
  }

  if (next == null) {
    return {
      newProperties: null,
      properties: cloneRange(previous)!,
      root,
      type: 'set_selection',
    }
  }

  if (RangeApi.equals(previous, next)) {
    return null
  }

  return {
    newProperties: cloneRange(next)!,
    properties: cloneRange(previous)!,
    root,
    type: 'set_selection',
  }
}

const restoreHistoricSelection = <V extends Value>(
  tx: EditorUpdateTransaction<V>,
  batch: Batch<V>,
  viewRoot: string
) => {
  const selection = batch.selectionBefore
  const root = getHistoricSelectionRoot(batch) ?? getRangeRootOrMain(selection)

  if (root === viewRoot && !getRangeRoot(selection)) {
    tx.selection.set(selection)
    return
  }

  const operation = createHistoricSelectionOperation<V>(
    tx.selection.get(),
    selection,
    root
  )

  if (operation) {
    tx.operations.replay([operation])
  }
}

const applySelectionPatch = (
  selection: Range | null,
  newProperties: Partial<Range> | null,
  root?: string
): Range | null => {
  if (newProperties == null) {
    return null
  }

  if (selection == null) {
    if (!(newProperties.anchor && newProperties.focus)) {
      throw new Error(
        `set_selection patch requires an existing selection or a full range. Received: ${JSON.stringify(
          newProperties
        )}`
      )
    }

    return cloneRange(newProperties as Range, root)
  }

  const next = cloneRange(selection)!

  if (Object.hasOwn(newProperties, 'anchor')) {
    if (!newProperties.anchor) {
      throw new Error('Cannot remove the "anchor" selection property')
    }

    next.anchor = clonePoint(newProperties.anchor, root)
  }

  if (Object.hasOwn(newProperties, 'focus')) {
    if (!newProperties.focus) {
      throw new Error('Cannot remove the "focus" selection property')
    }

    next.focus = clonePoint(newProperties.focus, root)
  }

  return next
}

const prepareHistoryBatch = <V extends Value>(
  selectionBefore: Range | null,
  selectionBeforeRoot: string | undefined,
  operations: readonly Operation<V>[],
  statePatches: readonly EditorStatePatch[]
): Batch<V> | null => {
  const firstSaveableIndex = operations.findIndex(shouldSave)
  const getBatchSelectionBeforeRoot = (selection: Range | null) =>
    selection ? (getRangeRoot(selection) ?? selectionBeforeRoot) : undefined
  const createBatch = (
    batchOperations: Operation<V>[],
    batchSelectionBefore: Range | null,
    batchSelectionBeforeRoot: string | undefined
  ): Batch<V> => {
    const batch: Batch<V> = {
      operations: batchOperations,
      selectionBefore: batchSelectionBefore,
      statePatches: cloneStatePatches(statePatches),
    }

    if (batchSelectionBeforeRoot !== undefined) {
      batch.selectionBeforeRoot = batchSelectionBeforeRoot
    }

    return batch
  }

  if (firstSaveableIndex === -1) {
    return statePatches.length === 0
      ? null
      : createBatch(
          [],
          cloneRange(selectionBefore),
          getBatchSelectionBeforeRoot(selectionBefore)
        )
  }

  let batchSelectionBefore = cloneRange(selectionBefore)
  let batchSelectionBeforeRoot =
    getBatchSelectionBeforeRoot(batchSelectionBefore)

  for (let index = 0; index < firstSaveableIndex; index++) {
    const operation = operations[index]!

    if (operation.type === 'set_selection') {
      batchSelectionBefore = applySelectionPatch(
        batchSelectionBefore,
        operation.newProperties,
        operation.root
      )
      batchSelectionBeforeRoot = batchSelectionBefore
        ? (getRangeRoot(batchSelectionBefore) ??
          operation.root ??
          batchSelectionBeforeRoot)
        : undefined
    }
  }

  return createBatch(
    [...operations.slice(firstSaveableIndex)],
    batchSelectionBefore,
    batchSelectionBeforeRoot
  )
}

const shouldSaveCommit = (
  change: SnapshotChange | undefined,
  operations: readonly Operation[],
  statePatches: readonly EditorStatePatch[]
): boolean => {
  if (change?.metadata.history?.mode === 'skip') {
    return false
  }

  if (change?.metadata.collab?.saveToHistory === false) {
    return false
  }

  if (
    change?.metadata.collab?.origin === 'remote' &&
    change.metadata.collab.saveToHistory !== true
  ) {
    return false
  }

  if (change?.tags.includes('historic')) {
    return false
  }

  return statePatches.length > 0 || shouldSaveBatch(operations)
}

const shouldRebaseHistory = (
  change: SnapshotChange | undefined,
  operations: readonly Operation[]
): boolean => !change?.tags.includes('historic') && shouldSaveBatch(operations)

const transformSelectionPatch = (
  selection: Partial<Range> | null,
  operation: Operation,
  root?: string
): Partial<Range> | null => {
  if (selection == null) {
    return null
  }

  const next = { ...selection }

  if (next.anchor) {
    const anchor = PointApi.transform(clonePoint(next.anchor, root), operation)

    if (!anchor) {
      return null
    }

    next.anchor = anchor
  }

  if (next.focus) {
    const focus = PointApi.transform(clonePoint(next.focus, root), operation)

    if (!focus) {
      return null
    }

    next.focus = focus
  }

  return next
}

const transformRange = (
  range: Range | null,
  operation: Operation,
  root?: string
): Range | null =>
  range == null ? null : RangeApi.transform(cloneRange(range, root)!, operation)

const transformTextOperation = <V extends Value>(
  operation: Operation<V> & {
    offset: number
    path: Path
  },
  applied: Operation
): Operation<V> | null => {
  if (!isSameOperationRoot(operation, applied)) {
    return operation
  }

  const point = PointApi.transform(
    {
      path: operation.path,
      offset: operation.offset,
      root: getOperationRoot(operation),
    },
    applied
  )

  if (!point) {
    return null
  }

  return {
    ...operation,
    path: point.path,
    offset: point.offset,
  } as Operation<V>
}

const transformPathOperation = <V extends Value>(
  operation: Operation<V> & { path: Path },
  applied: Operation
): Operation<V> | null => {
  if (!isSameOperationRoot(operation, applied)) {
    return operation
  }

  const path = PathApi.transform(operation.path, applied)

  if (!path) {
    return null
  }

  return { ...operation, path } as Operation<V>
}

const transformChildIndex = (
  originalPath: Path,
  path: Path,
  index: number,
  applied: Operation
): number | null => {
  const indexedPath = originalPath.concat(index)
  const nextPath = PathApi.transform(indexedPath, applied)

  if (!nextPath) {
    return null
  }

  for (let i = 0; i < path.length; i++) {
    if (nextPath[i] !== path[i]) {
      return null
    }
  }

  return nextPath[path.length] ?? index
}

const transformOperation = <V extends Value>(
  operation: Operation<V>,
  applied: Operation
): Operation<V> | null => {
  if (!isSameOperationRoot(operation, applied)) {
    return operation
  }

  switch (operation.type) {
    case 'insert_text':
    case 'remove_text':
      return transformTextOperation(operation, applied)

    case 'insert_node':
    case 'remove_node':
    case 'set_node':
      return transformPathOperation(operation, applied)

    case 'merge_node':
    case 'split_node': {
      const next = transformPathOperation(operation, applied)

      if (!next) {
        return null
      }

      if (applied.type !== 'insert_text' && applied.type !== 'remove_text') {
        return next
      }

      const point = PointApi.transform(
        {
          path: operation.path,
          offset: operation.position,
          root: getOperationRoot(operation),
        },
        applied
      )

      if (!point) {
        return null
      }

      return { ...next, position: point.offset } as Operation<V>
    }

    case 'move_node': {
      const path = PathApi.transform(operation.path, applied)
      const newPath = PathApi.transform(operation.newPath, applied)

      if (!path || !newPath) {
        return null
      }

      return { ...operation, path, newPath }
    }

    case 'replace_fragment': {
      const path = PathApi.transform(operation.path, applied)

      if (!path) {
        return null
      }

      return {
        ...operation,
        path,
        selection: transformRange(
          operation.selection,
          applied,
          getOperationRoot(operation)
        ),
        newSelection: transformRange(
          operation.newSelection,
          applied,
          getOperationRoot(operation)
        ),
      }
    }

    case 'replace_children': {
      const path = PathApi.transform(operation.path, applied)

      if (!path) {
        return null
      }

      const index = transformChildIndex(
        operation.path,
        path,
        operation.index,
        applied
      )

      if (index == null) {
        return null
      }

      return {
        ...operation,
        index,
        newSelection: transformRange(
          operation.newSelection,
          applied,
          getOperationRoot(operation)
        ),
        path,
        selection: transformRange(
          operation.selection,
          applied,
          getOperationRoot(operation)
        ),
      }
    }

    case 'set_selection':
      return {
        ...operation,
        newProperties: transformSelectionPatch(
          operation.newProperties,
          applied,
          getOperationRoot(operation)
        ),
        properties: transformSelectionPatch(
          operation.properties,
          applied,
          getOperationRoot(operation)
        ),
      } as Operation<V>

    default:
      return operation
  }
}

const rebaseBatch = <V extends Value>(
  batch: Batch<V>,
  appliedOperations: readonly Operation[]
): Batch<V> | null => {
  let operations = batch.operations
  let selectionBefore = batch.selectionBefore
  let selectionBeforeRoot = batch.selectionBeforeRoot

  for (const appliedOperation of appliedOperations) {
    operations = operations
      .map((operation) => transformOperation(operation, appliedOperation))
      .filter((operation): operation is Operation<V> => Boolean(operation))
    selectionBefore = transformRange(
      selectionBefore,
      appliedOperation,
      selectionBeforeRoot
    )
    if (!selectionBefore) {
      selectionBeforeRoot = undefined
    }
  }

  if (operations.length === 0 && batch.statePatches.length === 0) {
    return null
  }

  const { selectionBeforeRoot: _selectionBeforeRoot, ...batchBase } = batch

  if (selectionBeforeRoot === undefined) {
    return {
      ...batchBase,
      operations,
      selectionBefore,
    }
  }

  return {
    ...batchBase,
    operations,
    selectionBefore,
    selectionBeforeRoot,
  }
}

const rebaseHistory = <V extends Value>(
  stack: Batch<V>[],
  appliedOperations: readonly Operation[]
) => {
  for (let index = stack.length - 1; index >= 0; index--) {
    const batch = rebaseBatch(stack[index]!, appliedOperations)

    if (batch) {
      stack[index] = batch
    } else {
      stack.splice(index, 1)
    }
  }
}
