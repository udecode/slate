import { Editor } from 'slate/internal'
/** @jsx jsx */

import { jsx } from '../../..'

jsx

import { Element } from 'slate'

export const run = (editor) => {
  editor.nodes.move({
    match: (n) => Element.isElement(n) && Editor.isBlock(editor, n),
    to: [0],
  })
}
export const input = (
  <editor>
    <block>one</block>
    <block>
      two
      <anchor />
    </block>
    <block>
      three
      <focus />
    </block>
  </editor>
)

export const output = (
  <editor>
    <block>
      two
      <anchor />
    </block>
    <block>
      three
      <focus />
    </block>
    <block>one</block>
  </editor>
)
