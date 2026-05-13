/** @jsx jsx */

import { PathApi } from 'slate'

export const input = {
  path: [1, 1, 2],
  another: [0],
}
export const test = ({ path, another }) => {
  return PathApi.isAfter(path, another)
}
export const output = true
