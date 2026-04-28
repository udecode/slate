import { executeCommand } from '../core/command-registry'
import { withTransaction } from '../core/public-state'
import type { Editor } from '../interfaces/editor'
import { Range } from '../interfaces/range'
import type { TextUnit } from '../types/types'
import type { WithEditorFirstArg } from '../utils/types'

type DeleteCommand = {
  direction: 'backward' | 'forward'
  type: 'delete'
  unit: TextUnit
}

const applyDeleteForward: WithEditorFirstArg<Editor['deleteForward']> = (
  editor,
  unit
) => {
  withTransaction(editor, (tx) => {
    const selection = tx.resolveTarget()

    if (selection && Range.isRange(selection) && Range.isCollapsed(selection)) {
      editor.delete({ unit })
    }
  })
}

export const deleteForward: WithEditorFirstArg<Editor['deleteForward']> = (
  editor,
  unit
) => {
  executeCommand<DeleteCommand>(
    editor,
    { direction: 'forward', type: 'delete', unit },
    (command) => {
      applyDeleteForward(editor, command.unit)
      return { handled: true }
    }
  )
}
