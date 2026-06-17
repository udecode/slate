/** @jsx jsx */

import { NodeApi } from 'slate'

export const input = {
  children: [],
}
export const test = (value) => {
  return NodeApi.isNodeList(value)
}
export const output = false
