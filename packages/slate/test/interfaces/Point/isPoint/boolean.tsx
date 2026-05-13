/** @jsx jsx */

import { PointApi } from 'slate'

export const input = true
export const test = (value) => {
  return PointApi.isPoint(value)
}
export const output = false
