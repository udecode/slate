import { Editor } from 'slate/internal'
/** @jsx jsx */

import { jsx } from '../../..'

jsx

import { Element } from 'slate'

export const run = (editor) => {
  editor.nodes.set(
    { someKey: true },
    { match: (n) => Element.isElement(n) && Editor.isBlock(editor, n) }
  )
}
export const input = (
  <editor>
    <block>
      <cursor />
      word
    </block>
  </editor>
)
export const output = (
  <editor>
    <block someKey>
      <cursor />
      word
    </block>
  </editor>
)
