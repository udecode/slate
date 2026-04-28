import { executeCommand } from '../core/command-registry'
import { withTransaction } from '../core/public-state'
import type { EditorInterface } from '../interfaces/editor'
import { Range } from '../interfaces/range'

type DeleteFragmentCommand = {
  direction: NonNullable<
    Parameters<EditorInterface['deleteFragment']>[1]
  >['direction']
  type: 'delete_fragment'
}

const applyDeleteFragment: EditorInterface['deleteFragment'] = (
  editor,
  { direction = 'forward' } = {}
) => {
  withTransaction(editor, (tx) => {
    const selection = tx.resolveTarget()

    if (selection && Range.isRange(selection) && Range.isExpanded(selection)) {
      editor.delete({ reverse: direction === 'backward' })
    }
  })
}

export const deleteFragment: EditorInterface['deleteFragment'] = (
  editor,
  { direction = 'forward' } = {}
) => {
  executeCommand<DeleteFragmentCommand>(
    editor,
    { direction, type: 'delete_fragment' },
    (command) => {
      applyDeleteFragment(editor, { direction: command.direction })
      return { handled: true }
    }
  )
}
