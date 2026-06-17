/** @jsx jsx */

import { TextApi } from 'slate'

export const input = [
  {
    text: '',
  },
  {
    type: 'set_node',
    path: [0],
    properties: {},
    newProperties: {},
  },
]
export const test = (value) => {
  return TextApi.isTextList(value)
}
export const output = false
