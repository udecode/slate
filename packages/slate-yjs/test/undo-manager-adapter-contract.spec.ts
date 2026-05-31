import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import * as Y from 'yjs'

import {
  createYjsUndoManagerAdapter,
  SUPPORTED_YJS_UNDO_MANAGER_VERSION,
} from '../src/core/undo-manager-adapter'

describe('@slate/yjs Yjs UndoManager stack adapter contract', () => {
  it('pins the Yjs stack contract to the audited version', () => {
    assert.equal(SUPPORTED_YJS_UNDO_MANAGER_VERSION, '13.6.30')
  })

  it('stores metadata and moves audited stack items through the adapter', () => {
    const doc = new Y.Doc()
    const origin = {}
    const root = doc.get('slate', Y.XmlElement)
    const undoManager = new Y.UndoManager(root, {
      trackedOrigins: new Set([origin]),
    })
    const adapter = createYjsUndoManagerAdapter(undoManager)

    doc.transact(() => {
      root.insert(0, [new Y.XmlText()])
    }, origin)
    undoManager.stopCapturing()

    const undoItem = adapter.peekUndo()

    assert.ok(undoItem)
    adapter.storeUndoMeta('contract', 42)
    assert.equal(undoItem.meta.get('contract'), 42)

    adapter.moveUndoToRedo(undoItem)
    assert.equal(adapter.peekUndo(), null)
    assert.equal(adapter.peekRedo(), undoItem)

    adapter.moveRedoToUndo(undoItem)
    assert.equal(adapter.peekUndo(), undoItem)
    assert.equal(adapter.peekRedo(), null)

    undoManager.destroy()
  })

  it('keeps private stack property access isolated to the adapter', () => {
    const controllerSource = readFileSync(
      new URL('../src/core/controller.ts', import.meta.url),
      'utf8'
    )
    const adapterSource = readFileSync(
      new URL('../src/core/undo-manager-adapter.ts', import.meta.url),
      'utf8'
    )

    assert.equal(controllerSource.includes('undoStack'), false)
    assert.equal(controllerSource.includes('redoStack'), false)
    assert.equal(adapterSource.includes('undoStack'), true)
    assert.equal(adapterSource.includes('redoStack'), true)
  })
})
