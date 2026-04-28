/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const run = (editor) => {
  editor.delete({ unit: 'character' })
}
export const input = (
  <editor>
    <block>
      <text />
      <inline>
        <cursor />
        📛word
      </inline>
      <text />
    </block>
  </editor>
)
export const output = (
  <editor>
    <block>
      <text />
      <inline>
        <cursor />
        word
      </inline>
      <text />
    </block>
  </editor>
)
