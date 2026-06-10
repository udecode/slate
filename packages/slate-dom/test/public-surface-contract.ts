import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { createEditor } from 'slate'

import * as SlateDOM from '../src'

const packageJsonPath = fileURLToPath(
  new URL('../package.json', import.meta.url)
)

describe('slate-dom public surface contract', () => {
  it('publishes root export declarations through the export map', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      exports: Record<string, unknown>
    }

    assert.deepEqual(packageJson.exports['.'], {
      types: './dist/index.d.ts',
      import: './dist/index.js',
      default: './dist/index.js',
    })
  })

  it('keeps the internal DOMEditor static namespace out of the public root at runtime', () => {
    assert.equal('DOMEditor' in SlateDOM, false)
    assert.equal('withDOM' in SlateDOM, false)
    assert.equal(typeof SlateDOM.dom, 'function')
  })

  it('treats nodes from torn down DOM views as non-DOM values', () => {
    const tornDownTextNode = {
      nodeType: 3,
      ownerDocument: {
        defaultView: {},
      },
    }

    assert.doesNotThrow(() => SlateDOM.isDOMNode(tornDownTextNode))
    assert.equal(SlateDOM.isDOMNode(tornDownTextNode), false)
    assert.equal(SlateDOM.isDOMText(tornDownTextNode), false)
  })

  it('exposes nullable resolver methods without try-style aliases', () => {
    const editor = createEditor({ extensions: [SlateDOM.dom()] })
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
        typeof editor.api.dom[name as keyof typeof editor.api.dom],
        'function'
      )
    }

    for (const name of Object.keys(editor.api.dom)) {
      assert.equal(
        /^try/i.test(name),
        false,
        `${name} must not use try* naming`
      )
    }
  })

  it('uses resolve/assert names for DOM mapping contracts', () => {
    const editor = createEditor({ extensions: [SlateDOM.dom()] })
    const assertNames = [
      'assertDOMNode',
      'assertDOMPoint',
      'assertDOMRange',
      'assertEventRange',
      'assertPath',
      'assertSlateNode',
      'assertSlatePoint',
      'assertSlateRange',
    ]
    const removedStrictMappingNames = [
      'findEventRange',
      'findPath',
      'toDOMNode',
      'toDOMPoint',
      'toDOMRange',
      'toSlateNode',
      'toSlatePoint',
      'toSlateRange',
    ]

    for (const name of assertNames) {
      assert.equal(
        typeof editor.api.dom[name as keyof typeof editor.api.dom],
        'function',
        `${name} should expose the assertion contract`
      )
    }

    for (const name of removedStrictMappingNames) {
      assert.equal(
        name in editor.api.dom,
        false,
        `${name} should not be public DOM mapping API`
      )
    }
  })
})
