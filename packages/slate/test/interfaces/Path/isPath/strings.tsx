/** @jsx jsx */

import { PathApi } from 'slate'

export const input = ['a', 'b']
export const test = (path) => {
  return PathApi.isPath(path)
}
export const output = false
