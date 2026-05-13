/** @jsx jsx */

import { ElementApi } from 'slate'

export const input = true
export const test = (value) => {
  return ElementApi.isElement(value)
}

export const output = false
