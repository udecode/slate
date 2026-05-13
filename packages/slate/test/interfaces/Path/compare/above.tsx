/** @jsx jsx */

import { PathApi } from 'slate'

export const input = {
  path: [0, 1, 2],
  another: [0],
}
export const test = ({ path, another }) => {
  return PathApi.compare(path, another)
}
export const output = 0
