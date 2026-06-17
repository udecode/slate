import { Editor } from 'slate/internal'
/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const input = (
  <editor>
    <block>one</block>
  </editor>
)

export const test = (editor) => {
  return Editor.before(editor, { path: [0, 0], offset: 1 })
}

export const output = { path: [0, 0], offset: 0 }
