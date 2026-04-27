import { executeCommand } from '../core/command-registry'
import { withTransaction } from '../core/public-state'
import { Editor, type EditorInterface } from '../interfaces/editor'
import { Range } from '../interfaces/range'

type ToggleMarkCommand = {
  key: string
  type: 'toggle_mark'
  value: Parameters<EditorInterface['toggleMark']>[2]
}

const applyToggleMark: EditorInterface['toggleMark'] = (
  editor,
  key,
  value = true
) => {
  withTransaction(editor, (tx) => {
    const selection = tx.resolveTarget()

    if (!selection || !Range.isRange(selection)) {
      return
    }

    const marks = Editor.marks(editor) as Record<string, unknown> | null

    if (marks?.[key] === value) {
      editor.removeMark(key)
    } else {
      editor.addMark(key, value)
    }
  })
}

export const toggleMark: EditorInterface['toggleMark'] = (
  editor,
  key,
  value = true
) => {
  executeCommand<ToggleMarkCommand>(
    editor,
    { key, type: 'toggle_mark', value },
    (command) => {
      applyToggleMark(editor, command.key, command.value)
      return { handled: true }
    },
    { implicitUpdate: true }
  )
}
