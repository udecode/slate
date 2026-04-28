import { type Operation, Range, type SnapshotChange } from 'slate'
import type { EditableInputController } from './input-state'

type SelectorListener = (
  operations?: readonly Operation[],
  change?: SnapshotChange
) => void

type SelectorSubscriptionOptions = {
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
    Range.isExpanded(modelSelection)
  ) {
    return true
  }

  return (
    inputController.state.selectionChangeOrigin !== 'native-user' &&
    inputController.state.selectionSource !== 'dom-current'
  )
}

export const shouldSyncModelSelectionAfterCommit = (
  _operations?: readonly Operation[],
  commit?: SnapshotChange
) => Boolean(commit?.selectionChanged || commit?.childrenChanged)

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
  syncDOMSelectionToEditor,
}: {
  addSelectorEventListener: AddSelectorEventListener
  getModelSelection?: () => Range | null
  inputController: EditableInputController
  scheduleDOMExport?: (callback: () => void) => void
  syncDOMSelectionToEditor: () => void
}) =>
  addSelectorEventListener(
    (_operations, commit) => {
      const sync = () => {
        if (
          !shouldExportModelSelectionToDOM(inputController, {
            commit,
            modelSelection: getModelSelection(),
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
      shouldUpdate: shouldSyncModelSelectionAfterCommit,
    }
  )
