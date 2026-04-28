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

const applyDeleteBackward: WithEditorFirstArg<Editor['deleteBackward']> = (
  editor,
  unit
) => {
  withTransaction(editor, (tx) => {
    const selection = tx.resolveTarget()

    if (selection && Range.isRange(selection) && Range.isCollapsed(selection)) {
      editor.delete({ unit, reverse: true })
    }
  })
}

export const deleteBackward: WithEditorFirstArg<Editor['deleteBackward']> = (
  editor,
  unit
) => {
  executeCommand<DeleteCommand>(
    editor,
    { direction: 'backward', type: 'delete', unit },
    (command) => {
      applyDeleteBackward(editor, command.unit)
      return { handled: true }
    }
  )
}
