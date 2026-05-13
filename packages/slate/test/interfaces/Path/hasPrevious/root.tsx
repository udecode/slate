/** @jsx jsx */

import { PathApi } from 'slate'

export const input = [0, 0]
export const test = (path) => {
  return PathApi.hasPrevious(path)
}
export const output = false
