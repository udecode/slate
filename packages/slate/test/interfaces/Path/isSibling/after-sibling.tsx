/** @jsx jsx */

import { PathApi } from 'slate'

export const input = {
  path: [1, 4],
  another: [1, 2],
}
export const test = ({ path, another }) => {
  return PathApi.isSibling(path, another)
}
export const output = true
