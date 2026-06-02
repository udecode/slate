import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { type Descendant, type Operation } from 'slate'

import {
  assertNoRootSnapshot,
  assertPeerTexts,
  createSeededYjsPeers,
  createYjsPeer,
  getParagraphTexts,
  getVisibleYjsNodeAt,
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

const initialValue = () => [
  paragraph('alpha'),
  paragraph('beta'),
  paragraph('gamma'),
]

const createPeer = (clientId: keyof typeof clientIds) =>
  createYjsPeer({
    children: initialValue(),
    clientId,
    numericClientId: clientIds[clientId],
  })

const createPeers = (ids: Array<keyof typeof clientIds>) =>
  createSeededYjsPeers({
    children: initialValue(),
    clientIds: ids,
    numericClientIds: clientIds,
  })

const appendRemoteAlpha = (peer: ReturnType<typeof createPeer>) => {
  peer.editor.update((tx) => {
    tx.text.insert('!', { at: { path: [0, 0], offset: 'alpha'.length } })
  })
}

const insertBetaBang = (peer: ReturnType<typeof createPeer>) => {
  peer.editor.update((tx) => {
    tx.text.insert('!', { at: { path: [1, 0], offset: 'beta'.length } })
  })
}

const removeBetaMiddle = (peer: ReturnType<typeof createPeer>) => {
  peer.editor.update((tx) => {
    tx.text.delete({ at: { path: [1, 0], offset: 1 }, distance: 2 })
  })
}

const insertMiddleBlock = (peer: ReturnType<typeof createPeer>) => {
  peer.editor.update((tx) => {
    tx.nodes.insert([paragraph('bravo')], { at: [1] })
  })
}

const replaceMiddleBlock = (peer: ReturnType<typeof createPeer>) => {
  const operation: Operation = {
    children: [paragraph('beta')],
    index: 1,
    newChildren: [paragraph('bravo')],
    newSelection: null,
    path: [],
    selection: null,
    type: 'replace_children',
  }

  peer.editor.update((tx) => {
    tx.operations.replay([operation])
  })
}

const replaceFirstBlock = (peer: ReturnType<typeof createPeer>) => {
  const operation: Operation = {
    children: [paragraph('alpha')],
    index: 0,
    newChildren: [paragraph('bravo')],
    newSelection: null,
    path: [],
    selection: null,
    type: 'replace_children',
  }

  peer.editor.update((tx) => {
    tx.operations.replay([operation])
  })
}

describe('@slate/yjs simple operation collaboration contract', () => {
  it('applies local offline insert_text in place without a root snapshot fallback', () => {
    const peer = createPeer('b')
    const text = getVisibleYjsNodeAt(peer, [1, 0])

    runYjsUpdate(peer, (yjs) => yjs.disconnect())
    runYjsUpdate(peer, (yjs) => yjs.clearTrace())
    insertBetaBang(peer)

    assert.deepEqual(getParagraphTexts(peer), ['alpha', 'beta!', 'gamma'])
    assert.equal(getVisibleYjsNodeAt(peer, [1, 0]), text)
    assert.deepEqual(getYjsState(peer).trace(), [
      { mode: 'operation', operationType: 'insert_text' },
    ])
    assertNoRootSnapshot(peer)
  })

  it('reconnects, undoes, and redoes insert_text while preserving remote edits', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    insertBetaBang(b)
    appendRemoteAlpha(a)
    syncConnectedPeers(peers)

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)
    assertPeerTexts(peers, ['alpha!', 'beta!', 'gamma'])

    runYjsUpdate(b, (yjs) => yjs.undo())
    syncConnectedPeers(peers)
    assertPeerTexts(peers, ['alpha!', 'beta', 'gamma'])

    runYjsUpdate(b, (yjs) => yjs.redo())
    syncConnectedPeers(peers)
    assertPeerTexts(peers, ['alpha!', 'beta!', 'gamma'])
    assertNoRootSnapshot(b)
  })

  it('applies local offline remove_text in place without a root snapshot fallback', () => {
    const peer = createPeer('b')
    const text = getVisibleYjsNodeAt(peer, [1, 0])

    runYjsUpdate(peer, (yjs) => yjs.disconnect())
    runYjsUpdate(peer, (yjs) => yjs.clearTrace())
    removeBetaMiddle(peer)

    assert.deepEqual(getParagraphTexts(peer), ['alpha', 'ba', 'gamma'])
    assert.equal(getVisibleYjsNodeAt(peer, [1, 0]), text)
    assert.deepEqual(getYjsState(peer).trace(), [
      { mode: 'operation', operationType: 'remove_text' },
    ])
    assertNoRootSnapshot(peer)
  })

  it('reconnects, undoes, and redoes remove_text while preserving remote edits', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    removeBetaMiddle(b)
    appendRemoteAlpha(a)
    syncConnectedPeers(peers)

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)
    assertPeerTexts(peers, ['alpha!', 'ba', 'gamma'])

    runYjsUpdate(b, (yjs) => yjs.undo())
    syncConnectedPeers(peers)
    assertPeerTexts(peers, ['alpha!', 'beta', 'gamma'])

    runYjsUpdate(b, (yjs) => yjs.redo())
    syncConnectedPeers(peers)
    assertPeerTexts(peers, ['alpha!', 'ba', 'gamma'])
    assertNoRootSnapshot(b)
  })

  it('applies local offline insert_node without replacing existing Yjs siblings', () => {
    const peer = createPeer('b')
    const alpha = getVisibleYjsNodeAt(peer, [0])
    const beta = getVisibleYjsNodeAt(peer, [1])

    runYjsUpdate(peer, (yjs) => yjs.disconnect())
    runYjsUpdate(peer, (yjs) => yjs.clearTrace())
    insertMiddleBlock(peer)

    assert.deepEqual(getParagraphTexts(peer), [
      'alpha',
      'bravo',
      'beta',
      'gamma',
    ])
    assert.equal(getVisibleYjsNodeAt(peer, [0]), alpha)
    assert.equal(getVisibleYjsNodeAt(peer, [2]), beta)
    assert.deepEqual(getYjsState(peer).trace(), [
      { mode: 'operation', operationType: 'insert_node' },
    ])
    assertNoRootSnapshot(peer)
  })

  it('reconnects, undoes, and redoes insert_node while preserving remote edits', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    insertMiddleBlock(b)
    appendRemoteAlpha(a)
    syncConnectedPeers(peers)

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)
    assertPeerTexts(peers, ['alpha!', 'bravo', 'beta', 'gamma'])

    runYjsUpdate(b, (yjs) => yjs.undo())
    syncConnectedPeers(peers)
    assertPeerTexts(peers, ['alpha!', 'beta', 'gamma'])

    runYjsUpdate(b, (yjs) => yjs.redo())
    syncConnectedPeers(peers)
    assertPeerTexts(peers, ['alpha!', 'bravo', 'beta', 'gamma'])
    assertNoRootSnapshot(b)
  })

  it('applies local offline replace_children while preserving unaffected Yjs siblings', () => {
    const peer = createPeer('b')
    const alpha = getVisibleYjsNodeAt(peer, [0])
    const gamma = getVisibleYjsNodeAt(peer, [2])

    runYjsUpdate(peer, (yjs) => yjs.disconnect())
    runYjsUpdate(peer, (yjs) => yjs.clearTrace())
    replaceMiddleBlock(peer)

    assert.deepEqual(getParagraphTexts(peer), ['alpha', 'bravo', 'gamma'])
    assert.equal(getVisibleYjsNodeAt(peer, [0]), alpha)
    assert.equal(getVisibleYjsNodeAt(peer, [2]), gamma)
    assert.deepEqual(getYjsState(peer).trace(), [
      { mode: 'operation', operationType: 'replace_children' },
    ])
    assertNoRootSnapshot(peer)
  })

  it('reconnects, undoes, and redoes replace_children while preserving remote edits', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    replaceMiddleBlock(b)
    appendRemoteAlpha(a)
    syncConnectedPeers(peers)

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)
    assertPeerTexts(peers, ['alpha!', 'bravo', 'gamma'])

    runYjsUpdate(b, (yjs) => yjs.undo())
    syncConnectedPeers(peers)
    assertPeerTexts(peers, ['alpha!', 'beta', 'gamma'])

    runYjsUpdate(b, (yjs) => yjs.redo())
    syncConnectedPeers(peers)
    assertPeerTexts(peers, ['alpha!', 'bravo', 'gamma'])
    assertNoRootSnapshot(b)
  })

  it('preserves remote text when an offline replace_children is undone before reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    replaceFirstBlock(b)
    assert.deepEqual(getParagraphTexts(b), ['bravo', 'beta', 'gamma'])

    runYjsUpdate(b, (yjs) => yjs.undo())
    assert.deepEqual(getParagraphTexts(b), ['alpha', 'beta', 'gamma'])

    appendRemoteAlpha(a)
    syncConnectedPeers(peers)
    assert.deepEqual(getParagraphTexts(a), ['alpha!', 'beta', 'gamma'])
    assert.deepEqual(getParagraphTexts(b), ['alpha', 'beta', 'gamma'])

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)

    assertPeerTexts(peers, ['alpha!', 'beta', 'gamma'])
    assertNoRootSnapshot(b)
  })
})
