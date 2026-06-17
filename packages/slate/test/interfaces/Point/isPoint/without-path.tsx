/** @jsx jsx */

import { PointApi } from 'slate'

export const input = {
  offset: 0,
}
export const test = (value) => {
  return PointApi.isPoint(value)
}
export const output = false
