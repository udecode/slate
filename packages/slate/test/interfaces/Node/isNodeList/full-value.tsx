/** @jsx jsx */

import { NodeApi } from 'slate'

export const input = [
  {
    children: [],
    selection: null,
  },
]
export const test = (value) => {
  return NodeApi.isNodeList(value)
}
export const output = true
