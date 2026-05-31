import type * as Y from 'yjs'

export const SUPPORTED_YJS_UNDO_MANAGER_VERSION = '13.6.30'

export type YjsUndoManagerStackItem = {
  meta: Map<unknown, unknown>
}

type YjsUndoManagerWithStacks = Y.UndoManager & {
  redoStack: YjsUndoManagerStackItem[]
  undoStack: YjsUndoManagerStackItem[]
}

const isStackItem = (value: unknown): value is YjsUndoManagerStackItem =>
  typeof value === 'object' &&
  value !== null &&
  (value as YjsUndoManagerStackItem).meta instanceof Map

const assertStack = (value: unknown, name: string) => {
  if (!Array.isArray(value) || value.some((item) => !isStackItem(item))) {
    throw new Error(
      `Unsupported Yjs UndoManager ${name} contract. @slate/yjs pins yjs@${SUPPORTED_YJS_UNDO_MANAGER_VERSION}.`
    )
  }

  return value
}

export const createYjsUndoManagerAdapter = (undoManager: Y.UndoManager) => {
  const manager = undoManager as YjsUndoManagerWithStacks
  const undo = () => assertStack(manager.undoStack, 'undo')
  const redo = () => assertStack(manager.redoStack, 'redo')

  return {
    moveRedoToUndo(item: YjsUndoManagerStackItem) {
      const stack = redo()
      const popped = stack.pop()

      if (popped !== item) {
        throw new Error('Cannot move a non-top redo item.')
      }

      undo().push(item)
    },
    moveUndoToRedo(item: YjsUndoManagerStackItem) {
      const stack = undo()
      const popped = stack.pop()

      if (popped !== item) {
        throw new Error('Cannot move a non-top undo item.')
      }

      redo().push(item)
    },
    peekRedo() {
      return redo().at(-1) ?? null
    },
    peekUndo() {
      return undo().at(-1) ?? null
    },
    storeUndoMeta(key: unknown, value: unknown) {
      undo().at(-1)?.meta.set(key, value)
    },
  }
}
