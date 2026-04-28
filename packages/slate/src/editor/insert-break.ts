import { executeCommand } from '../core/command-registry'
import type { EditorInterface } from '../interfaces/editor'

type InsertBreakCommand = {
  type: 'insert_break'
}

const applyInsertBreak: EditorInterface['insertBreak'] = (editor) => {
  editor.splitNodes({ always: true })
}

export const insertBreak: EditorInterface['insertBreak'] = (editor) => {
  executeCommand<InsertBreakCommand>(editor, { type: 'insert_break' }, () => {
    applyInsertBreak(editor)
    return { handled: true }
  })
}
