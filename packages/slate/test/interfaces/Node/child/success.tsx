/** @jsx jsx  */

import { cloneDeep } from 'lodash'
import { NodeApi } from 'slate'

export const input = (
  <editor>
    <element>
      <text />
    </element>
  </editor>
)
export const test = (value) => {
  return NodeApi.child(value, 0)
}
export const output = cloneDeep(NodeApi.get(input, [0]))
