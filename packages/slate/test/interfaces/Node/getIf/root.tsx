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
  return NodeApi.getIf(value, [])
}
export const output = input
