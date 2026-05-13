/** @jsx jsx */

import { LocationApi, type Path } from 'slate'

export const input: Path = [0, 1]
export const test = (value: typeof input) => {
  return LocationApi.isSpan(value)
}
export const output = false
