/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const run = (editor) => {
  editor.liftNodes({ at: [0, 0] })
}
export const input = (
  <editor>
    <block>
      <block>one</block>
      <block>two</block>
    </block>
  </editor>
)
export const output = (
  <editor>
    <block>one</block>
    <block>
      <block>two</block>
    </block>
  </editor>
)
