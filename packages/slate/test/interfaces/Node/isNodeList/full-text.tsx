/** @jsx jsx */

import { NodeApi } from 'slate'

export const input = [
  {
    text: '',
  },
]
export const test = (value) => {
  return NodeApi.isNodeList(value)
}
export const output = true
