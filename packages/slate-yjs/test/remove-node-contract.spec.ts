import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Descendant } from 'slate'
import {
  assertNoRootSnapshot,
  assertPeerTexts,
  createSeededYjsPeers,
  createYjsPeer,
  getParagraphTexts,
  getYjsState,
  type Peer,
  runYjsUpdate,
  syncConnectedPeers,
} from './support/collaboration'

const paragraph = (text: string): Descendant => ({
  type: 'paragraph',
  children: [{ text }],
})

const initialValue = () => [
  paragraph('alpha'),
  paragraph('beta'),
  paragraph('gamma'),
]

const createPeer = (clientId: string, seedUpdate?: Uint8Array): Peer =>
  createYjsPeer({ children: initialValue(), clientId, seedUpdate })

const createPeers = (clientIds: string[]) => {
  return createSeededYjsPeers({ children: initialValue(), clientIds })
}

const yjsState = getYjsState
const yjsUpdate = runYjsUpdate
const paragraphTexts = getParagraphTexts
const syncConnected = syncConnectedPeers
const assertAllTexts = assertPeerTexts

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
