/** @jsx jsx */

import { TextApi } from 'slate'

export const input = {
  text: 'string',
}
export const test = (value) => {
  return TextApi.isText(value)
}
export const output = true
