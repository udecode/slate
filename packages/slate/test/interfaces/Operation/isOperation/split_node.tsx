/** @jsx jsx */

import { OperationApi } from 'slate'

export const input = {
  type: 'split_node',
  path: [0],
  position: 0,
  properties: {},
}
export const test = (value) => {
  return OperationApi.isOperation(value)
}
export const output = true
