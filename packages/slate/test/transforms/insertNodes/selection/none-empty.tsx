/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const input = <editor />
export const run = (editor, options = {}) => {
  editor.insertNodes(<block>one</block>, options)
}
export const output = (
  <editor>
    <block>
      one
      <cursor />
    </block>
  </editor>
)
