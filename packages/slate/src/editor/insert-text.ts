import {
  getCurrentMarks,
  getCurrentSelection,
  setCurrentMarks,
} from '../core/public-state'
import type { EditorInterface } from '../interfaces/editor'
import { Transforms } from '../interfaces/transforms'

export const insertText: EditorInterface['insertText'] = (
  editor,
  text,
  options = {}
) => {
  const selection = getCurrentSelection(editor)
  const marks = getCurrentMarks(editor)

  if (selection) {
    if (marks) {
      const node = { text, ...marks }
      Transforms.insertNodes(editor, node, {
        at: options.at,
        voids: options.voids,
      })
    } else {
      Transforms.insertText(editor, text, options)
    }

    setCurrentMarks(editor, null)
  }
}
