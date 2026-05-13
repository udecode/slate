/** @jsx jsx  */
import { NodeApi } from 'slate'

export const input = (
  <element>
    <text>one</text>
    <text>two</text>
  </element>
)
export const test = (value) => {
  return NodeApi.string(value, [1])
}
export const output = `onetwo`
