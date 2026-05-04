import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import * as SlateDOM from '../src'

describe('slate-dom public surface contract', () => {
  it('keeps the internal DOMEditor static namespace out of the public root at runtime', () => {
    assert.equal('DOMEditor' in SlateDOM, false)
    assert.equal(typeof SlateDOM.withDOM, 'function')
  })
})
