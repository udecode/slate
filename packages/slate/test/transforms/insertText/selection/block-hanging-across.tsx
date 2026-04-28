/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const run = (editor) => {
  editor.insertText('a')
}
export const input = (
  <editor>
    <block>
      <anchor />
      one
    </block>
    <block>two</block>
    <block>
      <focus />
      three
    </block>
  </editor>
)
export const output = (
  <editor>
    <block>
      a<cursor />
      three
    </block>
  </editor>
)
export const skip = true
