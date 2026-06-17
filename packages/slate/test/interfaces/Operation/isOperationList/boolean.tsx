/** @jsx jsx */

import { OperationApi } from 'slate'

export const input = true
export const test = (value) => {
  return OperationApi.isOperationList(value)
}
export const output = false
