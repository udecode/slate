/** @jsx jsx  */
import { NodeApi } from 'slate'

export const input = <text>one</text>
export const test = (value) => {
  return NodeApi.string(value)
}
export const output = `one`
