/** @jsx jsx */

import { OperationApi } from 'slate'

export const input = {
  type: 'move_node',
  path: [0],
  newPath: [1],
}
export const test = (value) => {
  return OperationApi.isOperation(value)
}
export const output = true
