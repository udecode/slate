import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Descendant } from 'slate'
import { Editor } from 'slate/internal'

import { readSlateValueFromYjs } from '../src/core/document'
import {
  assertNoRootSnapshot,
  assertPeerTexts,
  createSeededYjsPeers,
  createYjsPeer,
  getParagraphTexts,
  getYjsNodeAt,
  getYjsState,
  type Peer,
  runYjsUpdate,
  syncConnectedPeers,
} from './support/collaboration'

const paragraph = (text: string): Descendant => ({
  type: 'paragraph',
  children: [{ text }],
})

const quote = (...children: Descendant[]): Descendant => ({
  type: 'block-quote',
  children,
})

const initialValue = () => [paragraph('alpha'), paragraph('beta')]

const incompatibleMergeValue = (): Descendant[] => [
  paragraph('block 2'),
  quote(paragraph('alpha'), paragraph('beta')),
]

const textMergeValue = (): Descendant[] => [
  {
    type: 'paragraph',
    children: [{ text: 'alpha' }, { text: 'beta' }],
  },
]

const createPeer = (
  clientId: string,
  seedUpdate?: Uint8Array,
  children: Descendant[] = initialValue()
): Peer => createYjsPeer({ children, clientId, seedUpdate })

const createPeers = (
  clientIds: string[],
  children: Descendant[] = initialValue()
) => {
  return createSeededYjsPeers({ children, clientIds })
}

const yjsState = getYjsState
const yjsUpdate = runYjsUpdate
const paragraphTexts = getParagraphTexts
const yjsNodeAt = getYjsNodeAt
const syncConnected = syncConnectedPeers
const assertAllTexts = assertPeerTexts

const mergeSecondParagraph = (peer: Peer) => {
  peer.editor.update((tx) => {
    tx.nodes.merge({ at: [1] })
  })
}

const mergeRightText = (peer: Peer) => {
  peer.editor.update((tx) => {
    tx.operations.replay([
      {
        path: [0, 1],
        position: 'alpha'.length,
        properties: {},
        type: 'merge_node',
      },
    ])
  })
}

const appendRemoteTextToLeftParagraph = (peer: Peer) => {
  peer.editor.update((tx) => {
    tx.text.insert('!', { at: { path: [0, 0], offset: 'alpha'.length } })
  })
}

describe('@slate/yjs merge_node collaboration contract', () => {
  it('elides incompatible structural merge instead of nesting blocks into a paragraph', () => {
    const peer = createPeer('b', undefined, incompatibleMergeValue())

    yjsUpdate(peer, (yjs) => yjs.clearTrace())
    mergeSecondParagraph(peer)

    assert.deepEqual(readSlateValueFromYjs(yjsState(peer).root()), [
      paragraph('block 2'),
      quote(paragraph('alpha'), paragraph('beta')),
    ])
    assert.deepEqual(yjsState(peer).trace(), [
      {
        fallback: 'incompatible-structural-merge-elided',
        mode: 'traceable-fallback',
        operationType: 'merge_node',
      },
    ])

    yjsUpdate(peer, (yjs) => yjs.reconcile())

    assert.deepEqual(
      Editor.getSnapshot(peer.editor).children,
      incompatibleMergeValue()
    )
    assertNoRootSnapshot(peer)
  })

  it('applies local offline public merge without a root snapshot fallback', () => {
    const peer = createPeer('b')
    const survivor = yjsNodeAt(peer, [0])

    yjsUpdate(peer, (yjs) => yjs.disconnect())
    yjsUpdate(peer, (yjs) => yjs.clearTrace())
    mergeSecondParagraph(peer)

    assert.deepEqual(paragraphTexts(peer), ['alphabeta'])
    assert.equal(yjsNodeAt(peer, [0]), survivor)
    assert.deepEqual(yjsState(peer).trace(), [
      {
        fallback: 'virtual-merge-ref',
        mode: 'traceable-fallback',
        operationType: 'merge_node',
      },
    ])
    assertNoRootSnapshot(peer)
  })

  it('preserves concurrent remote survivor edits when an offline merge reconnects', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    yjsUpdate(b, (yjs) => yjs.disconnect())
    mergeSecondParagraph(b)
    appendRemoteTextToLeftParagraph(a)
    syncConnected(peers)

    assert.deepEqual(paragraphTexts(a), ['alpha!', 'beta'])
    assert.deepEqual(paragraphTexts(b), ['alphabeta'])

    yjsUpdate(b, (yjs) => yjs.connect())
    syncConnected(peers)

    assertAllTexts(peers, ['alpha!beta'])
    assertNoRootSnapshot(b)
  })

  it('recovers merge convergence through real Yjs updates after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [, b] = peers

    yjsUpdate(b, (yjs) => yjs.disconnect())
    mergeSecondParagraph(b)
    yjsUpdate(b, (yjs) => yjs.connect())
    syncConnected(peers)

    assertAllTexts(peers, ['alphabeta'])
  })

  it('undoes and redoes only the local merge intent after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    yjsUpdate(b, (yjs) => yjs.disconnect())
    mergeSecondParagraph(b)
    appendRemoteTextToLeftParagraph(a)
    syncConnected(peers)

    yjsUpdate(b, (yjs) => yjs.connect())
    syncConnected(peers)
    assertAllTexts(peers, ['alpha!beta'])

    yjsUpdate(b, (yjs) => yjs.undo())
    syncConnected(peers)
    assertAllTexts(peers, ['alpha!', 'beta'])

    yjsUpdate(b, (yjs) => yjs.redo())
    syncConnected(peers)
    assertAllTexts(peers, ['alpha!beta'])
    assertNoRootSnapshot(b)
  })

  it('keeps raw text merge_node in a traceable identity-preserving fallback', () => {
    const peers = createPeers(['a', 'b', 'c'], textMergeValue())
    const [a, b] = peers
    const survivor = yjsNodeAt(b, [0, 0])
    const rightText = yjsNodeAt(b, [0, 1])

    yjsUpdate(b, (yjs) => yjs.disconnect())
    yjsUpdate(b, (yjs) => yjs.clearTrace())
    mergeRightText(b)
    appendRemoteTextToLeftParagraph(a)
    syncConnected(peers)

    assert.deepEqual(paragraphTexts(a), ['alpha!beta'])
    assert.deepEqual(paragraphTexts(b), ['alphabeta'])
    assert.equal(yjsNodeAt(b, [0, 0]), survivor)
    assert.equal(yjsNodeAt(b, [0, 1]), rightText)
    assert.deepEqual(yjsState(b).trace(), [
      {
        fallback: 'text-merge-preserve-yjs-boundary',
        mode: 'traceable-fallback',
        operationType: 'merge_node',
      },
    ])

    yjsUpdate(b, (yjs) => yjs.connect())
    syncConnected(peers)
    assertAllTexts(peers, ['alpha!beta'])

    yjsUpdate(b, (yjs) => yjs.undo())
    syncConnected(peers)
    assertAllTexts(peers, ['alpha!beta'])

    yjsUpdate(b, (yjs) => yjs.redo())
    syncConnected(peers)
    assertAllTexts(peers, ['alpha!beta'])
    assertNoRootSnapshot(b)
  })
})
