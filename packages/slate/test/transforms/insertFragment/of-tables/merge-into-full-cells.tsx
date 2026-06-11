/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const run = (editor, options = {}) => {
  editor.fragment.insert(
    <block>
      <block>
        <block>
          <block>New 1</block>
          <block>New 2</block>
        </block>
      </block>
    </block>,
    options
  )
}
export const input = (
  <editor>
    <block>
      <block>
        <block>
          <block>
            {'Existing 1 '}
            <cursor />
          </block>
          <block>Existing 2</block>
        </block>
      </block>
    </block>
  </editor>
)
// Deferred table-merge policy: decide whether the second source cell merges
// into the existing second target cell or remains a new sibling cell.
export const output = (
  <editor>
    <block>
      <block>
        <block>
          <block>Existing 1 New 1</block>
          <block>
            New 2<cursor />
          </block>
          <block>Existing 2</block>
        </block>
      </block>
    </block>
  </editor>
)
export const skip = true
