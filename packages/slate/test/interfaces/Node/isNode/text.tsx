/** @jsx jsx */

import { NodeApi } from 'slate'

export const input = {
  text: '',
}
export const test = (value) => {
  return NodeApi.isNode(value)
}
export const output = true
