import {
  getLatestContentOperation,
  getLatestOperation,
  getOperationCount,
} from '../core/public-state'
import { Editor, type EditorInterface } from '../interfaces/editor'

export const withoutNormalizing: EditorInterface['withoutNormalizing'] = (
  editor,
  fn
) => {
  const operationCount = getOperationCount(editor)
  const value = Editor.isNormalizing(editor)
  Editor.setNormalizing(editor, false)
  try {
    fn()
  } finally {
    Editor.setNormalizing(editor, value)
  }
  const latestOperation =
    getLatestContentOperation(editor, operationCount) ??
    getLatestOperation(editor)
  const didSingleTextOperation =
    getOperationCount(editor) === operationCount + 1 &&
    (latestOperation?.type === 'insert_text' ||
      latestOperation?.type === 'remove_text')

  Editor.normalize(editor, {
    explicit: false,
    force: !didSingleTextOperation,
    operation: latestOperation,
  })
}
