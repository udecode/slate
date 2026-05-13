/** @jsx jsx */

import { PathApi } from 'slate'

export const input = [0, 1]
export const test = (path) => {
  return PathApi.isPath(path)
}
export const output = true
