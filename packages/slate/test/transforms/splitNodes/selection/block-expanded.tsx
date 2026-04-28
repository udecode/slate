/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const run = (editor) => {
  editor.splitNodes()
}
export const input = (
  <editor>
    <block>
      w<anchor />
      or
      <focus />d
    </block>
  </editor>
)
export const output = (
  <editor>
    <block>w</block>
    <block>
      <cursor />d
    </block>
  </editor>
)
