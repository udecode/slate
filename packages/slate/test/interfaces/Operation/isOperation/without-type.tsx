/** @jsx jsx */

import { OperationApi } from 'slate'

export const input = {
  path: [0],
  properties: {},
  newProperties: {},
}
export const test = (value) => {
  return OperationApi.isOperation(value)
}
export const output = false
