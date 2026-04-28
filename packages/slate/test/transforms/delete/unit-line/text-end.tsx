/** @jsx jsx */

import { jsx } from '../../..'

jsx

import { Editor } from 'slate'

export const run = (editor) => {
  editor.delete({ unit: 'line' })
}
export const input = (
  <editor>
    <block>
      one two three
      <cursor />
    </block>
  </editor>
)
export const output = Editor.getSnapshot(input)
