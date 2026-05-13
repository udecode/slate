/** @jsx jsx */

import { PathApi } from 'slate'

export const input = [2, 4, 'b']
export const test = (value: typeof input) => {
  return PathApi.isPath(value)
}
export const output = false
