/** @jsx jsx */

import { PathApi } from 'slate'

export const input = [0, 1]
export const test = (path) => {
  return PathApi.previous(path)
}
export const output = [0, 0]
