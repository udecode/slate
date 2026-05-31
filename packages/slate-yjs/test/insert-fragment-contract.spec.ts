import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { type Descendant, defineEditorExtension } from 'slate'

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

const insertFragment = (peer: ReturnType<typeof createPeer>) => {
  peer.editor.update((tx) => {
    tx.selection.set({
      anchor: { path: [0, 0], offset: 'alpha'.length },
      focus: { path: [0, 0], offset: 'alpha'.length },
    })
  })
  peer.editor.update((tx) => {
    tx.fragment.insert([{ text: 'Lin fragment' }])
  })
}

const appendRemoteText = (peer: ReturnType<typeof createPeer>) => {
  peer.editor.update((tx) => {
    tx.text.insert(' Ada', { at: { path: [0, 0], offset: 'alpha'.length } })
  })
}

const collectInsertFragmentOperations = () => {
  const peer = createPeer('b')
  const operations: string[] = []

  peer.editor.extend(
    defineEditorExtension({
      name: 'insert-fragment-operation-recorder',
      setup() {
        return {
          onCommit({ commit }) {
            if (
              commit.command?.type === 'insert_fragment' ||
              commit.operations.some((operation) =>
                ['insert_node', 'merge_node'].includes(operation.type)
              )
            ) {
              operations.push(
                ...commit.operations.map((operation) => operation.type)
              )
            }
          },
        }
      },
    })
  )
  insertFragment(peer)

  return operations
}

describe('@slate/yjs insert_fragment collaboration contract', () => {
  it('characterizes public insert_fragment as insert_node then text merge fallback', () => {
    assert.deepEqual(collectInsertFragmentOperations(), [
      'insert_node',
      'set_selection',
      'merge_node',
    ])
  })

  it('applies local offline public insert_fragment without replacing the original Yjs text node', () => {
    const peer = createPeer('b')
    const text = getYjsNodeAt(peer, [0, 0])

    runYjsUpdate(peer, (yjs) => yjs.disconnect())
    runYjsUpdate(peer, (yjs) => yjs.clearTrace())
    insertFragment(peer)

    assert.deepEqual(getParagraphTexts(peer), ['alphaLin fragment'])
    assert.equal(getYjsNodeAt(peer, [0, 0]), text)
    assert.deepEqual(getYjsState(peer).trace(), [
      { mode: 'operation', operationType: 'insert_node' },
      {
        fallback: 'text-merge-preserve-yjs-boundary',
        mode: 'traceable-fallback',
        operationType: 'merge_node',
      },
    ])
    assertNoRootSnapshot(peer)
  })

  it('preserves concurrent remote text when an offline insert_fragment reconnects', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    insertFragment(b)
    appendRemoteText(a)
    syncConnectedPeers(peers)

    assert.deepEqual(getParagraphTexts(a), ['alpha Ada'])
    assert.deepEqual(getParagraphTexts(b), ['alphaLin fragment'])

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)

    assertPeerTexts(peers, ['alpha AdaLin fragment'])
    assertNoRootSnapshot(b)
  })

  it('recovers insert_fragment convergence through real Yjs updates after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    insertFragment(b)
    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)

    assertPeerTexts(peers, ['alphaLin fragment'])
  })

  it('undoes and redoes only the local insert_fragment intent after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    insertFragment(b)
    appendRemoteText(a)
    syncConnectedPeers(peers)

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)
    assertPeerTexts(peers, ['alpha AdaLin fragment'])

    runYjsUpdate(b, (yjs) => yjs.undo())
    syncConnectedPeers(peers)
    assertPeerTexts(peers, ['alpha Ada'])

    runYjsUpdate(b, (yjs) => yjs.redo())
    syncConnectedPeers(peers)
    assertPeerTexts(peers, ['alpha AdaLin fragment'])
    assertNoRootSnapshot(b)
  })
})
