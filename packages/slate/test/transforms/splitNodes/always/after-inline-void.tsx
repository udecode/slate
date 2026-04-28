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
      one
      <inline void>
        <text />
      </inline>
      <cursor />
      two
    </block>
  </editor>
)
export const output = (
  <editor>
    <block>
      one
      <inline void>
        <text />
      </inline>
      <text />
    </block>
    <block>
      <cursor />
      two
    </block>
  </editor>
)
