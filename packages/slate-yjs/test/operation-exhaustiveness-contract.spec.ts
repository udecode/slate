import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Operation } from 'slate'
import * as Y from 'yjs'

import {
  applySlateOperationToYjs,
  isNoopSlateOperationForYjs,
} from '../src/core/operations'

// The encoder still needs a runtime guard for operation types newer than this package.
const futureSlateOperation = (type: string): Operation =>
  ({ type }) as unknown as Operation

describe('@slate/yjs operation encoder exhaustiveness contract', () => {
  it('treats replace operations with equivalent object attributes as no-ops', () => {
    const operation: Operation = {
      children: [
        {
          role: 'note',
          children: [{ text: 'alpha' }],
          type: 'paragraph',
        },
      ],
      newChildren: [
        {
          type: 'paragraph',
          children: [{ text: 'alpha' }],
          role: 'note',
        },
      ],
      newSelection: null,
      path: [],
      selection: null,
      type: 'replace_fragment',
    }

    assert.equal(isNoopSlateOperationForYjs(operation), true)
  })

  it('treats selection operations as document-content no-ops', () => {
    const doc = new Y.Doc()
    const root = doc.get('slate', Y.XmlElement)
    const operation: Operation = {
      newProperties: {
        anchor: { path: [0, 0], offset: 1 },
        focus: { path: [0, 0], offset: 1 },
      },
      properties: null,
      type: 'set_selection',
    }

    assert.equal(applySlateOperationToYjs(root, operation), null)
  })

  it('rejects a future Slate operation instead of silently skipping it', () => {
    const doc = new Y.Doc()
    const root = doc.get('slate', Y.XmlElement)
    const operation = futureSlateOperation('future_operation')

    assert.throws(
      () => applySlateOperationToYjs(root, operation),
      /Unsupported Yjs operation: future_operation/
    )
  })
})
