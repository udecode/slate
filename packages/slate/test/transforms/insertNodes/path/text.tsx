/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const input = (
  <editor>
    <block>
      <cursor />
      word
    </block>
  </editor>
)
export const run = (editor, options = {}) => {
  editor.insertNodes(<text>another</text>, {
    at: [0, 0],
    ...options,
  })
}
export const output = (
  <editor>
    <block>
      another
      <cursor />
      word
    </block>
  </editor>
)
