/** @jsx jsx */

import { PathApi } from 'slate'

export const input = {
  path: [],
  another: [0, 1],
}
export const test = ({ path, another }) => {
  return PathApi.isSibling(path, another)
}
export const output = false
