/** @jsx jsx */

import { OperationApi } from 'slate'

export const input = {
  type: 'insert_text',
  path: [0],
  offset: 0,
  text: 'string',
}
export const test = (value) => {
  return OperationApi.isOperation(value)
}
export const output = true
