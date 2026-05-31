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

const appendRemoteText = (peer: ReturnType<typeof createPeer>) => {
  peer.editor.update((tx) => {
    tx.text.insert('!', { at: { path: [0, 0], offset: 'alpha'.length } })
  })
}

const collectWrapOperations = () => {
  const peer = createPeer('b')
  const operations: string[] = []

  peer.editor.extend(
    defineEditorExtension({
      name: 'wrap-operation-recorder',
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
  wrapFirstBlock(peer)

  return operations
}

describe('@slate/yjs wrapNodes collaboration contract', () => {
  it('characterizes public wrapNodes as insert_node then move_node', () => {
    assert.deepEqual(collectWrapOperations(), ['insert_node', 'move_node'])
  })

  it('applies local offline public wrap without replacing the original Yjs node', () => {
    const peer = createPeer('b')
    const original = getYjsNodeAt(peer, [0])

    runYjsUpdate(peer, (yjs) => yjs.disconnect())
    runYjsUpdate(peer, (yjs) => yjs.clearTrace())
    wrapFirstBlock(peer)

    assert.deepEqual(getParagraphTexts(peer), ['alpha'])
    assert.deepEqual(topLevelTypes(peer), ['quote'])
    assert.equal(getYjsNodeAt(peer, [1]), original)
    assert.deepEqual(getYjsState(peer).trace(), [
      { mode: 'operation', operationType: 'insert_node' },
      {
        fallback: 'virtual-move-ref',
        mode: 'traceable-fallback',
        operationType: 'move_node',
      },
    ])
    assertNoRootSnapshot(peer)
  })

  it('preserves concurrent remote text when an offline wrap reconnects', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    wrapFirstBlock(b)
    appendRemoteText(a)
    syncConnectedPeers(peers)

    assert.deepEqual(getParagraphTexts(a), ['alpha!'])
    assert.deepEqual(topLevelTypes(a), ['paragraph'])
    assert.deepEqual(getParagraphTexts(b), ['alpha'])
    assert.deepEqual(topLevelTypes(b), ['quote'])

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)

    assertPeerTexts(peers, ['alpha!'])
    assert.deepEqual(topLevelTypes(a), ['quote'])
    assert.deepEqual(topLevelTypes(b), ['quote'])
    assertNoRootSnapshot(b)
  })

  it('drops a preserved selection that no longer points to text after remote wrap import', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    a.editor.update((tx) => {
      tx.selection.set({
        anchor: { path: [0, 0], offset: 'alpha'.length },
        focus: { path: [0, 0], offset: 'alpha'.length },
      })
    })

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    wrapFirstBlock(b)
    appendRemoteText(a)
    syncConnectedPeers(peers)

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)

    assertPeerTexts(peers, ['alpha!'])
    assert.deepEqual(topLevelTypes(a), ['quote'])
    assert.equal(Editor.getSnapshot(a.editor).selection, null)
    assertNoRootSnapshot(b)
  })

  it('recovers wrap convergence through real Yjs updates after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    wrapFirstBlock(b)
    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)

    assertPeerTexts(peers, ['alpha'])
    assert.deepEqual(topLevelTypes(b), ['quote'])
  })

  it('undoes and redoes only the local wrap intent after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    wrapFirstBlock(b)
    appendRemoteText(a)
    syncConnectedPeers(peers)

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)
    assertPeerTexts(peers, ['alpha!'])
    assert.deepEqual(topLevelTypes(b), ['quote'])

    runYjsUpdate(b, (yjs) => yjs.undo())
    syncConnectedPeers(peers)
    assertPeerTexts(peers, ['alpha!'])
    assert.deepEqual(topLevelTypes(b), ['paragraph'])

    runYjsUpdate(b, (yjs) => yjs.redo())
    syncConnectedPeers(peers)
    assertPeerTexts(peers, ['alpha!'])
    assert.deepEqual(topLevelTypes(b), ['quote'])
    assertNoRootSnapshot(b)
  })
})
