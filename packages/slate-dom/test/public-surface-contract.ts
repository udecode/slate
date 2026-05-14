import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createEditor } from 'slate'

import * as SlateDOM from '../src'

describe('slate-dom public surface contract', () => {
  it('keeps the internal DOMEditor static namespace out of the public root at runtime', () => {
    assert.equal('DOMEditor' in SlateDOM, false)
    assert.equal(typeof SlateDOM.withDOM, 'function')
  })

  it('exposes nullable resolver methods without try-style aliases', () => {
    const editor = SlateDOM.withDOM(createEditor())
    const resolverNames = [
      'resolveDOMNode',
      'resolveDOMPoint',
      'resolveDOMRange',
      'resolveEventRange',
      'resolvePath',
      'resolveRangeRect',
      'resolveSlateNode',
      'resolveSlatePoint',
      'resolveSlateRange',
    ]

    for (const name of resolverNames) {
      assert.equal(
        typeof editor.dom[name as keyof typeof editor.dom],
        'function'
      )
    }

    for (const name of Object.keys(editor.dom)) {
      assert.equal(
        /^try/i.test(name),
        false,
        `${name} must not use try* naming`
      )
    }
  })
})
