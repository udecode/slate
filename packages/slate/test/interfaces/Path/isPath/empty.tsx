/** @jsx jsx */

import { PathApi } from 'slate'

export const input = []
export const test = (path) => {
  return PathApi.isPath(path)
}
export const output = true
