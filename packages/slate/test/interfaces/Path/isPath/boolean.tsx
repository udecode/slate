/** @jsx jsx */

import { PathApi } from 'slate'

export const input = true
export const test = (path) => {
  return PathApi.isPath(path)
}
export const output = false
