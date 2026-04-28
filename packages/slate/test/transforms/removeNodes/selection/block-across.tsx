/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const input = (
  <editor>
    <block>
      on
      <anchor />e
    </block>
    <block>
      t<focus />
      wo
    </block>
    <block>three</block>
  </editor>
)
export const run = (editor) => {
  editor.removeNodes()
}
export const output = (
  <editor>
    <block>
      <cursor />
      three
    </block>
  </editor>
)
