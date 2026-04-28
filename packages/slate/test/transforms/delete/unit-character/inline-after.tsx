/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const run = (editor) => {
  editor.delete()
}
export const input = (
  <editor>
    <block>
      one
      <inline>two</inline>
      <cursor />a
    </block>
  </editor>
)
export const output = (
  <editor>
    <block>
      one
      <inline>two</inline>
      <cursor />
    </block>
  </editor>
)
