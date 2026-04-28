/** @jsx jsx */

import { jsx } from '../../..'

jsx

import assert from 'node:assert/strict'
import { Editor, Operation } from 'slate'

export const run = (editor: Editor) => {
  editor.setNodes({ someKey: true }, { at: [0] })
  const [op] = editor.getOperations()
  const roundTrip: Operation = JSON.parse(JSON.stringify(op))
  assert.deepStrictEqual(op, roundTrip)
}
export const input = (
  <editor>
    <block>
      <text />
    </block>
  </editor>
)
export const output = (
  <editor>
    <block someKey>
      <text />
    </block>
  </editor>
)
