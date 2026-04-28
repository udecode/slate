/** @jsx jsx */

import { jsx } from '../..'

jsx

import { Text } from 'slate'

export const run = (editor) => {
  editor.unsetNodes('someKey', { match: Text.isText })
}
export const input = (
  <editor>
    <block>
      <text someKey>
        <cursor />
        word
      </text>
    </block>
  </editor>
)
export const output = (
  <editor>
    <block>
      <cursor />
      word
    </block>
  </editor>
)
