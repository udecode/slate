/** @jsx jsx */

import { ElementApi } from 'slate'

export const input = {
  children: [
    {
      children: [],
    },
  ],
}
export const test = (value) => {
  return ElementApi.isElement(value)
}
export const output = true
