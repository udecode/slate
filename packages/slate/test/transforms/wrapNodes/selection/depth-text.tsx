/** @jsx jsx */

import { jsx } from '../../..'

jsx

import { Text } from 'slate'

export const input = (
  <editor>
    <block>
      <text>
        <anchor />
        word
        <focus />
      </text>
    </block>
  </editor>
)
export const run = (editor) => {
  editor.wrapNodes(<block new />, { match: Text.isText })
}
export const output = (
  <editor>
    <block>
      <block new>
        <anchor />
        word
        <focus />
      </block>
    </block>
  </editor>
)
