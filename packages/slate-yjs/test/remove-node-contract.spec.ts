import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Descendant } from 'slate'
import {
  assertPeerTexts,
  connectYjsPeerAndSync,
  createSeededYjsPeers,
  createYjsPeer,
  disconnectAndClearYjsTrace,
  disconnectYjsPeer,
  getPeerTopLevelTexts,
  getYjsTrace,
  type Peer,
  paragraph,
  redoYjsPeerAndSync,
  syncConnectedPeers,
  undoYjsPeerAndSync,
} from './support/collaboration'

const initialValue = (): Descendant[] => [
  paragraph('alpha'),
  paragraph('beta'),
  paragraph('gamma'),
]

const createPeer = (clientId: string, seedUpdate?: Uint8Array): Peer =>
  createYjsPeer({ children: initialValue(), clientId, seedUpdate })

const createPeers = (clientIds: readonly string[]): Peer[] =>
  createSeededYjsPeers({ children: initialValue(), clientIds })

const removeMiddleBlock = (peer: Peer): void => {
  peer.editor.update((tx) => {
    tx.nodes.remove({ at: [1] })
  })
}

const insertRemoteText = (peer: Peer): void => {
  peer.editor.update((tx) => {
    tx.text.insert('!', { at: { path: [0, 0], offset: 'alpha'.length } })
  })
}

describe('@slate/yjs remove_node collaboration contract', () => {
  it('applies local offline remove_node without a root snapshot fallback', () => {
    const peer = createPeer('b')

    disconnectAndClearYjsTrace(peer)
    removeMiddleBlock(peer)

    assert.deepEqual(getPeerTopLevelTexts(peer), ['alpha', 'gamma'])
    assert.deepEqual(getYjsTrace(peer), [
      { mode: 'operation', operationType: 'remove_node' },
    ])
  })

  it('preserves concurrent remote sibling edits when an offline remove_node reconnects', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    disconnectYjsPeer(b)
    removeMiddleBlock(b)
    insertRemoteText(a)
    syncConnectedPeers(peers)

    assert.deepEqual(getPeerTopLevelTexts(a), ['alpha!', 'beta', 'gamma'])
    assert.deepEqual(getPeerTopLevelTexts(b), ['alpha', 'gamma'])

    connectYjsPeerAndSync(b, peers)

    assertPeerTexts(peers, ['alpha!', 'gamma'])
  })

  it('recovers convergence through real Yjs updates after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [, b] = peers

    disconnectYjsPeer(b)
    removeMiddleBlock(b)
    connectYjsPeerAndSync(b, peers)

    assertPeerTexts(peers, ['alpha', 'gamma'])
  })

  it('undoes and redoes only the local remove_node intent after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    disconnectYjsPeer(b)
    removeMiddleBlock(b)
    insertRemoteText(a)
    syncConnectedPeers(peers)

    connectYjsPeerAndSync(b, peers)
    assertPeerTexts(peers, ['alpha!', 'gamma'])

    undoYjsPeerAndSync(b, peers)
    assertPeerTexts(peers, ['alpha!', 'beta', 'gamma'])

    redoYjsPeerAndSync(b, peers)
    assertPeerTexts(peers, ['alpha!', 'gamma'])
  })
})
