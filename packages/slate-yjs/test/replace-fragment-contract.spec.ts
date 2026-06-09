import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Descendant, Operation } from 'slate'
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

const clientIds = {
  a: 1,
  b: 2,
  c: 3,
} as const
const numericClientIds: Record<string, number> = { ...clientIds }

const paragraph = (text: string): Descendant => ({
  type: 'paragraph',
  children: [{ text }],
})

const initialValue = () => [paragraph('alpha')]

const multiLeafValue = (): Descendant[] => [
  {
    type: 'paragraph',
    children: [{ text: 'alpha' }, { bold: true, text: ' beta' }],
  } as Descendant,
]

const createPeer = (
  clientId: keyof typeof clientIds,
  seedUpdate?: Uint8Array,
  children = initialValue()
): Peer =>
  createYjsPeer({
    children,
    clientId,
    numericClientId: clientIds[clientId],
    seedUpdate,
  })

const createPeers = (ids: Array<keyof typeof clientIds>) => {
  return createSeededYjsPeers({
    children: initialValue(),
    clientIds: ids,
    numericClientIds,
  })
}

const yjsState = getYjsState
const yjsUpdate = runYjsUpdate
const paragraphTexts = getParagraphTexts
const yjsNodeAt = getYjsNodeAt
const syncConnected = syncConnectedPeers
const assertAllTexts = assertPeerTexts

const replaceAlphaWithFragment = (peer: Peer) => {
  const operation: Operation = {
    children: [{ text: 'alpha' }],
    newChildren: [{ text: 'alphaLin fragment' }],
    newSelection: null,
    path: [0],
    selection: null,
    type: 'replace_fragment',
  }

  peer.editor.update((tx) => {
    tx.operations.replay([operation])
  })
}

const replaceMultiLeafTextWithFragment = (peer: Peer) => {
  const operation: Operation = {
    children: [{ text: 'alpha' }, { bold: true, text: ' beta' }],
    newChildren: [{ text: 'alphaLin' }, { bold: true, text: ' betaAda' }],
    newSelection: null,
    path: [0],
    selection: null,
    type: 'replace_fragment',
  }

  peer.editor.update((tx) => {
    tx.operations.replay([operation])
  })
}

const replaceRootWithFallback = (peer: Peer) => {
  const operation: Operation = {
    children: initialValue(),
    newChildren: [paragraph('bravo'), paragraph('charlie')],
    newSelection: null,
    path: [],
    selection: null,
    type: 'replace_fragment',
  }

  peer.editor.update((tx) => {
    tx.operations.replay([operation])
  })
}

const appendRemoteText = (peer: Peer) => {
  peer.editor.update((tx) => {
    tx.text.insert(' Ada', { at: { path: [0, 0], offset: 'alpha'.length } })
  })
}

const insertLocalBang = (peer: Peer) => {
  peer.editor.update((tx) => {
    tx.text.insert('!', { at: { path: [0, 0], offset: 'alpha'.length } })
  })
}

const replayNoopRootReplaceFragment = (peer: Peer) => {
  const operation: Operation = {
    children: initialValue(),
    newChildren: initialValue(),
    newSelection: {
      anchor: { path: [0, 0], offset: 'alpha'.length },
      focus: { path: [0, 0], offset: 'alpha'.length },
    },
    path: [],
    selection: null,
    type: 'replace_fragment',
  }

  peer.editor.update((tx) => {
    tx.operations.replay([operation])
  })
}

describe('@slate/yjs replace_fragment collaboration contract', () => {
  it('applies local offline single-text replace_fragment without replacing the Yjs text node', () => {
    const peer = createPeer('b')
    const text = yjsNodeAt(peer, [0, 0])

    yjsUpdate(peer, (yjs) => yjs.disconnect())
    yjsUpdate(peer, (yjs) => yjs.clearTrace())
    replaceAlphaWithFragment(peer)

    assert.deepEqual(paragraphTexts(peer), ['alphaLin fragment'])
    assert.equal(yjsNodeAt(peer, [0, 0]), text)
    assert.deepEqual(yjsState(peer).trace(), [
      { mode: 'operation', operationType: 'replace_fragment' },
    ])
    assertNoRootSnapshot(peer)
  })

  it('preserves every Yjs text node for same-width multi-leaf replace_fragment', () => {
    const peer = createPeer('b', undefined, multiLeafValue())

    const firstText = yjsNodeAt(peer, [0, 0])
    const secondText = yjsNodeAt(peer, [0, 1])

    yjsUpdate(peer, (yjs) => yjs.clearTrace())
    replaceMultiLeafTextWithFragment(peer)

    assert.deepEqual(paragraphTexts(peer), ['alphaLin betaAda'])
    assert.equal(yjsNodeAt(peer, [0, 0]), firstText)
    assert.equal(yjsNodeAt(peer, [0, 1]), secondText)
    assert.deepEqual(yjsState(peer).trace(), [
      { mode: 'operation', operationType: 'replace_fragment' },
    ])
    assertNoRootSnapshot(peer)
  })

  it('preserves concurrent remote text when an offline replace_fragment reconnects', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    yjsUpdate(b, (yjs) => yjs.disconnect())
    replaceAlphaWithFragment(b)
    appendRemoteText(a)
    syncConnected(peers)

    assert.deepEqual(paragraphTexts(a), ['alpha Ada'])
    assert.deepEqual(paragraphTexts(b), ['alphaLin fragment'])

    yjsUpdate(b, (yjs) => yjs.connect())
    syncConnected(peers)

    assertAllTexts(peers, ['alpha AdaLin fragment'])
    assertNoRootSnapshot(b)
  })

  it('recovers replace_fragment convergence through real Yjs updates after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [, b] = peers

    yjsUpdate(b, (yjs) => yjs.disconnect())
    replaceAlphaWithFragment(b)
    yjsUpdate(b, (yjs) => yjs.connect())
    syncConnected(peers)

    assertAllTexts(peers, ['alphaLin fragment'])
  })

  it('undoes and redoes only the local replace_fragment intent after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    yjsUpdate(b, (yjs) => yjs.disconnect())
    replaceAlphaWithFragment(b)
    appendRemoteText(a)
    syncConnected(peers)

    yjsUpdate(b, (yjs) => yjs.connect())
    syncConnected(peers)
    assertAllTexts(peers, ['alpha AdaLin fragment'])

    yjsUpdate(b, (yjs) => yjs.undo())
    syncConnected(peers)
    assertAllTexts(peers, ['alpha Ada'])

    yjsUpdate(b, (yjs) => yjs.redo())
    syncConnected(peers)
    assertAllTexts(peers, ['alpha AdaLin fragment'])
    assertNoRootSnapshot(b)
  })

  it('ignores no-op replace_fragment so redo history stays usable', () => {
    const peer = createPeer('b')

    insertLocalBang(peer)
    assert.deepEqual(paragraphTexts(peer), ['alpha!'])

    yjsUpdate(peer, (yjs) => yjs.undo())
    assert.deepEqual(paragraphTexts(peer), ['alpha'])

    yjsUpdate(peer, (yjs) => yjs.clearTrace())
    replayNoopRootReplaceFragment(peer)

    assert.deepEqual(paragraphTexts(peer), ['alpha'])
    assert.deepEqual(yjsState(peer).trace(), [])

    yjsUpdate(peer, (yjs) => yjs.redo())
    assert.deepEqual(paragraphTexts(peer), ['alpha!'])
    assertNoRootSnapshot(peer)
  })

  it('uses a traceable fallback for broad replace_fragment replacement', () => {
    const peer = createPeer('b')

    yjsUpdate(peer, (yjs) => yjs.clearTrace())
    replaceRootWithFallback(peer)

    assert.deepEqual(paragraphTexts(peer), ['bravo', 'charlie'])
    assert.deepEqual(yjsState(peer).trace(), [
      {
        fallback: 'replace-fragment-scoped-replace-identity-risk',
        mode: 'traceable-fallback',
        operationType: 'replace_fragment',
      },
    ])
    assertNoRootSnapshot(peer)
  })
})
