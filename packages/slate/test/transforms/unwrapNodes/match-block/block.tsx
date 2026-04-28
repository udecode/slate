/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const run = (editor) => {
  editor.unwrapNodes({ match: (n) => n.a })
}
export const input = (
  <editor>
    <block a>
      <block>
        <cursor />
        word
      </block>
    </block>
  </editor>
)
export const output = (
  <editor>
    <block>
      <cursor />
      word
    </block>
  </editor>
)
