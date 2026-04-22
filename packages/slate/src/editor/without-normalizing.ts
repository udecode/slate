import { Editor, type EditorInterface } from '../interfaces/editor'

export const withoutNormalizing: EditorInterface['withoutNormalizing'] = (
  editor,
  fn
) => {
  const value = Editor.isNormalizing(editor)
  Editor.setNormalizing(editor, false)
  try {
    fn()
  } finally {
    Editor.setNormalizing(editor, value)
  }
  Editor.normalize(editor, {
    explicit: false,
    force: true,
    operation: editor.operations.at(-1),
  })
}
