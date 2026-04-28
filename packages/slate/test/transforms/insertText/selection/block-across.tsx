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
      first paragraph
    </block>
    <block>
      second
      <focus /> paragraph
    </block>
  </editor>
)
export const output = (
  <editor>
    <block>
      a<cursor /> paragraph
    </block>
  </editor>
)
