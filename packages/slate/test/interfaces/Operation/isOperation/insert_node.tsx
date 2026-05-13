/** @jsx jsx */

import { OperationApi } from 'slate'

export const input = {
  type: 'insert_node',
  path: [0],
  node: {
    children: [],
  },
}
export const test = (value) => {
  return OperationApi.isOperation(value)
}
export const output = true
