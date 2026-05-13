import {
  type Operation,
  type Range,
  RangeApi,
  type SnapshotChange,
} from 'slate'
import type { EditableInputController } from './input-state'

type SelectorListener = (
  operations?: readonly Operation[],
  change?: SnapshotChange
) => void

type SelectorSubscriptionOptions = {
  profileId?: string
  shouldUpdate?: (
    operations?: readonly Operation[],
    change?: SnapshotChange
  ) => boolean
}

type AddSelectorEventListener = (
  listener: SelectorListener,
  options?: SelectorSubscriptionOptions
) => () => void

export const shouldExportModelSelectionToDOM = (
  inputController: EditableInputController,
  {
    commit,
    modelSelection,
  }: {
    commit?: SnapshotChange
    modelSelection?: Range | null
  } = {}
) => {
  if (
    commit?.command?.origin === 'command' &&
    commit?.childrenChanged &&
    modelSelection &&
    RangeApi.isExpanded(modelSelection)
  ) {
    return true
  }

  return (
    inputController.state.selectionChangeOrigin !== 'native-user' &&
    inputController.state.selectionSource !== 'dom-current'
  )
}

export const isTextInputSelectionHandledByCaretRepair = (
  inputController: EditableInputController,
  commit?: SnapshotChange
) =>
  Boolean(
    inputController.state.activeIntent === 'text-insert' &&
      !inputController.state.isComposing &&
      commit?.childrenChanged &&
      commit.selectionChanged &&
      !commit.fullDocumentChanged &&
      !commit.rootRuntimeIdsChanged &&
      !commit.structureChanged &&
      !commit.topLevelOrderChanged
  )

const isSyncedTextOnlySelectionCommit = (
  operations?: readonly Operation[],
  commit?: SnapshotChange,
  inputController?: EditableInputController
) => {
  if (
    !operations ||
    operations.length === 0 ||
    inputController?.state.isComposing ||
    !commit?.childrenChanged ||
    !commit.selectionChanged ||
    commit.fullDocumentChanged ||
    commit.rootRuntimeIdsChanged ||
    commit.structureChanged ||
    commit.topLevelOrderChanged
  ) {
    return false
  }

  let hasTextOperation = false

  for (const operation of operations) {
    if (operation.type === 'insert_text' || operation.type === 'remove_text') {
      hasTextOperation = true
      continue
    }

    if (operation.type === 'set_selection') {
      continue
    }

    return false
  }

  return hasTextOperation
}

export const shouldSyncModelSelectionAfterCommit = (
  _operations?: readonly Operation[],
  commit?: SnapshotChange,
  inputController?: EditableInputController
) => {
  if (
    inputController &&
    isTextInputSelectionHandledByCaretRepair(inputController, commit)
  ) {
    return false
  }

  if (isSyncedTextOnlySelectionCommit(_operations, commit, inputController)) {
    return false
  }

  return Boolean(
    commit?.selectionChanged ||
      commit?.fullDocumentChanged ||
      commit?.rootRuntimeIdsChanged ||
      commit?.structureChanged ||
      commit?.topLevelOrderChanged
  )
}

export const subscribeSelectionOnlyDOMExport = ({
  addSelectorEventListener,
  getModelSelection = () => null,
  inputController,
  scheduleDOMExport = (callback) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(callback)
      return
    }

    setTimeout(callback)
  },
  shouldSkipDOMExport,
  syncDOMSelectionToEditor,
}: {
  addSelectorEventListener: AddSelectorEventListener
  getModelSelection?: () => Range | null
  inputController: EditableInputController
  scheduleDOMExport?: (callback: () => void) => void
  shouldSkipDOMExport?: (
    selection: Range | null,
    commit?: SnapshotChange
  ) => boolean
  syncDOMSelectionToEditor: () => void
}) =>
  addSelectorEventListener(
    (_operations, commit) => {
      const sync = () => {
        const modelSelection = getModelSelection()

        if (shouldSkipDOMExport?.(modelSelection, commit)) {
          return
        }

        if (
          !shouldExportModelSelectionToDOM(inputController, {
            commit,
            modelSelection,
          })
        ) {
          return
        }

        syncDOMSelectionToEditor()
      }

      if (commit?.childrenChanged) {
        scheduleDOMExport(sync)
      } else {
        sync()
      }
    },
    {
      profileId: 'selection-dom-export',
      shouldUpdate: (operations, commit) =>
        shouldSyncModelSelectionAfterCommit(
          operations,
          commit,
          inputController
        ),
    }
  )
