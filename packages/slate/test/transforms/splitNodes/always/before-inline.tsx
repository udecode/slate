import { Editor } from 'slate/internal'
/** @jsx jsx */

import { jsx } from '../../..'

jsx

import { Element } from 'slate'

export const run = (editor) => {
  editor.nodes.split({
    match: (n) => Element.isElement(n) && Editor.isBlock(editor, n),
    always: true,
  })
}
export const input = (
  <editor>
    <block>
      word
      <cursor />
      <inline>hyperlink</inline>
      word
    </block>
  </editor>
)
export const output = (
  <editor>
    <block>word</block>
    <block>
      <cursor />
      <inline>hyperlink</inline>
      word
    </block>
  </editor>
)
