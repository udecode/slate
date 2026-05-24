import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { setDebugValueScrubber } from '../src'
import { formatDebugValue } from '../src/internal'

describe('formatDebugValue', () => {
  afterEach(() => {
    setDebugValueScrubber(undefined)
  })

  it('formats circular values without throwing', () => {
    const value: { child?: unknown; text: string } = { text: 'alpha' }
    value.child = value

    assert.equal(
      formatDebugValue(value),
      '{"text":"alpha","child":"[Circular]"}'
    )
  })

  it('falls back when JSON serialization throws', () => {
    assert.equal(formatDebugValue(1n), '[object BigInt]')
  })

  it('applies the configured scrubber before formatting errors', () => {
    const value: { child?: unknown; text: string } = { text: 'secret' }
    value.child = value

    setDebugValueScrubber((key, item) => (key === 'text' ? '[redacted]' : item))

    assert.equal(
      formatDebugValue(value),
      '{"text":"[redacted]","child":"[Circular]"}'
    )
  })
})
