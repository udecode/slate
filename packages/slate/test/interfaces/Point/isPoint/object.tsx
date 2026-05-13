/** @jsx jsx */

import { PointApi } from 'slate'

export const input = {}
export const test = (value) => {
  return PointApi.isPoint(value)
}
export const output = false
