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
  return NodeApi.get(value, [0])
}
export const output = (
  <element>
    <text />
  </element>
)
