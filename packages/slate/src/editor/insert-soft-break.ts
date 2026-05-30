import { executeCommand } from '../core/command-registry'
import { getEditorTransformRegistry } from '../core/transform-registry'
import type { EditorStaticApi } from '../interfaces/editor'

type InsertSoftBreakCommand = {
  type: 'insert_soft_break'
}

const applyInsertSoftBreak: EditorStaticApi['insertSoftBreak'] = (editor) => {
  getEditorTransformRegistry(editor).splitNodes({ always: true })
}

export const insertSoftBreak: EditorStaticApi['insertSoftBreak'] = (editor) => {
  executeCommand<InsertSoftBreakCommand>(
    editor,
    { type: 'insert_soft_break' },
    () => {
      applyInsertSoftBreak(editor)
      return true
    }
  )
}
