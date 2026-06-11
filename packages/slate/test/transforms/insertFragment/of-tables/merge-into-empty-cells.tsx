/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const run = (editor, options = {}) => {
  editor.fragment.insert(
    <block>
      <block>
        <block>
          <block>1</block>
          <block>2</block>
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
            <cursor />
          </block>
          <block>
            <text />
          </block>
        </block>
      </block>
    </block>
  </editor>
)
// Deferred table-merge policy: decide whether the second source cell merges
// into the empty second target cell or remains a new sibling cell.
export const output = (
  <editor>
    <block>
      <block>
        <block>
          <block>1</block>
          <block>
            2<cursor />
          </block>
          <block>
            <text />
          </block>
        </block>
      </block>
    </block>
  </editor>
)
export const skip = true
