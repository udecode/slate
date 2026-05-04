import debounce from 'lodash/debounce'
import throttle from 'lodash/throttle'
import type { RefObject } from 'react'
import type { AndroidInputManager } from '../hooks/android-input-manager/android-input-manager'
import type { ReactEditor } from '../plugin/react-editor'
import type { DOMRepairQueue } from './dom-repair-queue'
import {
  beginEditableEventFrame,
  type EditableKeyDownKernelDecision,
  getEditableSelectionChangeOwnership,
  mapSelectionSourceToKernelState,
  recordEditableKernelTrace,
} from './editing-kernel'
import type { EditableInputController } from './input-state'
import { readLiveSelection } from './runtime-selection-state'
import {
  applyEditableDOMSelectionChange,
  completeEditableSelectionChangeImport,
  executeEditableSelectionImport,
  setEditableModelSelectionPreference,
  syncEditorSelectionFromDOM,
} from './selection-controller'

export type RuntimeSelectionChangeHandler = (() => void) & {
  cancel: () => void
  flush: () => void
}

export const createRuntimeSelectionChangeHandler = ({
  androidInputManagerRef,
  domRepairQueueRef,
  editor,
  inputController,
  processing,
  readOnly,
}: {
  androidInputManagerRef: RefObject<AndroidInputManager | null | undefined>
  domRepairQueueRef: RefObject<DOMRepairQueue | null>
  editor: ReactEditor
  inputController: EditableInputController
  processing: RefObject<boolean>
  readOnly: boolean
}): RuntimeSelectionChangeHandler => {
  let onDOMSelectionChange: RuntimeSelectionChangeHandler

  onDOMSelectionChange = throttle(() => {
    const selectionBefore = readLiveSelection(editor)
    const selectionChangeOrigin =
      inputController.state.selectionChangeOrigin ?? 'native-user'

    if (selectionChangeOrigin === 'repair-induced') {
      setEditableModelSelectionPreference({
        inputController,
        preferModelSelection: true,
        selectionSource: 'model-owned',
      })
    }

    const selectionSourceBefore = inputController.state.selectionSource
    const ownership = getEditableSelectionChangeOwnership({
      selectionChangeOrigin,
      selectionSource: selectionSourceBefore,
    })
    const frame = beginEditableEventFrame(editor, {
      eventFamily: 'selectionchange',
      focusOwner: 'editor',
      inputIntent: null,
      modelSelectionBefore: selectionBefore,
      selectionSource: selectionSourceBefore,
      targetOwner: 'editor',
    })

    domRepairQueueRef.current?.cancelBefore(frame.id)

    applyEditableDOMSelectionChange({
      androidInputManager: androidInputManagerRef.current,
      editor,
      inputController,
      processing,
      readOnly,
      rerunOnDirtyNodeMap: onDOMSelectionChange,
    })

    const selectionSourceAfter = inputController.state.selectionSource

    recordEditableKernelTrace({
      editor,
      trace: {
        command: null,
        eventFamily: 'selectionchange',
        intent: null,
        nativeAllowed: ownership === 'native-allowed',
        ownership,
        repair: null,
        selectionAfter: readLiveSelection(editor),
        selectionBefore,
        selectionChangeOrigin,
        selectionSource: selectionSourceAfter,
        stateAfter: mapSelectionSourceToKernelState(selectionSourceAfter),
        stateBefore: mapSelectionSourceToKernelState(selectionSourceBefore),
        targetOwner: 'editor',
      },
    })
    completeEditableSelectionChangeImport({
      inputController,
      selectionChangeOrigin,
    })
  }, 100) as RuntimeSelectionChangeHandler

  return onDOMSelectionChange
}

export const createRuntimeSelectionChangeScheduler = (
  onDOMSelectionChange: RuntimeSelectionChangeHandler
): RuntimeSelectionChangeHandler =>
  debounce(onDOMSelectionChange, 0) as RuntimeSelectionChangeHandler

export const createRuntimeSelectionImportController = ({
  editor,
  inputController,
  onDOMSelectionChange,
  scheduleOnDOMSelectionChange,
}: {
  editor: ReactEditor
  inputController: EditableInputController
  onDOMSelectionChange: RuntimeSelectionChangeHandler
  scheduleOnDOMSelectionChange: RuntimeSelectionChangeHandler
}) => ({
  applyKeyDownSelectionPolicy(decision: EditableKeyDownKernelDecision) {
    if (decision.selectionSourceTransition) {
      setEditableModelSelectionPreference({
        inputController,
        preferModelSelection:
          decision.selectionSourceTransition.preferModelSelection,
        selectionSource: decision.selectionSourceTransition.selectionSource,
      })
    }

    if (!decision.internalTarget) {
      executeEditableSelectionImport({
        importSelection: () => {
          syncEditorSelectionFromDOM({
            editor,
            ignoreModelSelectionPreference: decision.shouldForceDOMImport,
            inputController,
          })
        },
        selectionPolicy: decision.selectionPolicy,
      })
    }

    scheduleOnDOMSelectionChange.flush()
    onDOMSelectionChange.flush()
  },

  allowDOMSelectionImport(
    selectionPolicy: EditableKeyDownKernelDecision['selectionPolicy']
  ) {
    return executeEditableSelectionImport({
      importSelection: () => {},
      selectionPolicy,
    })
  },

  flushSelectionChange() {
    scheduleOnDOMSelectionChange.flush()
    onDOMSelectionChange.flush()
  },

  syncDOMSelectionFromRuntime() {
    syncEditorSelectionFromDOM({
      editor,
      inputController,
    })
  },
})

export type RuntimeSelectionImportController = ReturnType<
  typeof createRuntimeSelectionImportController
>
