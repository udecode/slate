/** @jsx jsx */

import { PathApi } from 'slate'

export const input = {
  path: [0],
  another: [0, 1],
}
export const test = ({ path, another }) => {
  return PathApi.isParent(path, another)
}
export const output = true
