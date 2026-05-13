/** @jsx jsx */

import { ElementApi } from 'slate'

export const input = true
export const test = (value) => {
  return ElementApi.isElementList(value)
}
export const output = false
