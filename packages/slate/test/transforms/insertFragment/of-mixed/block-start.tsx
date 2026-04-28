/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const run = (editor, options = {}) => {
  editor.insertFragment(
    <fragment>
      <text>one</text>
      <block>two</block>
      <text>three</text>
    </fragment>,
    options
  )
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
    <block>one</block>
    <block>two</block>
    <block>
      three
      <cursor />
      word
    </block>
  </editor>
)
