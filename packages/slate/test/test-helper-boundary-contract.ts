import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'

import * as Slate from '../src'
import { createEditor, type Descendant } from '../src'
import { getTestEditorSnapshot } from './support/snapshot'

const repoRoot = resolve(import.meta.dir, '../../..')

const paragraph = (text: string): Descendant => ({
  type: 'paragraph',
  children: [{ text }],
})

describe('test helper snapshot boundary', () => {
  it('keeps full snapshots in test support instead of public Slate exports', () => {
    const editor = createEditor()

    editor.update((tx) => {
      tx.value.replace({
        children: [paragraph('test snapshot')],
        selection: {
          anchor: { path: [0, 0], offset: 4 },
          focus: { path: [0, 0], offset: 8 },
        },
      })
    })

    const snapshot = getTestEditorSnapshot(editor)

    assert.deepEqual(snapshot.children, [paragraph('test snapshot')])
    assert.deepEqual(snapshot.selection, {
      anchor: { path: [0, 0], offset: 4 },
      focus: { path: [0, 0], offset: 8 },
    })
    assert.equal('getTestEditorSnapshot' in Slate, false)
  })

  it('implements the helper through the runtime snapshot state group', () => {
    const helperSource = readFileSync(
      resolve(repoRoot, 'packages/slate/test/support/snapshot.ts'),
      'utf8'
    )

    assert.match(helperSource, /state\.runtime\.snapshot\(\)/)
    assert.equal(/\bEditor\.getSnapshot\b/.test(helperSource), false)
    assert.equal(/from ['"]slate\/internal['"]/.test(helperSource), false)
  })
})
