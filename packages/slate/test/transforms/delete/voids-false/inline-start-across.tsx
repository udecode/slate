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
      <inline void>
        <anchor />
      </inline>
      two
    </block>
    <block>
      three <focus />
    </block>
  </editor>
)
export const output = (
  <editor>
    <block>
      one
      <cursor />
    </block>
  </editor>
)
