/** @jsx jsx */

import { TextApi } from 'slate'

export const input = {
  text: { text: '', bold: true, italic: true },
  props: { bold: true },
}
export const test = ({ text, props }) => {
  return TextApi.matches(text, props)
}
export const output = true
