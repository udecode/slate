/** @jsx jsx */

import { RangeApi } from 'slate'

export const input = {}
export const test = (value) => {
  return RangeApi.isRange(value)
}
export const output = false
