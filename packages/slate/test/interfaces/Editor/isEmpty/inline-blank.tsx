/** @jsx jsx */

import { jsx } from '../../..'

jsx

import { Editor } from 'slate'

export const input = (
  <editor>
    <block>
      one
      <inline>
        <text />
      </inline>
      three
    </block>
  </editor>
)
export const test = (editor) => {
  const inline = Editor.getChildren(editor)[0].children[1]
  return Editor.isEmpty(editor, inline)
}
export const output = true
