/** @jsx jsx */

import { PathApi } from 'slate'

const path = [3, 3, 3]
const op = {
  type: 'move_node',
  path: [3, 3],
  newPath: [2, 1],
}
export const test = () => {
  return PathApi.transform(path, op)
}
export const output = [2, 1, 3]
