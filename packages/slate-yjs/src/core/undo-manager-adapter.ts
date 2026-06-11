import type * as Y from 'yjs'

import { isRecord } from './record'

export const SUPPORTED_YJS_UNDO_MANAGER_VERSION = '13.6.30'

export type YjsUndoManagerStackItem = {
  readonly meta: Map<unknown, unknown>
}

export type YjsUndoManagerAdapter = {
  readonly moveRedoToUndo: (item: YjsUndoManagerStackItem) => void
  readonly moveUndoToRedo: (item: YjsUndoManagerStackItem) => void
  readonly peekRedo: () => YjsUndoManagerStackItem | null
  readonly peekUndo: () => YjsUndoManagerStackItem | null
  readonly redoDepth: () => number
  readonly storeUndoMeta: (key: unknown, value: unknown) => void
}

const isStackItem = (value: unknown): value is YjsUndoManagerStackItem =>
  isRecord(value) && value.meta instanceof Map

const assertStack = (
  value: unknown,
  name: string
): YjsUndoManagerStackItem[] => {
  if (!Array.isArray(value) || value.some((item) => !isStackItem(item))) {
    throw new Error(
      `Unsupported Yjs UndoManager ${name} contract. @slate/yjs pins yjs@${SUPPORTED_YJS_UNDO_MANAGER_VERSION}.`
    )
  }

  return value
}

const readUndoManagerStack = (
  undoManager: Y.UndoManager,
  name: 'redo' | 'undo'
): YjsUndoManagerStackItem[] => {
  const stack = isRecord(undoManager)
    ? name === 'undo'
      ? undoManager.undoStack
      : undoManager.redoStack
    : undefined

  return assertStack(stack, name)
}

const popExpectedStackItem = (
  stack: YjsUndoManagerStackItem[],
  item: YjsUndoManagerStackItem,
  message: string
): void => {
  const popped = stack.pop()

  if (popped !== item) {
    throw new Error(message)
  }
}

export const createYjsUndoManagerAdapter = (
  undoManager: Y.UndoManager
): YjsUndoManagerAdapter => {
  const undo = (): YjsUndoManagerStackItem[] =>
    readUndoManagerStack(undoManager, 'undo')
  const redo = (): YjsUndoManagerStackItem[] =>
    readUndoManagerStack(undoManager, 'redo')

  return {
    moveRedoToUndo(item: YjsUndoManagerStackItem) {
      const stack = redo()

      popExpectedStackItem(stack, item, 'Cannot move a non-top redo item.')
      undo().push(item)
    },
    moveUndoToRedo(item: YjsUndoManagerStackItem) {
      const stack = undo()

      popExpectedStackItem(stack, item, 'Cannot move a non-top undo item.')
      redo().push(item)
    },
    peekRedo() {
      return redo().at(-1) ?? null
    },
    peekUndo() {
      return undo().at(-1) ?? null
    },
    redoDepth() {
      return redo().length
    },
    storeUndoMeta(key: unknown, value: unknown) {
      undo().at(-1)?.meta.set(key, value)
    },
  }
}
