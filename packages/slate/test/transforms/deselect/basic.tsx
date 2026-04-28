/** @jsx jsx */

import { jsx } from '../..'

jsx

export const run = (editor) => {
  editor.deselect()
}
export const input = (
  <editor>
    <block>
      <cursor />
      one
    </block>
  </editor>
)
export const output = (
  <editor>
    <block>one</block>
  </editor>
)
