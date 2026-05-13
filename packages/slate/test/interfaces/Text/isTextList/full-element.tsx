/** @jsx jsx */

import { TextApi } from 'slate'

export const input = [
  {
    children: [],
  },
]
export const test = (value) => {
  return TextApi.isTextList(value)
}
export const output = false
