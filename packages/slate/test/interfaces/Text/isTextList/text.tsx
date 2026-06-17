/** @jsx jsx */

import { TextApi } from 'slate'

export const input = {
  text: '',
}
export const test = (value) => {
  return TextApi.isTextList(value)
}
export const output = false
