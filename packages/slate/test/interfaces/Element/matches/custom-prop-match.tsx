/** @jsx jsx */

import { ElementApi } from 'slate'

export const input = {
  element: { children: [], type: 'bold' },
  props: { type: 'bold' },
}
export const test = ({ element, props }) => {
  return ElementApi.matches(element, props)
}
export const output = true
