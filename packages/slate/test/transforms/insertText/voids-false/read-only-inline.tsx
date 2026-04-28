/** @jsx jsx */

import { jsx } from '../../..'

jsx

export const input = (
  <editor>
    <block>
      <text />
      <inline readOnly>
        read-only <cursor />
        inline
      </inline>
    </block>
  </editor>
)
export const run = (editor) => {
  editor.insertText('x')
}
export const output = (
  <editor>
    <block>
      <text />
      <inline readOnly>
        read-only <cursor />
        inline
      </inline>
    </block>
  </editor>
)
