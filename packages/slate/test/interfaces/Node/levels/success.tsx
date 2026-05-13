/** @jsx jsx  */
import { NodeApi } from 'slate'

export const input = (
  <editor>
    <element>
      <text />
    </element>
  </editor>
)
export const test = (value) => {
  return Array.from(NodeApi.levels(value, [0, 0]))
}
export const output = [
  [input, []],
  [NodeApi.get(input, [0]), [0]],
  [NodeApi.get(input, [0, 0]), [0, 0]],
]
