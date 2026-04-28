import { Editor } from 'slate'

import { ReactEditor } from '../plugin/react-editor'
import type { DOMRepairQueue } from './dom-repair-queue'
import {
  type EditableCommand,
  type EditableRepairPolicy,
  getEditableRepairPolicy,
} from './editing-kernel'
import type {
  EditableInputController,
  EditableSelectionSourceTransition,
} from './input-state'
import { setEditableModelSelectionPreference } from './selection-controller'

export const applyModelOwnedHistoryIntent = ({
  direction,
  editor,
}: {
  direction: 'redo' | 'undo'
  editor: Editor
}) => {
  const maybeHistoryEditor: any = editor
  const fn = maybeHistoryEditor[direction]

  if (typeof fn !== 'function') {
    return false
  }

  fn()
  return true
}

export const shouldForceRenderAfterModelOwnedHistory = (editor: Editor) => {
  const commit = Editor.getLastCommit(editor)

  return (
    !commit ||
    commit.operations.some(
      (operation) =>
        operation.type !== 'insert_text' &&
        operation.type !== 'remove_text' &&
        operation.type !== 'set_selection'
    )
  )
}

export const applyModelOwnedNativeHistoryEvent = ({
  editor,
  event,
}: {
  editor: Editor
  event: InputEvent
}) => {
  if (
    event.inputType === 'historyUndo' &&
    applyModelOwnedHistoryIntent({ direction: 'undo', editor })
  ) {
    return true
  }
  if (
    event.inputType === 'historyRedo' &&
    applyModelOwnedHistoryIntent({ direction: 'redo', editor })
  ) {
    return true
  }
  return false
}

export const applyModelOwnedDeleteIntent = ({
  direction,
  editor,
  unit,
}: {
  direction: 'backward' | 'forward'
  editor: Editor
  unit?: 'block' | 'line' | 'word'
}) => {
  editor.update(() => {
    if (direction === 'backward') {
      Editor.deleteBackward(editor, unit ? { unit } : undefined)
      return
    }

    Editor.deleteForward(editor, unit ? { unit } : undefined)
  })
}

export const applyModelOwnedExpandedDelete = ({
  direction,
  editor,
}: {
  direction: 'backward' | 'forward'
  editor: Editor
}) => {
  editor.update(() => {
    Editor.deleteFragment(editor, { direction })
  })
}

export const applyModelOwnedLineBreak = ({
  editor,
  kind,
}: {
  editor: Editor
  kind: 'paragraph' | 'soft'
}) => {
  editor.update(() => {
    if (kind === 'paragraph') {
      Editor.insertBreak(editor)
      return
    }

    Editor.insertSoftBreak(editor)
  })
}

export const applyEditableCommand = ({
  command,
  editor,
}: {
  command: EditableCommand
  editor: Editor
}) => {
  switch (command.kind) {
    case 'delete':
      applyModelOwnedDeleteIntent({
        direction: command.direction,
        editor,
        unit: command.unit,
      })
      return true

    case 'delete-both':
      applyModelOwnedDeleteIntent({
        direction: 'backward',
        editor,
        unit: command.unit,
      })
      applyModelOwnedDeleteIntent({
        direction: 'forward',
        editor,
        unit: command.unit,
      })
      return true

    case 'delete-fragment':
      editor.update(() => {
        Editor.deleteFragment(
          editor,
          command.direction ? { direction: command.direction } : undefined
        )
      })
      return true

    case 'history':
      return applyModelOwnedHistoryIntent({
        direction: command.direction,
        editor,
      })

    case 'insert-break':
      applyModelOwnedLineBreak({
        editor,
        kind: command.variant,
      })
      return true

    case 'insert-data':
      editor.update(() => {
        ReactEditor.insertData(editor as ReactEditor, command.data)
      })
      return true

    case 'insert-text':
      editor.update(() => {
        Editor.insertText(editor, command.text)
      })
      return true

    case 'select':
    case 'select-all':
      editor.update(() => {
        editor.select(
          command.kind === 'select'
            ? command.selection
            : {
                anchor: Editor.start(editor, []),
                focus: Editor.end(editor, []),
              }
        )
      })
      return true

    case 'move-selection':
    case 'set-block':
    case 'toggle-mark':
      return false
  }
}

export const applyModelOwnedDataTransferInput = ({
  data,
  editor,
}: {
  data: DataTransfer
  editor: ReactEditor
}) => {
  editor.update(() => {
    ReactEditor.insertData(editor, data)
  })
}

export type EditableRepairRequest =
  | {
      focus?: boolean
      forceRender?: boolean
      kind: 'force-render' | 'sync-selection'
      selectionSourceTransition?: EditableSelectionSourceTransition
    }
  | {
      focus?: boolean
      forceRender?: boolean
      kind: 'repair-caret' | 'repair-caret-after-text-insert'
      selectionSourceTransition?: EditableSelectionSourceTransition
    }
  | { kind: 'none' | 'skip-dom-sync' }

export const executeEditableRepairPolicy = ({
  repair,
  repairPolicy,
}: {
  repair: () => void
  repairPolicy: EditableRepairPolicy
}) => {
  if (repairPolicy.kind === 'none') {
    return false
  }

  repair()
  return true
}

export const applyModelOwnedTextInput = ({
  data,
  editor,
  inputType,
}: {
  data: string
  editor: Editor
  inputType: string
}): EditableRepairRequest => {
  applyEditableCommand({
    command: { inputType, kind: 'insert-text', text: data },
    editor,
  })

  if (inputType === 'insertText') {
    return {
      kind: 'repair-caret-after-text-insert',
      selectionSourceTransition: {
        preferModelSelection: true,
        reason: 'model-command',
        selectionSource: 'model-owned',
      },
    }
  }

  return { kind: 'none' }
}

export const applyEditableRepairRequest = ({
  domRepairQueue,
  editor,
  forceRender,
  inputController,
  request,
  syncDOMSelectionToEditor,
}: {
  domRepairQueue: DOMRepairQueue
  editor: ReactEditor
  forceRender: () => void
  inputController: EditableInputController
  request: EditableRepairRequest
  syncDOMSelectionToEditor: () => void
}) => {
  if (request.kind === 'none' || request.kind === 'skip-dom-sync') {
    return
  }

  const repairPolicy = getEditableRepairPolicy({ repair: request })

  executeEditableRepairPolicy({
    repair: () => {
      if (
        'selectionSourceTransition' in request &&
        request.selectionSourceTransition
      ) {
        setEditableModelSelectionPreference({
          inputController,
          preferModelSelection:
            request.selectionSourceTransition.preferModelSelection,
          selectionSource: request.selectionSourceTransition.selectionSource,
        })
      }

      if ('focus' in request && request.focus) {
        ReactEditor.focus(editor)
      }

      if ('forceRender' in request && request.forceRender) {
        forceRender()
      }

      if (request.kind === 'sync-selection') {
        syncDOMSelectionToEditor()
        return
      }

      if (request.kind === 'repair-caret') {
        domRepairQueue.repair(repairPolicy)
        return
      }

      if (request.kind === 'repair-caret-after-text-insert') {
        domRepairQueue.repair(repairPolicy)
      }
    },
    repairPolicy,
  })
}
