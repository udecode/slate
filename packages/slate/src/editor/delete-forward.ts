import { executeCommand } from '../core/command-registry'
import { runEditorTransaction } from '../core/public-state'
import { getEditorTransformRegistry } from '../core/transform-registry'
import type { EditorTransformApi } from '../interfaces/editor'
import { Range } from '../interfaces/range'
import type { TextUnit } from '../types/types'
import type { WithEditorFirstArg } from '../utils/types'

type DeleteCommand = {
  direction: 'backward' | 'forward'
  type: 'delete'
  unit: TextUnit
}

const applyDeleteForward: WithEditorFirstArg<
  EditorTransformApi['deleteForward']
> = (editor, unit) => {
  runEditorTransaction(editor, (tx) => {
    const selection = tx.resolveTarget()

    if (selection && Range.isRange(selection) && Range.isCollapsed(selection)) {
      getEditorTransformRegistry(editor).delete({ unit })
    }
  })
}

export const deleteForward: WithEditorFirstArg<
  EditorTransformApi['deleteForward']
> = (editor, unit) => {
  executeCommand<DeleteCommand>(
    editor,
    { direction: 'forward', type: 'delete', unit },
    (command) => {
      applyDeleteForward(editor, command.unit)
      return { handled: true }
    }
  )
}
