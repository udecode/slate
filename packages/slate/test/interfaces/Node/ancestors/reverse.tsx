/** @jsx jsx  */
import { Node } from 'slate'

export const input = (
  <editor>
    <element>
      <text />
    </element>
  </editor>
)
export const test = (value) => {
  return Array.from(Node.ancestors(value, [0, 0], { reverse: true }))
}
export const output = [
  [Node.get(input, [0]), [0]],
  [input, []],
]
