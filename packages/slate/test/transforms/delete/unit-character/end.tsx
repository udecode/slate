/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const run = (editor) => {
  editor.delete({ unit: 'character' })
}
export const input = (
  <editor>
    <block>
      wor
      <cursor />d
    </block>
  </editor>
)
export const output = (
  <editor>
    <block>
      wor
      <cursor />
    </block>
  </editor>
)
