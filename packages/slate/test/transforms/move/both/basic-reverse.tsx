/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const run = (editor) => {
  editor.move({ reverse: true })
}
export const input = (
  <editor>
    <block>
      one <cursor />
      two three
    </block>
  </editor>
)
export const output = (
  <editor>
    <block>
      one
      <cursor /> two three
    </block>
  </editor>
)
