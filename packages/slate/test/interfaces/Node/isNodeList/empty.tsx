/** @jsx jsx */

import { NodeApi } from 'slate'

export const input = []
export const test = (value) => {
  return NodeApi.isNodeList(value)
}
export const output = true
