import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createEditor, type Descendant } from '../src'

const paragraph = (text: string) =>
  ({
    type: 'paragraph',
    children: [{ text }],
  }) satisfies Descendant

describe('createEditor value contract', () => {
  it('normalizes every supported initialValue shape to canonical rooted value', () => {
    const children = [paragraph('body')]
    const state = { 'document.title': 'Q2 Plan' }
    const header = [paragraph('header')]

    const fromChildren = createEditor({ initialValue: children })
    const fromDocument = createEditor({
      initialValue: { children, state },
    })
    const fromRoots = createEditor({
      initialValue: { roots: { header, main: children }, state },
    })

    assert.deepEqual(
      fromChildren.read((state) => state.value.get()),
      {
        roots: { main: children },
      }
    )
    assert.deepEqual(
      fromChildren.read((state) => state.nodes.children()),
      children
    )
    assert.deepEqual(
      fromDocument.read((state) => state.value.get()),
      {
        roots: { main: children },
        state,
      }
    )
    assert.deepEqual(
      fromRoots.read((state) => state.value.get()),
      {
        roots: { header, main: children },
        state,
      }
    )
  })
})
