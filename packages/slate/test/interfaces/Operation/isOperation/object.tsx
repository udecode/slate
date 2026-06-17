/** @jsx jsx */

import { OperationApi } from 'slate'

export const input = {}
export const test = (value) => {
  return OperationApi.isOperation(value)
}
export const output = false
