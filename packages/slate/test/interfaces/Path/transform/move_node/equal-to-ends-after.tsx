/** @jsx jsx */

import { PathApi } from 'slate'

const path = [3, 3]
const op = {
  type: 'move_node',
  path: [3, 3],
  newPath: [3, 5, 0],
}
export const test = () => {
  return PathApi.transform(path, op)
}
export const output = [3, 4, 0]
