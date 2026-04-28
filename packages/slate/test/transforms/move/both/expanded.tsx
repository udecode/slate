/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const run = (editor) => {
  editor.move()
}
export const input = (
  <editor>
    <block>
      one <anchor />
      two th
      <focus />
      ree
    </block>
  </editor>
)
export const output = (
  <editor>
    <block>
      one t<anchor />
      wo thr
      <focus />
      ee
    </block>
  </editor>
)
