/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const run = (editor, options = {}) => {
  editor.insertFragment(
    <fragment>
      <inline>fragment</inline>
    </fragment>,
    options
  )
}
export const input = (
  <editor>
    <block>
      word
      <cursor />
    </block>
  </editor>
)
// TODO: this cursor placement seems off
export const output = (
  <editor>
    <block>
      word
      <inline>
        fragment
        <cursor />
      </inline>
      <text />
    </block>
  </editor>
)
