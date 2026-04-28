/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const run = (editor) => {
  editor.insertText('a')
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
      a<cursor />
      word
    </block>
  </editor>
)
