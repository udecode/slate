/** @jsx jsx */

import { RangeApi } from 'slate'

export const input = {
  anchor: {
    path: [0],
    offset: 0,
  },
  focus: {
    path: [0],
    offset: 0,
  },
}
export const test = (range) => {
  return RangeApi.isExpanded(range)
}
export const output = false
