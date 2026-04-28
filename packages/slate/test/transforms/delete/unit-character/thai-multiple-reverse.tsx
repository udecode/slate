/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const run = (editor) => {
  editor.delete({ unit: 'character', distance: 2, reverse: true })
}
export const input = (
  <editor>
    <block>
      พี่
      <cursor />
    </block>
  </editor>
)
export const output = (
  <editor>
    <block>
      พ
      <cursor />
    </block>
  </editor>
)
