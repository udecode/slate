/** @jsx jsx */

import { jsx } from '../../..'

jsx

import { Editor } from 'slate'

export const input = (
  <editor>
    <block>
      <block>one</block>
    </block>
  </editor>
)
export const test = (editor) => {
  const block = Editor.getChildren(editor)[0]
  return Editor.hasBlocks(editor, block)
}
export const output = true
