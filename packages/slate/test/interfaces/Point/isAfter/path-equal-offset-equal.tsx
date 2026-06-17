/** @jsx jsx */

import { PointApi } from 'slate'

export const input = {
  point: {
    path: [0, 1],
    offset: 7,
  },
  another: {
    path: [0, 1],
    offset: 7,
  },
}
export const test = ({ point, another }) => {
  return PointApi.isAfter(point, another)
}
export const output = false
