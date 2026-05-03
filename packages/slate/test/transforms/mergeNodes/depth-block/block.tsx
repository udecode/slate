import { Editor } from 'slate/internal'
/** @jsx jsx */

import { jsx } from '../../..'

jsx

import { Element } from 'slate'

export const input = (
  <editor>
    <block>one</block>
    <block>
      <cursor />
      two
    </block>
  </editor>
)
export const run = (editor) => {
  editor.nodes.merge({
    match: (n) => Element.isElement(n) && Editor.isBlock(editor, n),
  })
}
export const output = (
  <editor>
    <block>
      one
      <cursor />
      two
    </block>
  </editor>
)
