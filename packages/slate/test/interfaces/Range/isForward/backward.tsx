/** @jsx jsx */

import { RangeApi } from 'slate'

export const input = {
  anchor: {
    path: [3],
    offset: 0,
  },
  focus: {
    path: [0],
    offset: 0,
  },
}
export const test = (range) => {
  return RangeApi.isForward(range)
}
export const output = false
