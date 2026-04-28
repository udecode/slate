/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const run = (editor) => {
  editor.insertText('a')
}
export const input = (
  <editor>
    <block>
      w<cursor />
      ord
    </block>
  </editor>
)
export const output = (
  <editor>
    <block>
      wa
      <cursor />
      ord
    </block>
  </editor>
)
