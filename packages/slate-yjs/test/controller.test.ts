import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createEditor, type Range, type Value } from 'slate'
import { Editor } from 'slate/internal'
import * as Y from 'yjs'

import {
  connectYjsLocalAwareness,
  createYjsExtension,
  createYjsLocalAwareness,
  type YjsController,
  type YjsLocalAwareness,
} from '../src'

const paragraph = (text: string): Value[number] => ({
  type: 'paragraph',
  children: [{ text }],
})

const collapsed = (offset: number): Range => ({
  anchor: { path: [0, 0], offset },
  focus: { path: [0, 0], offset },
})

const selection = (anchor: number, focus: number): Range => ({
  anchor: { path: [0, 0], offset: anchor },
  focus: { path: [0, 0], offset: focus },
})

const createSeededEditor = (text: string) => {
  const editor = createEditor()

  Editor.replace(editor, {
    children: [paragraph(text)],
    marks: null,
    selection: collapsed(text.length),
  })

  return editor
}

const endPoint = (editor: ReturnType<typeof createSeededEditor>) => ({
  path: [0, 0],
  offset: Editor.string(editor, [0]).length,
})

const createPeer = ({
  clientID,
  doc,
  text,
  user,
}: {
  clientID: number
  doc: Y.Doc
  text: string
  user: { color: string; name: string }
}) => {
  const sharedRoot = doc.get('content', Y.XmlText) as Y.XmlText
  const awareness = createYjsLocalAwareness(clientID)
  const controller = createYjsExtension({ awareness, sharedRoot })
  const editor = createSeededEditor(text)
  const unextend = editor.extend(controller.extension)

  awareness.setLocalState({ user })

  return { awareness, controller, editor, unextend }
}

const syncDocs = (source: Y.Doc, target: Y.Doc) => {
  Y.applyUpdate(target, Y.encodeStateAsUpdate(source))
}

const connectPeerControllers = (
  left: { controller: YjsController },
  right: { controller: YjsController }
) => {
  left.controller.connect()
  right.controller.connect()
}

describe('slate-yjs controller', () => {
  it('exports local commits and imports remote Yjs events without editor monkey patches', () => {
    const leftDoc = new Y.Doc()
    const rightDoc = new Y.Doc()
    const left = createPeer({
      clientID: 1,
      doc: leftDoc,
      text: 'one',
      user: { color: '#2563eb', name: 'Left' },
    })
    const right = createPeer({
      clientID: 2,
      doc: rightDoc,
      text: '',
      user: { color: '#059669', name: 'Right' },
    })

    left.controller.connect()
    syncDocs(leftDoc, rightDoc)
    right.controller.connect()

    assert.equal('apply' in left.editor, false)
    assert.equal('onChange' in left.editor, false)
    assert.equal('connectYjs' in left.editor, false)
    assert.equal(Editor.string(right.editor, []), 'one')

    left.editor.update((tx) => {
      tx.text.insert('!', { at: endPoint(left.editor) })
    })
    syncDocs(leftDoc, rightDoc)

    assert.equal(Editor.string(left.editor, []), 'one!')
    assert.equal(Editor.string(right.editor, []), 'one!')
    assert.equal(left.controller.getState().exports, 1)
    assert.equal(right.controller.getState().imports, 2)
    assert.deepEqual(Editor.getLastCommit(right.editor)?.tags, [
      'collaboration',
      'remote-import',
    ])
    assert.deepEqual(Editor.getLastCommit(right.editor)?.metadata, {
      collab: { origin: 'remote', saveToHistory: false },
      history: { mode: 'skip' },
      selection: { dom: 'preserve', focus: false, scroll: false },
    })

    left.unextend()
    right.unextend()
  })

  it('keeps selection-only commits in awareness instead of document exports', () => {
    const leftDoc = new Y.Doc()
    const rightDoc = new Y.Doc()
    const left = createPeer({
      clientID: 1,
      doc: leftDoc,
      text: 'alpha',
      user: { color: '#2563eb', name: 'Left' },
    })
    const right = createPeer({
      clientID: 2,
      doc: rightDoc,
      text: '',
      user: { color: '#059669', name: 'Right' },
    })
    const disconnectAwareness = connectYjsLocalAwareness(
      left.awareness as YjsLocalAwareness,
      right.awareness as YjsLocalAwareness
    )

    left.controller.connect()
    syncDocs(leftDoc, rightDoc)
    right.controller.connect()

    left.editor.update((tx) => {
      tx.selection.set(selection(1, 4))
    })

    assert.equal(left.controller.getState().exports, 0)
    const [remoteCursor] = right.controller.getRemoteCursorStates()

    assert(remoteCursor)
    assert.equal(remoteCursor.clientId, 1)
    assert.deepEqual(remoteCursor.data, { color: '#2563eb', name: 'Left' })
    assert.deepEqual(remoteCursor.range, selection(1, 4))
    assert(remoteCursor.relativeRange)
    assert.deepEqual(remoteCursor.user, { color: '#2563eb', name: 'Left' })

    left.controller.disconnect()

    assert.equal(right.controller.getRemoteCursorStates()[0]?.range, null)

    disconnectAwareness()
    left.unextend()
    right.unextend()
  })

  it('can pause remote imports and reconcile the skipped Yjs snapshot on resume', () => {
    const leftDoc = new Y.Doc()
    const rightDoc = new Y.Doc()
    const left = createPeer({
      clientID: 1,
      doc: leftDoc,
      text: 'draft',
      user: { color: '#2563eb', name: 'Left' },
    })
    const right = createPeer({
      clientID: 2,
      doc: rightDoc,
      text: '',
      user: { color: '#059669', name: 'Right' },
    })

    connectPeerControllers(left, right)
    syncDocs(leftDoc, rightDoc)
    right.controller.reconcile()
    right.controller.pause()

    left.editor.update((tx) => {
      tx.text.insert('?', { at: endPoint(left.editor) })
    })
    syncDocs(leftDoc, rightDoc)

    assert.equal(Editor.string(left.editor, []), 'draft?')
    assert.equal(Editor.string(right.editor, []), 'draft')
    assert.equal(right.controller.getState().connection, 'paused')

    right.controller.resume()

    assert.equal(Editor.string(right.editor, []), 'draft?')
    assert.equal(right.controller.getState().connection, 'connected')

    left.unextend()
    right.unextend()
  })
})
