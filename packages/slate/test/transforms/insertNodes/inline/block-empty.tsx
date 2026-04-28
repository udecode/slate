/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const input = (
  <editor>
    <block>
      <cursor />
    </block>
  </editor>
)
export const run = (editor, options = {}) => {
  editor.insertNodes(
    <inline void>
      <text />
    </inline>,
    options
  )
}
export const output = (
  <editor>
    <block>
      <text />
      <inline void>
        <cursor />
      </inline>
      <text />
    </block>
  </editor>
)
