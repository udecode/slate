import type { Editor, Operation } from 'slate'

type HistoryBatchLike = {
  operations?: Operation[]
  statePatches?: unknown[]
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

const operationsEqual = (a: Operation, b: Operation | undefined) =>
  !!b && JSON.stringify(a) === JSON.stringify(b)

const readEditorHistory = (editor: Editor): HistoryLike | null =>
  editor.read((state) => {
    const history = (state as HistoryStateView).history

    if (!history) {
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
) => {
  if (!stack || operations.length === 0) {
    return
  }

  for (let batchIndex = stack.length - 1; batchIndex >= 0; batchIndex -= 1) {
    const batch = stack[batchIndex]
    const batchOperations = batch?.operations

    if (!Array.isArray(batchOperations)) {
      throw new Error('Cannot remove rejected Yjs operations from history.')
    }

    if (batchOperations.length < operations.length) {
      continue
    }

    const start = batchOperations.length - operations.length

    if (
      operations.every((operation, index) =>
        operationsEqual(operation, batchOperations[start + index])
      )
    ) {
      batchOperations.splice(start, operations.length)

      if (
        batchOperations.length === 0 &&
        (batch.statePatches?.length ?? 0) === 0
      ) {
        stack.splice(batchIndex, 1)
      }

      return
    }
  }
}

export const removeRejectedYjsOperationsFromHistory = (
  editor: Editor,
  operations: readonly Operation[]
) => {
  const history = readEditorHistory(editor)

  if (!history) {
    return
  }

  removeOperationsFromHistoryStack(history.undos, operations)
  removeOperationsFromHistoryStack(history.redos, operations)
}

export const removeRejectedYjsOperationsFromHistoryAfterCommit = (
  editor: Editor,
  operations: readonly Operation[]
) => {
  const remove = () => {
    removeRejectedYjsOperationsFromHistory(editor, operations)
  }

  if (typeof queueMicrotask === 'function') {
    queueMicrotask(remove)
  } else {
    void Promise.resolve().then(remove)
  }
}
