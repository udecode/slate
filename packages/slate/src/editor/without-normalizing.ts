import {
  getLatestContentOperation,
  getLatestOperation,
  getOperationCount,
} from '../core/public-state'
import type { EditorStaticApi } from '../interfaces/editor'
import { isNormalizing } from './is-normalizing'
import { normalize } from './normalize'
import { setNormalizing } from './set-normalizing'

export const withoutNormalizing: EditorStaticApi['withoutNormalizing'] = (
  editor,
  fn
) => {
  const operationCount = getOperationCount(editor)
  const value = isNormalizing(editor)
  setNormalizing(editor, false)
  try {
    fn()
  } finally {
    setNormalizing(editor, value)
  }

  const latestOperation =
    getLatestContentOperation(editor, operationCount) ??
    getLatestOperation(editor)
  const didSingleTextOperation =
    getOperationCount(editor) === operationCount + 1 &&
    (latestOperation?.type === 'insert_text' ||
      latestOperation?.type === 'remove_text')

  normalize(editor, {
    explicit: false,
    force: !didSingleTextOperation,
    operation: latestOperation,
  })
}
