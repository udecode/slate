/** @jsx jsx */

import { ElementApi } from 'slate'

export const input = {
  text: '',
}
export const test = (value) => {
  return ElementApi.isElement(value)
}
export const output = false
