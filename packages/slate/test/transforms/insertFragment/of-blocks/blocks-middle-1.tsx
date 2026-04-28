/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const run = (editor, options = {}) => {
  editor.insertFragment(
    <fragment>
      <block>one</block>
    </fragment>,
    options
  )
}
export const input = (
  <editor>
    <block>
      wo
      <cursor />
      rd
    </block>
  </editor>
)
export const output = (
  <editor>
    <block>
      woone
      <cursor />
      rd
    </block>
  </editor>
)
