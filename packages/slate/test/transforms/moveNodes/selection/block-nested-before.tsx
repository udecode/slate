/** @jsx jsx */

import { jsx } from '../../..'

jsx

import { Editor, Element } from 'slate'

export const run = (editor) => {
  editor.moveNodes({
    match: (n) => Element.isElement(n) && Editor.isBlock(editor, n),
    to: [0],
  })
}
export const input = (
  <editor>
    <block>
      <block>
        <anchor />
        one
      </block>
      <block>
        two
        <focus />
      </block>
    </block>
  </editor>
)
export const output = (
  <editor>
    <block>
      <anchor />
      one
    </block>
    <block>
      two
      <focus />
    </block>
    <block>
      <text />
    </block>
  </editor>
)
