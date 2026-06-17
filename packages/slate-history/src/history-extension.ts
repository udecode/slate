import {
  defineEditorExtension,
  type Editor,
  type EditorCommit,
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
  type Value,
} from 'slate'
import {
  applyOperation,
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
  /** Read the complete undo/redo history object. */
  get: () => History<V>
  /** Read the redo stack. */
  redos: () => readonly Batch<V>[]
  /** Read the undo stack. */
  undos: () => readonly Batch<V>[]
}

export type HistoryTxApi = {
  /** Redo the next history batch inside the current transaction. */
  redo: () => void
  /** Undo the previous history batch inside the current transaction. */
  undo: () => void
}

export type HistoryControlApi = {
  /** Read whether new operations are currently merging into a previous batch. */
  isMerging: () => boolean | undefined
  /** Read whether new operations are currently saved to history. */
  isSaving: () => boolean | undefined
  /** Run updates that merge into the previous history batch. */
  withMerging: (fn: () => void) => void
  /** Run updates whose first operation starts a fresh history batch. */
  withNewBatch: (fn: () => void) => void
  /** Run updates that do not merge into the previous history batch. */
  withoutMerging: (fn: () => void) => void
  /** Run updates without saving operations or state patches to history. */
  withoutSaving: (fn: () => void) => void
}

export type HistoryOptions<TEnabled extends boolean | undefined = undefined> = {
  /** Disable history for an editor that installs history through a preset. */
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
    skipNormalize: true,
    tag: 'historic',
  })
}

const replayHistoricOperations = <V extends Value>(
  editor: Editor<V>,
  operations: readonly Operation<V>[]
) => {
  for (const operation of compactHistoricTextOperations(operations)) {
    applyOperation(editor, operation)
  }
}

const compactHistoricTextOperations = <V extends Value>(
  operations: readonly Operation<V>[]
): Operation<V>[] => {
  const compacted: Operation<V>[] = []

  for (const operation of operations) {
    const previous = compacted.at(-1)

    if (
      previous?.type === 'insert_text' &&
      operation.type === 'insert_text' &&
      getOperationRoot(previous) === getOperationRoot(operation) &&
      PathApi.equals(previous.path, operation.path) &&
      operation.offset === previous.offset + previous.text.length
    ) {
      previous.text += operation.text
      continue
    }

    if (
      previous?.type === 'remove_text' &&
      operation.type === 'remove_text' &&
      getOperationRoot(previous) === getOperationRoot(operation) &&
      PathApi.equals(previous.path, operation.path) &&
      operation.offset + operation.text.length === previous.offset
    ) {
      previous.offset = operation.offset
      previous.text = operation.text + previous.text
      continue
    }

    compacted.push(
      operation.type === 'insert_text' || operation.type === 'remove_text'
        ? ({ ...operation, path: [...operation.path] } as Operation<V>)
        : operation
    )
  }

  return compacted
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
    replayHistoricOperations(editor, operations)
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
    const operations = filterHistoricUndoOperations(inverseOps, root)

    applyStatePatches(editor, batch.statePatches, 'undo')
    replayHistoricOperations(editor, operations)
    if (shouldRestoreHistoricSelection(root, batch)) {
      restoreHistoricSelection(tx, batch, root)
    }
  })

  writeHistory(editor, 'redos', batch)
  history.undos.pop()
}

/**
 * Create the undo/redo history extension.
 */
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
              return true
            })
          },
          undo() {
            executeCommand(editor, { type: 'history_undo' }, () => {
              applyUndo(editor)
              return true
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
        onCommit({ commit: change }: { commit: EditorCommit }) {
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
              committedStatePatches,
              change.metadata
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
                merge = shouldMergeExplicitBatch(
                  preparedBatch.operations,
                  lastBatch,
                  change.metadata
                )
              } else if (change?.tags.includes('history-push')) {
                merge = false
              } else if (change?.tags.includes('history-merge')) {
                merge = true
              } else if (preparedBatch.statePatches.length > 0) {
                merge = false
              } else {
                merge = shouldMergeBatch(preparedBatch.operations, lastBatch)
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

const shouldMergeSelectedReplacementFollowup = (
  operation: Operation,
  previousBatch: Batch,
  previousSaveableOperations: readonly Operation[]
): boolean => {
  if (
    operation.type !== 'insert_text' ||
    previousBatch.statePatches.length > 0 ||
    !previousBatch.selectionBefore ||
    RangeApi.isCollapsed(previousBatch.selectionBefore)
  ) {
    return false
  }

  const previousOperation = previousSaveableOperations.at(-1)

  if (
    previousOperation?.type !== 'insert_text' ||
    !shouldMerge(operation, previousOperation)
  ) {
    return false
  }

  const previousRoot = getOperationRoot(previousOperation)
  const previousBatchSingleRoot = previousSaveableOperations.every(
    (previous) => getOperationRoot(previous) === previousRoot
  )
  const previousBatchDeletedSelection = previousSaveableOperations
    .slice(0, -1)
    .some(
      (previous) =>
        previous.type === 'remove_text' ||
        previous.type === 'remove_node' ||
        previous.type === 'merge_node'
    )

  return previousBatchSingleRoot && previousBatchDeletedSelection
}

const shouldMergeSetNodeBatch = (
  operation: Operation,
  previousSaveableOperations: readonly Operation[]
): boolean => {
  if (operation.type !== 'set_node') {
    return false
  }

  const previousRoot = getOperationRoot(operation)

  return (
    previousSaveableOperations.length > 0 &&
    previousSaveableOperations.every(
      (previous) =>
        previous.type === 'set_node' &&
        getOperationRoot(previous) === previousRoot &&
        PathApi.equals(previous.path, operation.path)
    )
  )
}

const shouldMergeBatch = (
  operations: readonly Operation[],
  previousBatch: Batch
): boolean => {
  const saveableOperations = operations.filter(shouldSave)
  const previousSaveableOperations = previousBatch.operations.filter(shouldSave)
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
  const previousBatchIsSingleTextPath =
    previousOperation != null &&
    (previousOperation.type === 'insert_text' ||
      previousOperation.type === 'remove_text') &&
    previousSaveableOperations.every(
      (operation) =>
        (operation.type === 'insert_text' ||
          operation.type === 'remove_text') &&
        getOperationRoot(operation) === previousRoot &&
        PathApi.equals(operation.path, previousOperation.path)
    )

  return saveableOperations.length === 1
    ? shouldMergeSelectedReplacementFollowup(
        saveableOperations[0]!,
        previousBatch,
        previousSaveableOperations
      ) ||
        shouldMergeSetNodeBatch(
          saveableOperations[0]!,
          previousSaveableOperations
        ) ||
        ((previousBatchIsTextOnly || previousBatchIsSingleTextPath) &&
          shouldMerge(saveableOperations[0]!, previousOperation))
    : false
}

const shouldMergeExplicitBatch = (
  operations: readonly Operation[],
  previousBatch: Batch,
  metadata: EditorCommit['metadata']
): boolean => {
  if (shouldMergeBatch(operations, previousBatch)) {
    return true
  }

  const saveableOperations = operations.filter(shouldSave)
  const previousSaveableOperations = previousBatch.operations.filter(shouldSave)

  if (
    saveableOperations.length === 0 ||
    previousSaveableOperations.length === 0 ||
    previousBatch.statePatches.length > 0
  ) {
    return false
  }

  const allSaveableOperations = [
    ...previousSaveableOperations,
    ...saveableOperations,
  ]
  const firstOperation = allSaveableOperations[0]!
  const root = getOperationRoot(firstOperation)
  const allOperationsShareRoot = allSaveableOperations.every(
    (operation) => getOperationRoot(operation) === root
  )

  if (!allOperationsShareRoot) {
    return false
  }

  if (metadata.origin?.kind !== 'native-text-input') {
    return true
  }

  if (
    firstOperation.type !== 'insert_text' &&
    firstOperation.type !== 'remove_text'
  ) {
    return false
  }

  const path = firstOperation.path

  const allOperationsShareTextPath = allSaveableOperations.every(
    (operation) =>
      (operation.type === 'insert_text' || operation.type === 'remove_text') &&
      getOperationRoot(operation) === root &&
      PathApi.equals(operation.path, path)
  )

  if (!allOperationsShareTextPath) {
    return false
  }

  return allSaveableOperations.every(
    (operation, index) =>
      index === 0 || shouldMerge(operation, allSaveableOperations[index - 1])
  )
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

const filterHistoricUndoOperations = <V extends Value>(
  operations: readonly Operation<V>[],
  root: string
) =>
  filterHistoricSelectionOperations(operations, root).filter(
    (operation) => operation.type !== 'set_selection'
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

const getCollapsedRangePoint = (range: Range | null) =>
  range && RangeApi.isCollapsed(range) ? range.anchor : null

const getPointRoot = (
  point: Range['anchor'],
  fallbackRoot: string | undefined
): string => point.root ?? fallbackRoot ?? MAIN_ROOT_KEY

const isPointOnTextInsert = <V extends Value>(
  point: Range['anchor'],
  root: string | undefined,
  operation: Extract<Operation<V>, { type: 'insert_text' }>
) =>
  getPointRoot(point, root) === getOperationRoot(operation) &&
  PathApi.equals(point.path, operation.path)

const createCollapsedRangeAtTextInsert = <V extends Value>(
  operation: Extract<Operation<V>, { type: 'insert_text' }>
): Range => {
  const root = getOperationRoot(operation)
  const point = {
    offset: operation.offset,
    path: [...operation.path],
    ...(root === MAIN_ROOT_KEY ? {} : { root }),
  }

  return {
    anchor: point,
    focus: point,
  }
}

const selectionTracksTextBurstEnd = <V extends Value>({
  firstSaveableIndex,
  operations,
  selectionBefore,
  selectionBeforeRoot,
}: {
  firstSaveableIndex: number
  operations: readonly Operation<V>[]
  selectionBefore: Range | null
  selectionBeforeRoot: string | undefined
}): boolean => {
  const firstSaveable = operations[firstSaveableIndex]

  if (firstSaveable?.type !== 'insert_text') {
    return false
  }

  let currentSelection = transformRange(
    selectionBefore,
    firstSaveable,
    selectionBeforeRoot
  )
  let currentSelectionRoot = currentSelection
    ? (getRangeRoot(currentSelection) ?? selectionBeforeRoot)
    : undefined

  for (const operation of operations.slice(firstSaveableIndex + 1)) {
    if (operation.type !== 'set_selection') {
      return false
    }

    currentSelection = applySelectionPatch(
      currentSelection,
      operation.newProperties,
      operation.root
    )
    currentSelectionRoot = currentSelection
      ? (getRangeRoot(currentSelection) ??
        operation.root ??
        currentSelectionRoot)
      : undefined
  }

  const point = getCollapsedRangePoint(currentSelection)

  return Boolean(
    point &&
      isPointOnTextInsert(point, currentSelectionRoot, firstSaveable) &&
      point.offset === firstSaveable.offset + firstSaveable.text.length
  )
}

const getTextBurstSelectionBefore = <V extends Value>({
  firstSaveableIndex,
  isNativeTextInput,
  operations,
  selectionBefore,
  selectionBeforeRoot,
}: {
  firstSaveableIndex: number
  isNativeTextInput: boolean
  operations: readonly Operation<V>[]
  selectionBefore: Range | null
  selectionBeforeRoot: string | undefined
}): { root: string | undefined; selection: Range } | null => {
  const firstSaveable = operations[firstSaveableIndex]

  if (firstSaveable?.type !== 'insert_text' || firstSaveable.text.length <= 1) {
    return null
  }

  const insertRoot = getOperationRoot(firstSaveable)
  const insertStart = firstSaveable.offset
  const insertEnd = insertStart + firstSaveable.text.length
  const selectionPoint = getCollapsedRangePoint(selectionBefore)

  if (
    firstSaveableIndex === 0 &&
    isNativeTextInput &&
    selectionPoint &&
    isPointOnTextInsert(selectionPoint, selectionBeforeRoot, firstSaveable) &&
    selectionPoint.offset >= insertStart &&
    selectionPoint.offset <= insertEnd &&
    selectionTracksTextBurstEnd({
      firstSaveableIndex,
      operations,
      selectionBefore,
      selectionBeforeRoot,
    })
  ) {
    return {
      root: insertRoot,
      selection: createCollapsedRangeAtTextInsert(firstSaveable),
    }
  }

  if (firstSaveableIndex === 0) {
    return null
  }

  if (!isNativeTextInput) {
    return null
  }

  let currentSelection = cloneRange(selectionBefore)
  let currentSelectionRoot = selectionBeforeRoot
  let previousOffset = insertStart

  for (let index = 0; index < firstSaveableIndex; index++) {
    const operation = operations[index]!

    if (operation.type !== 'set_selection') {
      return null
    }

    currentSelection = applySelectionPatch(
      currentSelection,
      operation.newProperties,
      operation.root
    )
    currentSelectionRoot = currentSelection
      ? (getRangeRoot(currentSelection) ??
        operation.root ??
        currentSelectionRoot)
      : undefined

    const point = getCollapsedRangePoint(currentSelection)
    const pointRoot = point
      ? (point.root ?? currentSelectionRoot ?? MAIN_ROOT_KEY)
      : undefined

    if (
      !point ||
      pointRoot !== insertRoot ||
      !PathApi.equals(point.path, firstSaveable.path) ||
      point.offset < insertStart ||
      point.offset > insertEnd ||
      point.offset < previousOffset
    ) {
      return null
    }

    previousOffset = point.offset
  }

  if (
    !selectionTracksTextBurstEnd({
      firstSaveableIndex,
      operations,
      selectionBefore: currentSelection,
      selectionBeforeRoot: currentSelectionRoot,
    })
  ) {
    return null
  }

  return {
    root: insertRoot,
    selection: createCollapsedRangeAtTextInsert(firstSaveable),
  }
}

const prepareHistoryBatch = <V extends Value>(
  selectionBefore: Range | null,
  selectionBeforeRoot: string | undefined,
  operations: readonly Operation<V>[],
  statePatches: readonly EditorStatePatch[],
  metadata: EditorCommit['metadata']
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
  const textBurstSelectionBefore = getTextBurstSelectionBefore({
    firstSaveableIndex,
    isNativeTextInput: metadata.origin?.kind === 'native-text-input',
    operations,
    selectionBefore,
    selectionBeforeRoot,
  })

  if (textBurstSelectionBefore) {
    return createBatch(
      [...operations.slice(firstSaveableIndex)],
      textBurstSelectionBefore.selection,
      textBurstSelectionBefore.root
    )
  }

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
  change: EditorCommit | undefined,
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
  change: EditorCommit | undefined,
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
  operation: Extract<Operation<V>, { type: 'insert_text' | 'remove_text' }>,
  applied: Operation
): Operation<V> | null => {
  if (!isSameOperationRoot(operation, applied)) {
    return operation
  }

  let text = operation.text

  if (
    operation.type === 'insert_text' &&
    applied.type === 'remove_text' &&
    PathApi.equals(operation.path, applied.path)
  ) {
    const operationStart = operation.offset
    const operationEnd = operation.offset + operation.text.length
    const appliedStart = applied.offset
    const appliedEnd = applied.offset + applied.text.length
    const overlapStart = Math.max(operationStart, appliedStart)
    const overlapEnd = Math.min(operationEnd, appliedEnd)

    if (overlapStart < overlapEnd) {
      text =
        operation.text.slice(0, overlapStart - operationStart) +
        operation.text.slice(overlapEnd - operationStart)

      if (text.length === 0) {
        return null
      }
    }
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
    text,
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
