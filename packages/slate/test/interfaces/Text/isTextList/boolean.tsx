/** @jsx jsx */

import { TextApi } from 'slate'

export const input = true
export const test = (value) => {
  return TextApi.isTextList(value)
}
export const output = false
