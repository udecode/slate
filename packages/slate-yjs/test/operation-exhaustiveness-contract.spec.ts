import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Operation } from 'slate'
import * as Y from 'yjs'

import { applySlateOperationToYjs } from '../src/core/operations'

describe('@slate/yjs operation encoder exhaustiveness contract', () => {
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
    const operation = {
      type: 'future_operation',
    } as unknown as Operation

    assert.throws(
      () => applySlateOperationToYjs(root, operation),
      /Unsupported Yjs operation: future_operation/
    )
  })
})
