/** @jsx jsx */

import { jsx } from '../../..'

jsx

import { Text } from 'slate'

export const run = (editor) => {
  editor.nodes.set({ someKey: true }, { match: Text.isText, split: true })
}
export const input = (
  <editor>
    <block>
      <text>
        One
        <anchor />
      </text>
      <text someKey>Two</text>
      <text>
        <focus />
        Three
      </text>
    </block>
  </editor>
)
export const output = (
  <editor>
    <block>
      <text>
        One
        <anchor />
      </text>
      <text someKey>
        Two
        <focus />
      </text>
      <text>Three</text>
    </block>
  </editor>
)
