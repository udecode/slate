import type { EditorInterface } from '../interfaces/editor'

export const insertSoftBreak: EditorInterface['insertSoftBreak'] = (editor) => {
  editor.splitNodes({ always: true })
}
