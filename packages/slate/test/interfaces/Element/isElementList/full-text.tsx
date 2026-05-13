/** @jsx jsx */

import { ElementApi } from 'slate'

export const input = [
  {
    text: '',
  },
]
export const test = (value) => {
  return ElementApi.isElementList(value)
}
export const output = false
