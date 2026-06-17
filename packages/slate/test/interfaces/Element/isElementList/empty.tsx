/** @jsx jsx */

import { ElementApi } from 'slate'

export const input = []
export const test = (value) => {
  return ElementApi.isElementList(value)
}
export const output = true
