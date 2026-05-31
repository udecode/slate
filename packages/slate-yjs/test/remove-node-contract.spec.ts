import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createEditor, type Descendant } from 'slate'
import { Editor } from 'slate/internal'
import * as Y from 'yjs'

import { createYjsExtension } from '../src'

type Peer = {
  doc: Y.Doc
  editor: ReturnType<typeof createEditor>
}

const paragraph = (text: string): Descendant => ({
  type: 'paragraph',
  children: [{ text }],
})

const initialValue = () => [
  paragraph('alpha'),
  paragraph('beta'),
  paragraph('gamma'),
]

const createPeer = (clientId: string, seedUpdate?: Uint8Array): Peer => {
  const editor = createEditor()

  Editor.replace(editor, {
    children: initialValue(),
    selection: null,
    marks: null,
  })

  const doc = new Y.Doc()

  if (seedUpdate) {
    Y.applyUpdate(doc, seedUpdate)
  }

  editor.extend(createYjsExtension({ clientId, doc, rootName: 'slate' }))

  return { doc, editor }
}

const createPeers = (clientIds: string[]) => {
  const [firstClientId, ...remainingClientIds] = clientIds

  if (!firstClientId) {
    return []
  }

  const firstPeer = createPeer(firstClientId)
  const seedUpdate = Y.encodeStateAsUpdate(firstPeer.doc)

  return [
    firstPeer,
    ...remainingClientIds.map((clientId) => createPeer(clientId, seedUpdate)),
  ]
}

const yjsState = (peer: Peer) => peer.editor.read((state) => (state as any).yjs)

const yjsUpdate = (peer: Peer, fn: (tx: any) => void) => {
  peer.editor.update((tx) => {
    fn((tx as any).yjs)
  })
}

const paragraphTexts = (peer: Peer) =>
  Editor.getSnapshot(peer.editor).children.map((_, index) =>
    Editor.string(peer.editor, [index])
  )

const assertNoRootSnapshot = (peer: Peer) => {
  assert.equal(
    yjsState(peer)
      .trace()
      .some((entry: { mode: string }) => entry.mode === 'root-snapshot'),
    false
  )
}

const syncConnected = (peers: Peer[]) => {
  for (const source of peers) {
    if (!yjsState(source).connected()) {
      continue
    }

    const update = Y.encodeStateAsUpdate(source.doc)

    for (const target of peers) {
      if (source === target || !yjsState(target).connected()) {
        continue
      }

      Y.applyUpdate(target.doc, update, source)
    }
  }
}

const assertAllTexts = (peers: Peer[], expected: string[]) => {
  for (const peer of peers) {
    assert.deepEqual(paragraphTexts(peer), expected)
  }
}

const removeMiddleBlock = (peer: Peer) => {
  peer.editor.update((tx) => {
    tx.nodes.remove({ at: [1] })
  })
}

const insertRemoteText = (peer: Peer) => {
  peer.editor.update((tx) => {
    tx.text.insert('!', { at: { path: [0, 0], offset: 'alpha'.length } })
  })
}

describe('@slate/yjs remove_node collaboration contract', () => {
  it('applies local offline remove_node without a root snapshot fallback', () => {
    const peer = createPeer('b')

    yjsUpdate(peer, (yjs) => yjs.disconnect())
    yjsUpdate(peer, (yjs) => yjs.clearTrace())
    removeMiddleBlock(peer)

    assert.deepEqual(paragraphTexts(peer), ['alpha', 'gamma'])
    assert.deepEqual(yjsState(peer).trace(), [
      { mode: 'operation', operationType: 'remove_node' },
    ])
    assertNoRootSnapshot(peer)
  })

  it('preserves concurrent remote sibling edits when an offline remove_node reconnects', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    yjsUpdate(b, (yjs) => yjs.disconnect())
    removeMiddleBlock(b)
    insertRemoteText(a)
    syncConnected(peers)

    assert.deepEqual(paragraphTexts(a), ['alpha!', 'beta', 'gamma'])
    assert.deepEqual(paragraphTexts(b), ['alpha', 'gamma'])

    yjsUpdate(b, (yjs) => yjs.connect())
    syncConnected(peers)

    assertAllTexts(peers, ['alpha!', 'gamma'])
    assertNoRootSnapshot(b)
  })

  it('recovers convergence through real Yjs updates after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [, b] = peers

    yjsUpdate(b, (yjs) => yjs.disconnect())
    removeMiddleBlock(b)
    yjsUpdate(b, (yjs) => yjs.connect())
    syncConnected(peers)

    assertAllTexts(peers, ['alpha', 'gamma'])
  })

  it('undoes and redoes only the local remove_node intent after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    yjsUpdate(b, (yjs) => yjs.disconnect())
    removeMiddleBlock(b)
    insertRemoteText(a)
    syncConnected(peers)

    yjsUpdate(b, (yjs) => yjs.connect())
    syncConnected(peers)
    assertAllTexts(peers, ['alpha!', 'gamma'])

    yjsUpdate(b, (yjs) => yjs.undo())
    syncConnected(peers)
    assertAllTexts(peers, ['alpha!', 'beta', 'gamma'])

    yjsUpdate(b, (yjs) => yjs.redo())
    syncConnected(peers)
    assertAllTexts(peers, ['alpha!', 'gamma'])
    assertNoRootSnapshot(b)
  })
})
