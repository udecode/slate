/** @jsx jsx */

import { OperationApi } from 'slate'

export const input = { type: 'move_node', path: [0, 2], newPath: [0, 1] }
export const test = (value) => {
  return OperationApi.inverse(value)
}
export const output = { type: 'move_node', path: [0, 1], newPath: [0, 2] }
