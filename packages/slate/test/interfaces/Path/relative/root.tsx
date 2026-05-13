/** @jsx jsx */

import { PathApi } from 'slate'

export const input = {
  path: [0, 1],
  another: [],
}
export const test = ({ path, another }) => {
  return PathApi.relative(path, another)
}
export const output = [0, 1]
