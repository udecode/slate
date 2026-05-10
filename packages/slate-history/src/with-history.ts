import {
  Operation,
  Path,
  Point,
  Range,
  type SnapshotChange,
  type ValueOf,
} from 'slate'
import { Editor, executeCommand } from 'slate/internal'

import type { Batch } from './history'
import { HistoryEditor } from './history-editor'

/**
 * The `withHistory` plugin keeps track of the operation history of a Slate
 * editor as operations are applied to it, using undo and redo stacks.
 *
 * TypeScript value generics are preserved from the editor passed to this
 * plugin.
 */

export const withHistory = <T extends Editor<any>>(
  editor: T
): T & HistoryEditor<ValueOf<T>> => {
  type HistoryValue = ValueOf<T>

  const e = editor as unknown as T & HistoryEditor<HistoryValue>
  e.history = { undos: [], redos: [] }
  let previousSnapshot = Editor.getSnapshot(e)

  const applyRedo = () => {
    const { history } = e
    const { redos } = history

    const batch = redos.at(-1)
    if (!batch) {
      return
    }

    HistoryEditor.withoutSaving(e, () => {
      e.update((tx) => {
        Editor.withoutNormalizing(e, () => {
          if (batch.selectionBefore) {
            tx.selection.set(batch.selectionBefore)
          }

          tx.operations.replay(batch.operations)
        })
      })
    })

    history.redos.pop()
    e.writeHistory('undos', batch)
  }

  const applyUndo = () => {
    const { history } = e
    const { undos } = history

    const batch = undos.at(-1)
    if (!batch) {
      return
    }

    HistoryEditor.withoutSaving(e, () => {
      e.update((tx) => {
        Editor.withoutNormalizing(e, () => {
          const inverseOps = batch.operations.map(Operation.inverse).reverse()

          tx.operations.replay(inverseOps)
          if (batch.selectionBefore) {
            tx.selection.set(batch.selectionBefore)
          }
        })
      })
    })

    e.writeHistory('redos', batch)
    history.undos.pop()
  }

  e.redo = () => {
    executeCommand(e, { type: 'history_redo' }, () => {
      applyRedo()
      return { handled: true }
    })
  }

  e.undo = () => {
    executeCommand(e, { type: 'history_undo' }, () => {
      applyUndo()
      return { handled: true }
    })
  }

  const unsubscribe = Editor.subscribe(e, (snapshot, change) => {
    const committedOps = [
      ...(change?.operations ?? []),
    ] as Operation<HistoryValue>[]

    if (committedOps.length === 0) {
      previousSnapshot = snapshot
      return
    }

    const { history } = e
    const { undos } = history
    const lastBatch = undos.at(-1)
    let save = HistoryEditor.isSaving(e)
    let merge = HistoryEditor.isMerging(e)

    if (save == null) {
      save = shouldSaveCommit(change, committedOps)
    }

    if (!save && shouldRebaseHistory(change)) {
      rebaseHistory(e.history.undos, committedOps)
      rebaseHistory(e.history.redos, committedOps)
    }

    if (save) {
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
          merge = shouldMergeBatch(committedOps, lastBatch.operations)
        }
      }

      if (HistoryEditor.isSplittingOnce(e)) {
        merge = false
        HistoryEditor.setSplittingOnce(e, undefined)
      }

      if (lastBatch && merge) {
        lastBatch.operations.push(...committedOps)
      } else {
        const batch = {
          operations: [...committedOps],
          selectionBefore: previousSnapshot.selection,
        }
        e.writeHistory('undos', batch)
      }

      while (undos.length > 100) {
        undos.shift()
      }

      history.redos = []
    }

    previousSnapshot = snapshot
  })

  e.writeHistory = (stack: 'undos' | 'redos', batch: any) => {
    e.history[stack].push(batch)
  }

  // Keep the subscription alive for the editor lifetime.
  void unsubscribe

  return e
}

/**
 * Check whether to merge an operation into the previous operation.
 */

const shouldMerge = (op: Operation, prev: Operation | undefined): boolean => {
  if (
    prev &&
    op.type === 'insert_text' &&
    prev.type === 'insert_text' &&
    op.offset === prev.offset + prev.text.length &&
    Path.equals(op.path, prev.path)
  ) {
    return true
  }

  if (
    prev &&
    op.type === 'remove_text' &&
    prev.type === 'remove_text' &&
    op.offset + op.text.length === prev.offset &&
    Path.equals(op.path, prev.path)
  ) {
    return true
  }

  return false
}

/**
 * Check whether an operation needs to be saved to the history.
 */

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
    const anchor = Point.transform(next.anchor, operation)

    if (!anchor) {
      return null
    }

    next.anchor = anchor
  }

  if (next.focus) {
    const focus = Point.transform(next.focus, operation)

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
): Range | null => (range == null ? null : Range.transform(range, operation))

const transformTextOperation = <HistoryValue extends ValueOf<Editor<any>>>(
  operation: Operation<HistoryValue> & {
    offset: number
    path: Path
  },
  applied: Operation
): Operation<HistoryValue> | null => {
  const point = Point.transform(
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
  } as Operation<HistoryValue>
}

const transformPathOperation = <HistoryValue extends ValueOf<Editor<any>>>(
  operation: Operation<HistoryValue> & { path: Path },
  applied: Operation
): Operation<HistoryValue> | null => {
  const path = Path.transform(operation.path, applied)

  if (!path) {
    return null
  }

  return { ...operation, path } as Operation<HistoryValue>
}

const transformChildIndex = (
  path: Path,
  index: number,
  applied: Operation
): number | null => {
  const indexedPath = path.concat(index)
  const nextPath = Path.transform(indexedPath, applied)

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

const transformOperation = <HistoryValue extends ValueOf<Editor<any>>>(
  operation: Operation<HistoryValue>,
  applied: Operation
): Operation<HistoryValue> | null => {
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

      const point = Point.transform(
        { path: operation.path, offset: operation.position },
        applied
      )

      if (!point) {
        return null
      }

      return { ...next, position: point.offset } as Operation<HistoryValue>
    }

    case 'move_node': {
      const path = Path.transform(operation.path, applied)
      const newPath = Path.transform(operation.newPath, applied)

      if (!path || !newPath) {
        return null
      }

      return { ...operation, path, newPath }
    }

    case 'replace_fragment': {
      const path = Path.transform(operation.path, applied)

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
      const path = Path.transform(operation.path, applied)

      if (!path) {
        return null
      }

      const index = transformChildIndex(path, operation.index, applied)

      if (index == null) {
        return null
      }

      return {
        ...operation,
        path,
        index,
        selection: transformRange(operation.selection, applied),
        newSelection: transformRange(operation.newSelection, applied),
      }
    }

    case 'set_selection': {
      return {
        ...operation,
        properties: transformSelectionPatch(operation.properties, applied),
        newProperties: transformSelectionPatch(
          operation.newProperties,
          applied
        ),
      } as Operation<HistoryValue>
    }

    default:
      return operation
  }
}

const rebaseBatch = <HistoryValue extends ValueOf<Editor<any>>>(
  batch: Batch<HistoryValue>,
  appliedOperations: readonly Operation[]
): Batch<HistoryValue> | null => {
  let operations = batch.operations
  let selectionBefore = batch.selectionBefore

  for (const appliedOperation of appliedOperations) {
    operations = operations
      .map((operation) => transformOperation(operation, appliedOperation))
      .filter((operation): operation is Operation<HistoryValue> =>
        Boolean(operation)
      )
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

const rebaseHistory = <HistoryValue extends ValueOf<Editor<any>>>(
  stack: Batch<HistoryValue>[],
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
