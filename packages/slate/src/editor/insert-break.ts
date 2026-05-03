import { executeCommand } from '../core/command-registry'
import { getEditorTransformRegistry } from '../core/transform-registry'
import type { EditorStaticApi } from '../interfaces/editor'

type InsertBreakCommand = {
  type: 'insert_break'
}

const applyInsertBreak: EditorStaticApi['insertBreak'] = (editor) => {
  getEditorTransformRegistry(editor).splitNodes({ always: true })
}

export const insertBreak: EditorStaticApi['insertBreak'] = (editor) => {
  executeCommand<InsertBreakCommand>(editor, { type: 'insert_break' }, () => {
    applyInsertBreak(editor)
    return { handled: true }
  })
}
