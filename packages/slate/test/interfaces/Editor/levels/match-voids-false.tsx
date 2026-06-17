import { TextApi } from 'slate'
import { Editor } from 'slate/internal'

/** @jsx jsx  */

export const input = (
  <editor>
    <element void>
      <text />
    </element>
  </editor>
)

export const test = (editor) => {
  return Array.from(
    Editor.levels(editor, {
      at: [0, 0],
      match: TextApi.isText,
    })
  )
}

export const output = []
