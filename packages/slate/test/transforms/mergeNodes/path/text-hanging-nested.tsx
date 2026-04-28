/** @jsx jsx */

import { jsx } from '../../..'

jsx

import { Text } from 'slate'

export const input = (
  <editor>
    <block>one</block>
    <block>
      <block>
        <cursor />
        <text />
      </block>
    </block>
  </editor>
)
export const run = (editor) => {
  editor.mergeNodes({ at: [1, 0, 1], match: Text.isText })
}
export const output = (
  <editor>
    <block>one</block>
    <block>
      <block>
        <cursor />
      </block>
    </block>
  </editor>
)
