import type { BaseSelection, Operation, RootKey } from 'slate'

const MAIN_ROOT_KEY: RootKey = 'main'

const getOperationRoot = (operation: Operation): RootKey =>
  ((operation as { root?: RootKey }).root ?? MAIN_ROOT_KEY) as RootKey

const cloneSelection = (selection: BaseSelection): BaseSelection =>
  selection
    ? {
        anchor: { ...selection.anchor },
        focus: { ...selection.focus },
      }
    : null

export const getSelectionRoot = (selection: BaseSelection): RootKey | null => {
  if (!selection) {
    return null
  }

  return (selection.anchor.root ??
    selection.focus.root ??
    MAIN_ROOT_KEY) as RootKey
}

export const createRootSelectionCache = () => {
  const selections = new Map<RootKey, BaseSelection>()

  return {
    get: (root: RootKey): BaseSelection =>
      cloneSelection(selections.get(root) ?? null),
    record: (selection: BaseSelection) => {
      const root = getSelectionRoot(selection)

      if (!selection || !root) {
        return
      }

      selections.set(root, cloneSelection(selection))
    },
    recordOperations: (operations: readonly Operation[]) => {
      for (const operation of operations) {
        if (
          operation.type !== 'insert_text' &&
          operation.type !== 'remove_text'
        ) {
          continue
        }

        const root = getOperationRoot(operation)
        const point = {
          offset:
            operation.type === 'insert_text'
              ? operation.offset + operation.text.length
              : operation.offset,
          path: [...operation.path],
          ...(root === MAIN_ROOT_KEY ? null : { root }),
        }

        selections.set(root, {
          anchor: point,
          focus: point,
        })
      }
    },
  }
}
