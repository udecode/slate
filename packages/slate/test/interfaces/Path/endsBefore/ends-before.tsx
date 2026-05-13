/** @jsx jsx */

import { PathApi } from 'slate'

export const input = {
  path: [0],
  another: [1, 2],
}
export const test = ({ path, another }) => {
  return PathApi.endsBefore(path, another)
}
export const output = true
