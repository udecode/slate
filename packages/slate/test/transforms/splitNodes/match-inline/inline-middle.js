import { Editor } from 'slate/internal'
/** @jsx jsx */

import { Element } from 'slate'

export const run = (editor) => {
  editor.nodes.split({
    match: (n) => Element.isElement(n) && Editor.isInline(editor, n),
  })
}

export const input = (
  <editor>
    <block>
      <text />
      <inline>
        wo
        <cursor />
        rd
      </inline>
      <text />
    </block>
  </editor>
)

export const output = (
  <editor>
    <block>
      <text />
      <inline>wo</inline>
      <text />
      <inline>
        <cursor />
        rd
      </inline>
      <text />
    </block>
  </editor>
)
