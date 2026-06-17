/** @jsx jsx */

import { PathApi } from 'slate'

export const input = {
  path: [1],
  another: [0, 2],
}
export const test = ({ path, another }) => {
  return PathApi.endsAfter(path, another)
}
export const output = true
