/** @jsx jsx */

import { TextApi } from 'slate'

export const input = {}
export const test = (value) => {
  return TextApi.isText(value)
}
export const output = false
