import {
  defineEditorExtension,
  type Editor,
  type EditorExtensionSetupContext,
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
import { executeCommand } from 'slate/internal'

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
  fn: (tx: EditorUpdateTransaction<V>) => void
) => {
  editor.update(fn, {
    metadata: { history: { mode: 'skip' } },
    tag: 'historic',
  })
}

const applyRedo = <V extends Value>(editor: Editor<V>) => {
  const history = getHistory(editor)
  const batch = history.redos.at(-1)

  if (!batch) {
    return
  }

  runHistoricUpdate(editor, (tx) => {
    tx.selection.set(batch.selectionBefore)
    tx.operations.replay(batch.operations)
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

  runHistoricUpdate(editor, (tx) => {
    const inverseOps = batch.operations.map(OperationApi.inverse).reverse()

    tx.operations.replay(inverseOps)
    tx.selection.set(batch.selectionBefore)
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

          if (committedOps.length === 0) {
            return
          }

          const history = getHistory(editor)
          const { undos } = history
          const lastBatch = undos.at(-1)
          let save = isSaving(editor)
          let merge = isMerging(editor)

          if (save == null) {
            save = shouldSaveCommit(change, committedOps)
          }

          if (!save && shouldRebaseHistory(change)) {
            rebaseHistory(history.undos, committedOps)
            rebaseHistory(history.redos, committedOps)
          }

          if (save) {
            const preparedBatch = prepareHistoryBatch(
              change?.selectionBefore ?? null,
              committedOps
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
    op.type === 'insert_text' &&
    prev.type === 'insert_text' &&
    op.offset === prev.offset + prev.text.length &&
    PathApi.equals(op.path, prev.path)
  ) {
    return true
  }

  if (
    prev &&
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
  const previousBatchIsTextOnly =
    previousOperation != null &&
    previousSaveableOperations.every(
      (operation) => operation.type === previousOperation.type
    )

  return saveableOperations.length === 1
    ? previousBatchIsTextOnly &&
        shouldMerge(saveableOperations[0]!, previousOperation)
    : false
}

const shouldSave = (op: Operation): boolean => {
  if (op.type === 'set_selection') {
    return false
  }

  return true
}

const shouldSaveBatch = (operations: readonly Operation[]): boolean =>
  operations.some((operation) => shouldSave(operation))

const clonePoint = (point: Range['anchor']): Range['anchor'] => ({
  offset: point.offset,
  path: [...point.path],
})

const cloneRange = (range: Range | null): Range | null =>
  range
    ? {
        anchor: clonePoint(range.anchor),
        focus: clonePoint(range.focus),
      }
    : null

const applySelectionPatch = (
  selection: Range | null,
  newProperties: Partial<Range> | null
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

    return cloneRange(newProperties as Range)
  }

  const next = cloneRange(selection)!

  if (Object.hasOwn(newProperties, 'anchor')) {
    if (!newProperties.anchor) {
      throw new Error('Cannot remove the "anchor" selection property')
    }

    next.anchor = clonePoint(newProperties.anchor)
  }

  if (Object.hasOwn(newProperties, 'focus')) {
    if (!newProperties.focus) {
      throw new Error('Cannot remove the "focus" selection property')
    }

    next.focus = clonePoint(newProperties.focus)
  }

  return next
}

const prepareHistoryBatch = <V extends Value>(
  selectionBefore: Range | null,
  operations: readonly Operation<V>[]
): Batch<V> | null => {
  const firstSaveableIndex = operations.findIndex(shouldSave)

  if (firstSaveableIndex === -1) {
    return null
  }

  let batchSelectionBefore = cloneRange(selectionBefore)

  for (let index = 0; index < firstSaveableIndex; index++) {
    const operation = operations[index]!

    if (operation.type === 'set_selection') {
      batchSelectionBefore = applySelectionPatch(
        batchSelectionBefore,
        operation.newProperties
      )
    }
  }

  return {
    operations: [...operations.slice(firstSaveableIndex)],
    selectionBefore: batchSelectionBefore,
  }
}

const shouldSaveCommit = (
  change: SnapshotChange | undefined,
  operations: readonly Operation[]
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

  return shouldSaveBatch(operations)
}

const shouldRebaseHistory = (change: SnapshotChange | undefined): boolean =>
  change?.metadata.collab?.origin === 'remote' ||
  change?.metadata.collab?.saveToHistory === false

const transformSelectionPatch = (
  selection: Partial<Range> | null,
  operation: Operation
): Partial<Range> | null => {
  if (selection == null) {
    return null
  }

  const next = { ...selection }

  if (next.anchor) {
    const anchor = PointApi.transform(next.anchor, operation)

    if (!anchor) {
      return null
    }

    next.anchor = anchor
  }

  if (next.focus) {
    const focus = PointApi.transform(next.focus, operation)

    if (!focus) {
      return null
    }

    next.focus = focus
  }

  return next
}

const transformRange = (
  range: Range | null,
  operation: Operation
): Range | null => (range == null ? null : RangeApi.transform(range, operation))

const transformTextOperation = <V extends Value>(
  operation: Operation<V> & {
    offset: number
    path: Path
  },
  applied: Operation
): Operation<V> | null => {
  const point = PointApi.transform(
    { path: operation.path, offset: operation.offset },
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
        { path: operation.path, offset: operation.position },
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
        selection: transformRange(operation.selection, applied),
        newSelection: transformRange(operation.newSelection, applied),
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
        newSelection: transformRange(operation.newSelection, applied),
        path,
        selection: transformRange(operation.selection, applied),
      }
    }

    case 'set_selection':
      return {
        ...operation,
        newProperties: transformSelectionPatch(
          operation.newProperties,
          applied
        ),
        properties: transformSelectionPatch(operation.properties, applied),
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

  for (const appliedOperation of appliedOperations) {
    operations = operations
      .map((operation) => transformOperation(operation, appliedOperation))
      .filter((operation): operation is Operation<V> => Boolean(operation))
    selectionBefore = transformRange(selectionBefore, appliedOperation)
  }

  if (operations.length === 0) {
    return null
  }

  return {
    ...batch,
    operations,
    selectionBefore,
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
