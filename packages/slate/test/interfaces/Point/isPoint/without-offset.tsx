/** @jsx jsx */

import { PointApi } from 'slate'

export const input = {
  path: [0, 1],
}
export const test = (value) => {
  return PointApi.isPoint(value)
}
export const output = false
