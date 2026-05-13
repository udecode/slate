import { Editor } from 'slate/internal'
/** @jsx jsx */

import { jsx } from '../../..'

jsx

import { ElementApi } from 'slate'

export const input = (
  <editor>
    <block>one</block>
    <block>two</block>
  </editor>
)
export const test = (editor) => {
  return Editor.next(editor, {
    at: [0],
    match: (n) => ElementApi.isElement(n) && Editor.isBlock(editor, n),
  })
}
export const output = [<block>two</block>, [1]]
