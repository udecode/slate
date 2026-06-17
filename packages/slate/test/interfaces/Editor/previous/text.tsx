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
  return Editor.previous(editor, { at: [1], match: TextApi.isText })
}
export const output = [<text>one</text>, [0, 0]]
