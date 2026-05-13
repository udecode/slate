import { type Node, ScrubberApi } from 'slate'

export const input = {
  customField: 'some very long custom field value that will get scrubbed',
  anotherField: 'this field should not get scrambled',
}

export const test = (value: Node) => {
  ScrubberApi.setScrubber((key, value) =>
    key === 'customField' ? '... scrubbed ...' : value
  )
  const stringified = ScrubberApi.stringify(value)
  ScrubberApi.setScrubber(undefined)

  const unmarshaled = JSON.parse(stringified)
  return (
    // ensure that first field has been scrubbed
    unmarshaled.customField === '... scrubbed ...' &&
    // ensure that second field is unaltered
    unmarshaled.anotherField === input.anotherField
  )
}

export const output = true
