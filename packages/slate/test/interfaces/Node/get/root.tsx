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
  return NodeApi.get(value, [])
}
export const output = input
