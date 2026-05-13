/** @jsx jsx */

import { PathApi } from 'slate'

export const input = {
  path: [0, 1],
  another: [0, 3],
}
export const test = ({ path, another }) => {
  return PathApi.isSibling(path, another)
}
export const output = true
