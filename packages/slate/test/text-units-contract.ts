import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getCharacterDistance, getWordDistance } from '../src/text-units'

describe('slate text-units contract', () => {
  it('measures basic grapheme distance left-to-right', () => {
    assert.equal(getCharacterDistance('a'), 1)
    assert.equal(getCharacterDistance('🙂🙂'), 2)
    assert.equal(getCharacterDistance('🏁🇨🇳🏁🇨🇳'), 2)
    assert.equal(getCharacterDistance('👩‍❤️‍👨👩‍❤️‍👨'), 8)
  })

  it('measures basic grapheme distance right-to-left', () => {
    assert.equal(getCharacterDistance('a', true), 1)
    assert.equal(getCharacterDistance('🇨🇳🎌', true), 2)
    assert.equal(getCharacterDistance('🏴🏳️', true), 3)
  })

  it('measures word distance left-to-right', () => {
    assert.equal(getWordDistance('hello foobarbaz'), 5)
    assert.equal(getWordDistance("Don't do this"), 5)
    assert.equal(getWordDistance("I'm ok"), 3)
  })

  it('measures word distance right-to-left', () => {
    assert.equal(getWordDistance('hello foobarbaz', true), 9)
    assert.equal(getWordDistance("Don't", true), 5)
    assert.equal(getWordDistance("Don't do this", true), 4)
    assert.equal(getWordDistance("I'm", true), 3)
  })

  it('handles punctuation and keycap sequences consistently', () => {
    assert.equal(getCharacterDistance('#️⃣#️⃣'), 3)
    assert.equal(getCharacterDistance('*️⃣*️⃣'), 3)
    assert.equal(getWordDistance("Don't do this", true), 4)
  })
})
