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
        <anchor />
        one
      </block>
      <block>
        <focus />
        two
      </block>
      <block>three</block>
      <block>four</block>
      <block>five</block>
      <block>six</block>
    </block>
  </editor>
)
export const output = (
  <editor>
    <block>
      <anchor />
      one
    </block>
    <block>
      <focus />
      two
    </block>
    <block>three</block>
    <block>four</block>
    <block>five</block>
    <block>six</block>
  </editor>
)
