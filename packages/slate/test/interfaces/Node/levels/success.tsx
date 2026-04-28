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
  return Array.from(Node.levels(value, [0, 0]))
}
export const output = [
  [input, []],
  [Node.get(input, [0]), [0]],
  [Node.get(input, [0, 0]), [0, 0]],
]
