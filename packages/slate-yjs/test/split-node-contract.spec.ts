import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Descendant } from 'slate'
import { Editor } from 'slate/internal'
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

const initialValue = () => [paragraph('alphabeta')]

const helloValue = () => [paragraph('Hello world!')]

const createPeer = (
  clientId: string,
  seedUpdate?: Uint8Array,
  children = initialValue()
): Peer => createYjsPeer({ children, clientId, seedUpdate })

const createPeers = (clientIds: string[], children = initialValue()) => {
  return createSeededYjsPeers({ children, clientIds })
}

const yjsState = getYjsState
const yjsUpdate = runYjsUpdate
const paragraphTexts = getParagraphTexts
const yjsNodeAt = getYjsNodeAt
const syncConnected = syncConnectedPeers
const assertAllTexts = assertPeerTexts

const splitParagraph = (peer: Peer) => {
  peer.editor.update((tx) => {
    tx.nodes.split({ at: { path: [0, 0], offset: 'alph'.length } })
  })
}

const splitHelloParagraph = (peer: Peer) => {
  peer.editor.update((tx) => {
    tx.nodes.split({ at: { path: [0, 0], offset: 'Hello '.length } })
  })
}

const insertRemoteTextAtSplitPoint = (peer: Peer) => {
  peer.editor.update((tx) => {
    tx.text.insert('!', { at: { path: [0, 0], offset: 'alph'.length } })
  })
}

const appendRemoteText = (peer: Peer) => {
  peer.editor.update((tx) => {
    tx.text.insert('!', { at: { path: [0, 0], offset: 'alphabeta'.length } })
  })
}

const appendExclamationToFirstParagraph = (peer: Peer) => {
  const offset = Editor.string(peer.editor, [0]).length

  peer.editor.update((tx) => {
    tx.text.insert('!', { at: { path: [0, 0], offset } })
  })
}

const insertWorldParagraphAfterFirst = (peer: Peer) => {
  const offset = Editor.string(peer.editor, [0]).length

  peer.editor.update((tx) => {
    tx.selection.set({
      anchor: { path: [0, 0], offset },
      focus: { path: [0, 0], offset },
    })
  })
  peer.editor.update((tx) => {
    tx.break.insert()
  })
  peer.editor.update((tx) => {
    tx.text.insert('world! after')
  })
}

const insertTextSplitAndInsertRightText = (peer: Peer) => {
  peer.editor.update((tx) => {
    tx.selection.set({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })
  })
  peer.editor.update((tx) => {
    tx.text.insert('a')
  })
  peer.editor.update((tx) => {
    tx.break.insert()
  })
  peer.editor.update((tx) => {
    tx.text.insert('b')
  })
}

describe('@slate/yjs split_node collaboration contract', () => {
  it('applies local offline public split without a root snapshot fallback', () => {
    const peer = createPeer('b')
    const leftText = yjsNodeAt(peer, [0, 0])

    yjsUpdate(peer, (yjs) => yjs.disconnect())
    yjsUpdate(peer, (yjs) => yjs.clearTrace())
    splitParagraph(peer)

    assert.deepEqual(paragraphTexts(peer), ['alph', 'abeta'])
    assert.equal(yjsNodeAt(peer, [0, 0]), leftText)
    assert.deepEqual(yjsState(peer).trace(), [
      { mode: 'operation', operationType: 'split_node' },
      { mode: 'operation', operationType: 'split_node' },
    ])
    assertNoRootSnapshot(peer)
  })

  it('preserves concurrent remote insert intent when an offline public split reconnects', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    yjsUpdate(b, (yjs) => yjs.disconnect())
    splitParagraph(b)
    insertRemoteTextAtSplitPoint(a)
    syncConnected(peers)

    assert.deepEqual(paragraphTexts(a), ['alph!abeta'])
    assert.deepEqual(paragraphTexts(b), ['alph', 'abeta'])

    yjsUpdate(b, (yjs) => yjs.connect())
    syncConnected(peers)

    assertAllTexts(peers, ['alph!', 'abeta'])
    assertNoRootSnapshot(b)
  })

  it('recovers split convergence through real Yjs updates after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [, b] = peers

    yjsUpdate(b, (yjs) => yjs.disconnect())
    splitParagraph(b)
    yjsUpdate(b, (yjs) => yjs.connect())
    syncConnected(peers)

    assertAllTexts(peers, ['alph', 'abeta'])
  })

  it('preserves a remote split when an offline local split was undone before reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'], helloValue())
    const [a, b] = peers

    yjsUpdate(a, (yjs) => yjs.disconnect())
    splitHelloParagraph(a)
    yjsUpdate(a, (yjs) => yjs.undo())
    assert.deepEqual(paragraphTexts(a), ['Hello world!'])

    splitHelloParagraph(b)
    syncConnected(peers)
    assert.deepEqual(paragraphTexts(a), ['Hello world!'])
    assert.deepEqual(paragraphTexts(b), ['Hello ', 'world!'])

    yjsUpdate(a, (yjs) => yjs.connect())
    syncConnected(peers)

    assertAllTexts(peers, ['Hello ', 'world!'])
    assertNoRootSnapshot(a)
  })

  it('replays an offline split redo onto the remote split boundary after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'], helloValue())
    const [a, b] = peers

    yjsUpdate(a, (yjs) => yjs.disconnect())
    splitHelloParagraph(a)
    yjsUpdate(a, (yjs) => yjs.undo())
    assert.deepEqual(paragraphTexts(a), ['Hello world!'])

    appendExclamationToFirstParagraph(b)
    syncConnected(peers)
    splitHelloParagraph(b)
    syncConnected(peers)
    assert.deepEqual(paragraphTexts(a), ['Hello world!'])
    assert.deepEqual(paragraphTexts(b), ['Hello ', 'world!!'])

    yjsUpdate(a, (yjs) => yjs.connect())
    syncConnected(peers)
    yjsUpdate(a, (yjs) => yjs.redo())
    syncConnected(peers)

    assertAllTexts(peers, ['Hello ', 'world!!'])
    assertNoRootSnapshot(a)
  })

  it('does not absorb a later unrelated paragraph that matches the offline undo suffix', () => {
    const peers = createPeers(['a', 'b', 'c'], helloValue())
    const [a, b] = peers

    yjsUpdate(a, (yjs) => yjs.disconnect())
    splitHelloParagraph(a)
    yjsUpdate(a, (yjs) => yjs.undo())
    assert.deepEqual(paragraphTexts(a), ['Hello world!'])

    yjsUpdate(a, (yjs) => yjs.connect())
    syncConnected(peers)
    assertAllTexts(peers, ['Hello world!'])

    insertWorldParagraphAfterFirst(b)
    syncConnected(peers)
    assertAllTexts(peers, ['Hello world!', 'world! after'])

    yjsUpdate(a, (yjs) => yjs.redo())
    syncConnected(peers)

    assertAllTexts(peers, ['Hello ', 'world!', 'world! after'])
    assertNoRootSnapshot(a)
  })

  it('undoes and redoes only the local split intent after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    yjsUpdate(b, (yjs) => yjs.disconnect())
    splitParagraph(b)
    insertRemoteTextAtSplitPoint(a)
    syncConnected(peers)

    yjsUpdate(b, (yjs) => yjs.connect())
    syncConnected(peers)
    assertAllTexts(peers, ['alph!', 'abeta'])

    yjsUpdate(b, (yjs) => yjs.undo())
    syncConnected(peers)
    assertAllTexts(peers, ['alph!abeta'])

    yjsUpdate(b, (yjs) => yjs.redo())
    syncConnected(peers)
    assertAllTexts(peers, ['alph!', 'abeta'])
    assertNoRootSnapshot(b)
  })

  it('redoes text inserted into a split-created paragraph after undoing to an empty document', () => {
    const peer = createPeer('b', undefined, [paragraph('')])

    insertTextSplitAndInsertRightText(peer)
    assert.deepEqual(paragraphTexts(peer), ['a', 'b'])

    yjsUpdate(peer, (yjs) => yjs.undo())
    yjsUpdate(peer, (yjs) => yjs.undo())
    assert.deepEqual(paragraphTexts(peer), ['a'])

    yjsUpdate(peer, (yjs) => yjs.undo())
    assert.deepEqual(paragraphTexts(peer), [''])

    yjsUpdate(peer, (yjs) => yjs.redo())
    assert.deepEqual(paragraphTexts(peer), ['a'])

    yjsUpdate(peer, (yjs) => yjs.redo())
    yjsUpdate(peer, (yjs) => yjs.redo())
    assert.deepEqual(paragraphTexts(peer), ['a', 'b'])
    assertNoRootSnapshot(peer)
  })

  it('undoes a split after a prior merge without custom split-history replay', () => {
    const peer = createPeer('b', undefined, [
      paragraph('Hello world!'),
      paragraph('block 2'),
    ])

    peer.editor.update((tx) => {
      tx.nodes.merge({ at: [1] })
    })
    assert.deepEqual(paragraphTexts(peer), ['Hello world!block 2'])

    peer.editor.update((tx) => {
      tx.operations.replay([
        {
          path: [0, 0],
          position: 'Hello wor'.length,
          properties: {},
          type: 'split_node',
        },
        {
          path: [0],
          position: 1,
          properties: { type: 'paragraph' },
          type: 'split_node',
        },
      ])
    })
    assert.deepEqual(paragraphTexts(peer), ['Hello wor', 'ld!block 2'])

    yjsUpdate(peer, (yjs) => yjs.undo())
    assert.deepEqual(paragraphTexts(peer), ['Hello world!block 2'])
    assertNoRootSnapshot(peer)
  })

  it('undoes a break split after a prior merge without leaving the right split node visible', () => {
    const peer = createPeer('b', undefined, [
      paragraph('Hello world!'),
      paragraph('block 2'),
    ])

    peer.editor.update((tx) => {
      tx.nodes.merge({ at: [1] })
    })
    assert.deepEqual(paragraphTexts(peer), ['Hello world!block 2'])

    peer.editor.update((tx) => {
      tx.selection.set({
        anchor: { path: [0, 0], offset: 'Hello wor'.length },
        focus: { path: [0, 0], offset: 'Hello wor'.length },
      })
      tx.break.insert()
    })
    assert.deepEqual(paragraphTexts(peer), ['Hello wor', 'ld!block 2'])

    yjsUpdate(peer, (yjs) => yjs.undo())
    assert.deepEqual(paragraphTexts(peer), ['Hello world!block 2'])
    assertNoRootSnapshot(peer)
  })

  it('undoes an offline public split after a concurrent remote append', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    yjsUpdate(b, (yjs) => yjs.disconnect())
    splitParagraph(b)
    appendRemoteText(a)
    syncConnected(peers)

    yjsUpdate(b, (yjs) => yjs.connect())
    syncConnected(peers)
    assertAllTexts(peers, ['alph!', 'abeta'])

    yjsUpdate(b, (yjs) => yjs.undo())
    syncConnected(peers)
    assertAllTexts(peers, ['alph!abeta'])

    yjsUpdate(b, (yjs) => yjs.redo())
    syncConnected(peers)
    assertAllTexts(peers, ['alph!', 'abeta'])
    assertNoRootSnapshot(b)
  })
})
