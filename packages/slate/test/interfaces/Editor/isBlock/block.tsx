/** @jsx jsx */

import { jsx } from '../../..'

jsx

import { Editor, Element } from 'slate'

export const input = (
  <editor>
    <block>one</block>
  </editor>
)
export const test = (editor) => {
  const block = Editor.getChildren(editor)[0]
  return Element.isElement(block) && Editor.isBlock(editor, block)
}
export const output = true
