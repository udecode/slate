/** @jsx jsx */

import { jsx } from '../../..'

jsx

import { Editor, Element } from 'slate'

export const run = (editor) => {
  editor.setNodes(
    { someKey: true },
    { match: (n) => Element.isElement(n) && Editor.isInline(editor, n) }
  )
}
export const input = (
  <editor>
    <block>
      <text>word</text>
      <inline alreadyHasAKey void>
        <text />
        <cursor />
      </inline>
      <text />
    </block>
  </editor>
)
export const output = (
  <editor>
    <block>
      <text>word</text>
      <inline alreadyHasAKey someKey void>
        <text />
        <cursor />
      </inline>
      <text />
    </block>
  </editor>
)
