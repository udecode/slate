/** @jsx jsx */

import { LocationApi, type Span } from 'slate'

export const input: Span = [
  [0, 1],
  [2, 3],
]
export const test = (value: typeof input) => {
  return LocationApi.isSpan(value)
}
export const output = true
