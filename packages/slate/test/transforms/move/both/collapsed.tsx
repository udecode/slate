/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const run = (editor) => {
  editor.move()
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
      one t<cursor />
      wo three
    </block>
  </editor>
)
