/** @jsx jsx */

import { PointApi } from 'slate'

export const input = {
  point: {
    path: [0, 4],
    offset: 3,
  },
  another: {
    path: [0, 1],
    offset: 3,
  },
}
export const test = ({ point, another }) => {
  return PointApi.isAfter(point, another)
}
export const output = true
