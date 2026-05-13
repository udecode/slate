/** @jsx jsx */

import { PointApi } from 'slate'

export const input = {
  path: [0, 1],
  offset: 0,
}
export const test = (value) => {
  return PointApi.isPoint(value)
}
export const output = true
