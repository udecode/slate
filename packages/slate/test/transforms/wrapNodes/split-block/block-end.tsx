/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const input = (
  <editor>
    <block>
      wo
      <anchor />
      rd
      <focus />
    </block>
  </editor>
)
export const run = (editor) => {
  editor.wrapNodes(<block new />, { split: true })
}
export const output = (
  <editor>
    <block>wo</block>
    <block new>
      <block>
        <anchor />
        rd
        <focus />
      </block>
    </block>
  </editor>
)
