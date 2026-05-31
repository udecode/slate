import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  type Descendant,
  defineEditorExtension,
  type Element,
  NodeApi,
} from 'slate'
import { Editor } from 'slate/internal'

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

const paragraph = (
  text: string,
  attributes: Record<string, unknown> = {}
): Descendant => ({
  ...attributes,
  type: 'paragraph',
  children: [{ text }],
})

const initialValue = () => [paragraph('alpha')]
const roleValue = () => [paragraph('alpha', { role: 'title' })]

const createPeer = (
  clientId: keyof typeof clientIds,
  children: Descendant[] = initialValue()
) =>
  createYjsPeer({
    children,
    clientId,
    numericClientId: clientIds[clientId],
  })

const createPeers = (
  ids: Array<keyof typeof clientIds>,
  children: Descendant[] = initialValue()
) =>
  createSeededYjsPeers({
    children,
    clientIds: ids,
    numericClientIds: clientIds,
  })

const setHeading = (peer: ReturnType<typeof createPeer>) => {
  peer.editor.update((tx) => {
    tx.nodes.set<Element>({ role: 'title', type: 'heading-one' }, { at: [0] })
  })
}

const unsetRole = (peer: ReturnType<typeof createPeer>) => {
  peer.editor.update((tx) => {
    tx.nodes.unset('role' as never, { at: [0] })
  })
}

const setTextMark = (peer: ReturnType<typeof createPeer>) => {
  peer.editor.update((tx) => {
    tx.nodes.set({ bold: true } as never, { at: [0, 0], match: NodeApi.isText })
  })
}

const appendRemoteText = (peer: ReturnType<typeof createPeer>) => {
  peer.editor.update((tx) => {
    tx.text.insert('!', { at: { path: [0, 0], offset: 'alpha'.length } })
  })
}

describe('@slate/yjs set_node collaboration contract', () => {
  it('characterizes public setNodes as set_node', () => {
    const peer = createPeer('b')
    const operations: string[] = []

    peer.editor.extend(
      defineEditorExtension({
        name: 'set-node-operation-recorder',
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
    setHeading(peer)

    assert.deepEqual(operations, ['set_node'])
  })

  it('applies local offline element set_node without replacing the Yjs element', () => {
    const peer = createPeer('b')
    const element = getVisibleYjsNodeAt(peer, [0])

    runYjsUpdate(peer, (yjs) => yjs.disconnect())
    runYjsUpdate(peer, (yjs) => yjs.clearTrace())
    setHeading(peer)

    assert.deepEqual(Editor.getSnapshot(peer.editor).children, [
      { type: 'heading-one', role: 'title', children: [{ text: 'alpha' }] },
    ])
    assert.equal(getVisibleYjsNodeAt(peer, [0]), element)
    assert.deepEqual(getYjsState(peer).trace(), [
      { mode: 'operation', operationType: 'set_node' },
    ])
    assertNoRootSnapshot(peer)
  })

  it('preserves concurrent remote text when an offline element set_node reconnects', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    setHeading(b)
    appendRemoteText(a)
    syncConnectedPeers(peers)

    assert.deepEqual(getParagraphTexts(a), ['alpha!'])
    assert.deepEqual(Editor.getSnapshot(b.editor).children, [
      { type: 'heading-one', role: 'title', children: [{ text: 'alpha' }] },
    ])

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)

    for (const peer of peers) {
      assert.deepEqual(Editor.getSnapshot(peer.editor).children, [
        {
          type: 'heading-one',
          role: 'title',
          children: [{ text: 'alpha!' }],
        },
      ])
    }
    assertNoRootSnapshot(b)
  })

  it('recovers element set_node convergence through real Yjs updates after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    setHeading(b)
    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)

    for (const peer of peers) {
      assert.deepEqual(Editor.getSnapshot(peer.editor).children, [
        { type: 'heading-one', role: 'title', children: [{ text: 'alpha' }] },
      ])
    }
  })

  it('undoes and redoes only the local element set_node intent after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    setHeading(b)
    appendRemoteText(a)
    syncConnectedPeers(peers)

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)
    for (const peer of peers) {
      assert.deepEqual(Editor.getSnapshot(peer.editor).children, [
        {
          type: 'heading-one',
          role: 'title',
          children: [{ text: 'alpha!' }],
        },
      ])
    }

    runYjsUpdate(b, (yjs) => yjs.undo())
    syncConnectedPeers(peers)
    for (const peer of peers) {
      assert.deepEqual(Editor.getSnapshot(peer.editor).children, [
        { type: 'paragraph', children: [{ text: 'alpha!' }] },
      ])
    }

    runYjsUpdate(b, (yjs) => yjs.redo())
    syncConnectedPeers(peers)
    for (const peer of peers) {
      assert.deepEqual(Editor.getSnapshot(peer.editor).children, [
        {
          type: 'heading-one',
          role: 'title',
          children: [{ text: 'alpha!' }],
        },
      ])
    }
    assertNoRootSnapshot(b)
  })

  it('characterizes public unsetNodes as set_node', () => {
    const peer = createPeer('b', roleValue())
    const operations: string[] = []

    peer.editor.extend(
      defineEditorExtension({
        name: 'unset-node-operation-recorder',
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
    unsetRole(peer)

    assert.deepEqual(operations, ['set_node'])
    assert.deepEqual(Editor.getSnapshot(peer.editor).children, [
      { type: 'paragraph', children: [{ text: 'alpha' }] },
    ])
  })

  it('applies local offline text mark set_node without replacing the Yjs text node', () => {
    const peer = createPeer('b')
    const text = getVisibleYjsNodeAt(peer, [0, 0])

    runYjsUpdate(peer, (yjs) => yjs.disconnect())
    runYjsUpdate(peer, (yjs) => yjs.clearTrace())
    setTextMark(peer)

    assert.deepEqual(Editor.getSnapshot(peer.editor).children, [
      { type: 'paragraph', children: [{ bold: true, text: 'alpha' }] },
    ])
    assert.equal(getVisibleYjsNodeAt(peer, [0, 0]), text)
    assert.deepEqual(getYjsState(peer).trace(), [
      { mode: 'operation', operationType: 'set_node' },
    ])
    assertNoRootSnapshot(peer)
  })

  it('syncs text mark set_node through reconnect and undo without root snapshots', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    setTextMark(b)
    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)

    for (const peer of peers) {
      assert.deepEqual(Editor.getSnapshot(peer.editor).children, [
        { type: 'paragraph', children: [{ bold: true, text: 'alpha' }] },
      ])
    }

    runYjsUpdate(b, (yjs) => yjs.undo())
    syncConnectedPeers(peers)
    assertPeerTexts(peers, ['alpha'])
    for (const peer of peers) {
      assert.deepEqual(Editor.getSnapshot(peer.editor).children, [
        { type: 'paragraph', children: [{ text: 'alpha' }] },
      ])
    }
    assertNoRootSnapshot(b)
  })
})
