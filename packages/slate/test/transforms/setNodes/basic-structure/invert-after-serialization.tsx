/** @jsx jsx */

import { jsx } from '../../..'

jsx

import { Editor, Operation } from 'slate'

export const run = (editor: Editor) => {
  editor.setNodes({ key: true }, { at: [0] })
  const [op] = editor.getOperations()
  const roundTrip: Operation = JSON.parse(JSON.stringify(op))
  const inverted = Operation.inverse(roundTrip)
  editor.applyOperations([inverted])
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
    <block>
      <text />
    </block>
  </editor>
)
