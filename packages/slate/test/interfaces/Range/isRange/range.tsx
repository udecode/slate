/** @jsx jsx */

import { RangeApi } from 'slate'

export const input = {
  anchor: {
    path: [0, 1],
    offset: 0,
  },
  focus: {
    path: [0, 1],
    offset: 0,
  },
}
export const test = (value) => {
  return RangeApi.isRange(value)
}
export const output = true
