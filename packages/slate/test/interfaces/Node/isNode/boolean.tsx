/** @jsx jsx */

import { NodeApi } from 'slate'

export const input = true
export const test = (value) => {
  return NodeApi.isNode(value)
}
export const output = false
