/** @jsx jsx */

import { jsx } from '../../..'

jsx

import { Editor } from 'slate'

export const run = (editor) => {
  editor.delete({ unit: 'line', reverse: true })
}
export const input = (
  <editor>
    <block>
      <cursor />
      one two three
    </block>
  </editor>
)
export const output = Editor.getSnapshot(input)
