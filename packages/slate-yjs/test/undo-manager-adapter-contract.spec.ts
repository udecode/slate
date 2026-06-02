import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import * as Y from 'yjs'

import {
  createYjsUndoManagerAdapter,
  SUPPORTED_YJS_UNDO_MANAGER_VERSION,
} from '../src/core/undo-manager-adapter'

describe('@slate/yjs UndoManager adapter contract', () => {
  it('isolates the private Yjs stack access used by split history replay', () => {
    const doc = new Y.Doc()
    const root = doc.get('slate', Y.XmlElement)
    const origin = {}
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
    assert.equal(adapter.peekRedo(), undoItem)
    assert.equal(adapter.redoDepth(), 1)

    adapter.moveRedoToUndo(undoItem)
    assert.equal(adapter.peekUndo(), undoItem)

    undoManager.destroy()
    doc.destroy()
  })

  it('pins Yjs private stack usage to one adapter file and a fixed version', () => {
    const controllerSource = readFileSync(
      new URL('../src/core/controller.ts', import.meta.url),
      'utf8'
    )
    const adapterSource = readFileSync(
      new URL('../src/core/undo-manager-adapter.ts', import.meta.url),
      'utf8'
    )

    assert.equal(SUPPORTED_YJS_UNDO_MANAGER_VERSION, '13.6.30')
    assert.equal(controllerSource.includes('undoStack'), false)
    assert.equal(controllerSource.includes('redoStack'), false)
    assert.equal(adapterSource.includes('undoStack'), true)
    assert.equal(adapterSource.includes('redoStack'), true)
  })
})
