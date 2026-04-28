/** @jsx jsx */

import { jsx } from '../../..'

jsx

import { Editor, Element } from 'slate'

export const run = (editor) => {
  editor.splitNodes({
    match: (n) => Element.isElement(n) && Editor.isBlock(editor, n),
    always: true,
  })
}
export const input = (
  <editor>
    <block>
      word
      <cursor />
    </block>
    <block>another</block>
  </editor>
)
export const output = (
  <editor>
    <block>word</block>
    <block>
      <cursor />
    </block>
    <block>another</block>
  </editor>
)
