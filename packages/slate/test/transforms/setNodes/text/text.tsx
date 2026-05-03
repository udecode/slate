/** @jsx jsx */

import { jsx } from '../../..'

jsx

import { Text } from 'slate'

export const run = (editor) => {
  editor.nodes.set({ someKey: true }, { match: Text.isText })
}
export const input = (
  <editor>
    <block>
      <cursor />
      word
    </block>
  </editor>
)
export const output = (
  <editor>
    <block>
      <text someKey>
        <cursor />
        word
      </text>
    </block>
  </editor>
)
