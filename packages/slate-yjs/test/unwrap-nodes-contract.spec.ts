import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { type Descendant, defineEditorExtension } from 'slate'
import { Editor } from 'slate/internal'

import {
  assertNoRootSnapshot,
  assertPeerTexts,
  createSeededYjsPeers,
  createYjsPeer,
  getParagraphTexts,
  getYjsNodeAt,
  getYjsState,
  runYjsUpdate,
  syncConnectedPeers,
} from './support/collaboration'

const clientIds = {
  a: 1,
  b: 2,
  c: 3,
} as const

const paragraph = (text: string): Descendant => ({
  type: 'paragraph',
  children: [{ text }],
})

const initialValue = () => [paragraph('alpha')]

const createPeer = (
  clientId: keyof typeof clientIds,
  seedUpdate?: Uint8Array
) =>
  createYjsPeer({
    children: initialValue(),
    clientId,
    numericClientId: clientIds[clientId],
    seedUpdate,
  })

const createPeers = (ids: Array<keyof typeof clientIds>) =>
  createSeededYjsPeers({
    children: initialValue(),
    clientIds: ids,
    numericClientIds: clientIds,
  })

const topLevelTypes = (peer: ReturnType<typeof createPeer>) =>
  Editor.getSnapshot(peer.editor).children.map((node) =>
    'type' in node ? node.type : 'text'
  )

const wrapFirstBlock = (peer: ReturnType<typeof createPeer>) => {
  peer.editor.update((tx) => {
    tx.nodes.wrap({ children: [], type: 'quote' }, { at: [0] })
  })
}

const unwrapFirstBlock = (peer: ReturnType<typeof createPeer>) => {
  peer.editor.update((tx) => {
    tx.nodes.unwrap({ at: [0] })
  })
}

const appendRemoteText = (peer: ReturnType<typeof createPeer>) => {
  const [type] = topLevelTypes(peer)
  const textPath = type === 'quote' ? [0, 0, 0] : [0, 0]

  peer.editor.update((tx) => {
    tx.text.insert('!', { at: { path: textPath, offset: 'alpha'.length } })
  })
}

const createWrappedPeer = (clientId: keyof typeof clientIds) => {
  const peer = createPeer(clientId)

  wrapFirstBlock(peer)
  runYjsUpdate(peer, (yjs) => yjs.clearTrace())

  return peer
}

const createWrappedPeers = (ids: Array<keyof typeof clientIds>) => {
  const peers = createPeers(ids)

  wrapFirstBlock(peers[0]!)
  syncConnectedPeers(peers)

  for (const peer of peers) {
    runYjsUpdate(peer, (yjs) => yjs.clearTrace())
  }

  return peers
}

const collectUnwrapOperations = () => {
  const peer = createWrappedPeer('b')
  const operations: string[] = []

  peer.editor.extend(
    defineEditorExtension({
      name: 'unwrap-operation-recorder',
      setup() {
        return {
          onCommit({ commit }) {
            operations.push(
              ...commit.operations.map((operation) => operation.type)
            )
          },
        }
      },
    })
  )
  unwrapFirstBlock(peer)

  return operations
}

describe('@slate/yjs unwrapNodes collaboration contract', () => {
  it('characterizes public unwrapNodes as move_node then remove_node', () => {
    assert.deepEqual(collectUnwrapOperations(), ['move_node', 'remove_node'])
  })

  it('applies local offline public unwrap without replacing the original Yjs node', () => {
    const peer = createWrappedPeer('b')
    const original = getYjsNodeAt(peer, [1])

    runYjsUpdate(peer, (yjs) => yjs.disconnect())
    unwrapFirstBlock(peer)

    assert.deepEqual(getParagraphTexts(peer), ['alpha'])
    assert.deepEqual(topLevelTypes(peer), ['paragraph'])
    assert.equal(getYjsNodeAt(peer, [0]), original)
    assert.deepEqual(getYjsState(peer).trace(), [
      {
        fallback: 'virtual-unwrap-ref',
        mode: 'traceable-fallback',
        operationType: 'move_node',
      },
      {
        fallback: 'virtual-unwrap-wrapper-remove',
        mode: 'traceable-fallback',
        operationType: 'remove_node',
      },
    ])
    assertNoRootSnapshot(peer)
  })

  it('preserves concurrent remote text when an offline unwrap reconnects', () => {
    const peers = createWrappedPeers(['a', 'b', 'c'])
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    unwrapFirstBlock(b)
    appendRemoteText(a)
    syncConnectedPeers(peers)

    assert.deepEqual(getParagraphTexts(a), ['alpha!'])
    assert.deepEqual(topLevelTypes(a), ['quote'])
    assert.deepEqual(getParagraphTexts(b), ['alpha'])
    assert.deepEqual(topLevelTypes(b), ['paragraph'])

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)

    assertPeerTexts(peers, ['alpha!'])
    assert.deepEqual(topLevelTypes(a), ['paragraph'])
    assert.deepEqual(topLevelTypes(b), ['paragraph'])
    assertNoRootSnapshot(b)
  })

  it('recovers unwrap convergence through real Yjs updates after reconnect', () => {
    const peers = createWrappedPeers(['a', 'b', 'c'])
    const [, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    unwrapFirstBlock(b)
    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)

    assertPeerTexts(peers, ['alpha'])
    assert.deepEqual(topLevelTypes(b), ['paragraph'])
  })

  it('undoes and redoes only the local unwrap intent after reconnect', () => {
    const peers = createWrappedPeers(['a', 'b', 'c'])
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    unwrapFirstBlock(b)
    appendRemoteText(a)
    syncConnectedPeers(peers)

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)
    assertPeerTexts(peers, ['alpha!'])
    assert.deepEqual(topLevelTypes(b), ['paragraph'])

    runYjsUpdate(b, (yjs) => yjs.undo())
    syncConnectedPeers(peers)
    assertPeerTexts(peers, ['alpha!'])
    assert.deepEqual(topLevelTypes(b), ['quote'])

    runYjsUpdate(b, (yjs) => yjs.redo())
    syncConnectedPeers(peers)
    assertPeerTexts(peers, ['alpha!'])
    assert.deepEqual(topLevelTypes(b), ['paragraph'])
    assertNoRootSnapshot(b)
  })
})
