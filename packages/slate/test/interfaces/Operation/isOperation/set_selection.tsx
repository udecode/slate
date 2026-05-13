/** @jsx jsx */

import { OperationApi } from 'slate'

export const input = {
  type: 'set_selection',
  properties: {},
  newProperties: {},
}
export const test = (value) => {
  return OperationApi.isOperation(value)
}
export const output = true
