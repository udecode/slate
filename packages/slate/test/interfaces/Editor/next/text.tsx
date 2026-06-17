import { Editor } from 'slate/internal'
/** @jsx jsx */

import { jsx } from '../../..'

jsx

import { TextApi } from 'slate'

export const input = (
  <editor>
    <block>one</block>
    <block>two</block>
  </editor>
)
export const test = (editor) => {
  return Editor.next(editor, { at: [0], match: TextApi.isText })
}
export const output = [<text>two</text>, [1, 0]]
