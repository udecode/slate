import { Editor } from 'slate/internal'
/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const input = (
  <editor>
    <block>one</block>
    <block>two</block>
  </editor>
)

export const test = (editor) => {
  return Editor.before(editor, [0, 0])
}

export const output = undefined
