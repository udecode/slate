/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const input = (
  <editor>
    <block>
      <cursor />
      one
    </block>
  </editor>
)
export const run = (editor, options = {}) => {
  editor.insertNodes(
    <block>
      <text />
    </block>,
    { at: [0], select: true, ...options }
  )
}
export const output = (
  <editor>
    <block>
      <cursor />
    </block>
    <block>one</block>
  </editor>
)
