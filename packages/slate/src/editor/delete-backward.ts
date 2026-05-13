import { executeCommand } from '../core/command-registry'
import { runEditorTransaction } from '../core/public-state'
import { getEditorTransformRegistry } from '../core/transform-registry'
import type { EditorTransformApi } from '../interfaces/editor'
import { RangeApi } from '../interfaces/range'
import type { TextUnit } from '../types/types'
import type { WithEditorFirstArg } from '../utils/types'

type DeleteCommand = {
  direction: 'backward' | 'forward'
  type: 'delete'
  unit: TextUnit
}

const applyDeleteBackward: WithEditorFirstArg<
  EditorTransformApi['deleteBackward']
> = (editor, unit) => {
  runEditorTransaction(editor, (tx) => {
    const selection = tx.resolveTarget()

    if (
      selection &&
      RangeApi.isRange(selection) &&
      RangeApi.isCollapsed(selection)
    ) {
      getEditorTransformRegistry(editor).delete({ unit, reverse: true })
    }
  })
}

export const deleteBackward: WithEditorFirstArg<
  EditorTransformApi['deleteBackward']
> = (editor, unit) => {
  executeCommand<DeleteCommand>(
    editor,
    { direction: 'backward', type: 'delete', unit },
    (command) => {
      applyDeleteBackward(editor, command.unit)
      return { handled: true }
    }
  )
}
