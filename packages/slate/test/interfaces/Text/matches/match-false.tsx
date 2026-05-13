/** @jsx jsx */

import { TextApi } from 'slate'

export const input = {
  text: { text: '', bold: true },
  props: { italic: true },
}
export const test = ({ text, props }) => {
  return TextApi.matches(text, props)
}
export const output = false
