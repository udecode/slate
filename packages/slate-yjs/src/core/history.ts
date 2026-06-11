import type { Editor, Operation } from 'slate'

import { isRecord } from './record'

type HistoryBatchLike = {
  operations?: Operation[]
  statePatches?: readonly unknown[]
}

type HistoryLike = {
  redos?: HistoryBatchLike[]
  undos?: HistoryBatchLike[]
}

type HistoryStateView = {
  history?: {
    redos?: () => HistoryBatchLike[]
    undos?: () => HistoryBatchLike[]
  }
}

const isHistoryState = (value: unknown): value is HistoryStateView =>
  isRecord(value) &&
  (value.history === undefined ||
    (isRecord(value.history) &&
      (value.history.redos === undefined ||
        typeof value.history.redos === 'function') &&
      (value.history.undos === undefined ||
        typeof value.history.undos === 'function')))

const operationSignature = (operation: Operation): string =>
  JSON.stringify(operation)

const operationMatchesSignature = (
  signature: string,
  operation: Operation | undefined
): boolean =>
  operation !== undefined && signature === operationSignature(operation)

const isEmptyHistoryBatch = (batch: HistoryBatchLike): boolean =>
  batch.operations?.length === 0 && (batch.statePatches?.length ?? 0) === 0

const getHistoryBatchOperationSuffixStart = (
  batchOperations: readonly Operation[],
  operationSignatures: readonly string[]
): number | null => {
  if (batchOperations.length < operationSignatures.length) {
    return null
  }

  const start = batchOperations.length - operationSignatures.length

  const matches = operationSignatures.every((signature, index) =>
    operationMatchesSignature(signature, batchOperations[start + index])
  )

  return matches ? start : null
}

const readEditorHistory = (editor: Editor): HistoryLike | null =>
  editor.read((state) => {
    const history = isHistoryState(state) ? state.history : undefined

    if (history === undefined) {
      return null
    }

    return {
      redos: history.redos?.(),
      undos: history.undos?.(),
    }
  })

const removeOperationsFromHistoryStack = (
  stack: HistoryBatchLike[] | undefined,
  operations: readonly Operation[]
): void => {
  if (stack === undefined || operations.length === 0) {
    return
  }

  const operationSignatures = operations.map(operationSignature)

  for (let batchIndex = stack.length - 1; batchIndex >= 0; batchIndex -= 1) {
    const batch = stack[batchIndex]
    const batchOperations = batch?.operations

    if (!Array.isArray(batchOperations)) {
      throw new Error('Cannot remove rejected Yjs operations from history.')
    }

    const start = getHistoryBatchOperationSuffixStart(
      batchOperations,
      operationSignatures
    )

    if (start !== null) {
      batchOperations.splice(start, operations.length)

      if (isEmptyHistoryBatch(batch)) {
        stack.splice(batchIndex, 1)
      }

      return
    }
  }
}

export const removeRejectedYjsOperationsFromHistory = (
  editor: Editor,
  operations: readonly Operation[]
): void => {
  const history = readEditorHistory(editor)

  if (history === null) {
    return
  }

  removeOperationsFromHistoryStack(history.undos, operations)
  removeOperationsFromHistoryStack(history.redos, operations)
}

export const removeRejectedYjsOperationsFromHistoryAfterCommit = (
  editor: Editor,
  operations: readonly Operation[]
): void => {
  const remove = (): void => {
    removeRejectedYjsOperationsFromHistory(editor, operations)
  }

  if (typeof queueMicrotask === 'function') {
    queueMicrotask(remove)
  } else {
    void Promise.resolve().then(remove)
  }
}
