/** @jsx jsx */

import { NodeApi } from 'slate'

export const input = {
  node: { children: [], type: 'bold' },
  props: { type: 'bold' },
}
export const test = ({ node, props }) => {
  return NodeApi.matches(node, props)
}
export const output = true
