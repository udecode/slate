/** @jsx jsx */

import { PathApi } from 'slate'

export const input = [0, 1, 2]
export const test = (path) => {
  return PathApi.ancestors(path, { reverse: true })
}
export const output = [[0, 1], [0], []]
