/** @jsx jsx */

import { jsx } from '../..'

jsx

export const input = (
  <editor>
    <element>
      a<cursor />
    </element>
  </editor>
)

export const operations = [
  {
    type: 'set_selection',
    oldProperties: {},
    newProperties: { custom: 123 },
  },
]

export const output = (
  <editor>
    <element>
      a<cursor />
    </element>
  </editor>
)

output.update(() => {
  output.setSelection({ custom: 123 })
})
