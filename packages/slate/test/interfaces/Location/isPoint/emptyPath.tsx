/** @jsx jsx */

import { LocationApi, type Path } from 'slate'

export const input: Path = []
export const test = (value: typeof input) => {
  return LocationApi.isPoint(value)
}
export const output = false
