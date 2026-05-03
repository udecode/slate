import { executeCommand } from '../core/command-registry'
import { runEditorTransaction } from '../core/public-state'
import { getEditorTransformRegistry } from '../core/transform-registry'
import type { EditorStaticApi } from '../interfaces/editor'
import { Range } from '../interfaces/range'

type DeleteFragmentCommand = {
  direction: NonNullable<
    Parameters<EditorStaticApi['deleteFragment']>[1]
  >['direction']
  type: 'delete_fragment'
}

const applyDeleteFragment: EditorStaticApi['deleteFragment'] = (
  editor,
  { direction = 'forward' } = {}
) => {
  runEditorTransaction(editor, (tx) => {
    const selection = tx.resolveTarget()

    if (selection && Range.isRange(selection) && Range.isExpanded(selection)) {
      getEditorTransformRegistry(editor).delete({
        reverse: direction === 'backward',
      })
    }
  })
}

export const deleteFragment: EditorStaticApi['deleteFragment'] = (
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
