/** @jsx jsx */

import { LocationApi, type Point } from 'slate'

export const input: Point = { path: [0, 1], offset: 2 }
export const test = (value: typeof input) => {
  return LocationApi.isRange(value)
}
export const output = false
