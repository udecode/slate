/** @jsx jsx */

import { TextApi } from 'slate'

export const input = [
  {
    children: [],
    selection: null,
  },
]
export const test = (value) => {
  return TextApi.isTextList(value)
}
export const output = false
