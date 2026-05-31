import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { type Descendant, defineEditorExtension } from 'slate'
import { Editor } from 'slate/internal'

import {
  assertNoRootSnapshot,
  createSeededYjsPeers,
  createYjsPeer,
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

const section = (...children: Descendant[]): Descendant => ({
  type: 'section',
  children,
})

const initialValue = () => [
  paragraph('alpha'),
  paragraph('beta'),
  paragraph('gamma'),
]

const nestedInitialValue = () => [
  section(paragraph('alpha'), paragraph('beta')),
  section(paragraph('gamma')),
]

const createPeer = (
  clientId: keyof typeof clientIds,
  seedUpdate?: Uint8Array,
  children: Descendant[] = initialValue()
) =>
  createYjsPeer({
    children,
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

const createNestedPeers = (ids: Array<keyof typeof clientIds>) =>
  createSeededYjsPeers({
    children: nestedInitialValue(),
    clientIds: ids,
    numericClientIds: clientIds,
  })

const topLevelTexts = (peer: ReturnType<typeof createPeer>) =>
  Editor.getSnapshot(peer.editor).children.map((_, index) =>
    Editor.string(peer.editor, [index])
  )

const nestedTexts = (peer: ReturnType<typeof createPeer>) =>
  Editor.getSnapshot(peer.editor).children.map((node, index) =>
    'children' in node
      ? node.children.map((_, childIndex) =>
          Editor.string(peer.editor, [index, childIndex])
        )
      : []
  )

const moveFirstBlockToEnd = (peer: ReturnType<typeof createPeer>) => {
  peer.editor.update((tx) => {
    tx.nodes.move({ at: [0], to: [2] })
  })
}

const moveNestedBlockToSecondSection = (
  peer: ReturnType<typeof createPeer>
) => {
  peer.editor.update((tx) => {
    tx.nodes.move({ at: [0, 0], to: [1, 1] })
  })
}

const appendRemoteAlpha = (peer: ReturnType<typeof createPeer>) => {
  peer.editor.update((tx) => {
    tx.text.insert('!', { at: { path: [0, 0], offset: 'alpha'.length } })
  })
}

const appendNestedRemoteAlpha = (peer: ReturnType<typeof createPeer>) => {
  peer.editor.update((tx) => {
    tx.text.insert('!', { at: { path: [0, 0, 0], offset: 'alpha'.length } })
  })
}

const collectMoveOperations = () => {
  const peer = createPeer('b')
  const operations: string[] = []

  peer.editor.extend(
    defineEditorExtension({
      name: 'move-operation-recorder',
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
  moveFirstBlockToEnd(peer)

  return operations
}

describe('@slate/yjs move_node collaboration contract', () => {
  it('characterizes public moveNodes as move_node', () => {
    assert.deepEqual(collectMoveOperations(), ['move_node'])
  })

  it('applies local offline same-parent move without replacing the original Yjs node', () => {
    const peer = createPeer('b')
    const original = getVisibleYjsNodeAt(peer, [0])

    runYjsUpdate(peer, (yjs) => yjs.disconnect())
    runYjsUpdate(peer, (yjs) => yjs.clearTrace())
    moveFirstBlockToEnd(peer)

    assert.deepEqual(topLevelTexts(peer), ['beta', 'gamma', 'alpha'])
    assert.equal(getVisibleYjsNodeAt(peer, [2]), original)
    assert.deepEqual(getYjsState(peer).trace(), [
      {
        fallback: 'virtual-move-placeholder',
        mode: 'traceable-fallback',
        operationType: 'move_node',
      },
    ])
    assertNoRootSnapshot(peer)
  })

  it('preserves concurrent remote text when an offline same-parent move reconnects', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    moveFirstBlockToEnd(b)
    appendRemoteAlpha(a)
    syncConnectedPeers(peers)

    assert.deepEqual(topLevelTexts(a), ['alpha!', 'beta', 'gamma'])
    assert.deepEqual(topLevelTexts(b), ['beta', 'gamma', 'alpha'])

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)

    for (const peer of peers) {
      assert.deepEqual(topLevelTexts(peer), ['beta', 'gamma', 'alpha!'])
    }
    assertNoRootSnapshot(b)
  })

  it('undoes and redoes only the local same-parent move intent after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    moveFirstBlockToEnd(b)
    appendRemoteAlpha(a)
    syncConnectedPeers(peers)

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)
    for (const peer of peers) {
      assert.deepEqual(topLevelTexts(peer), ['beta', 'gamma', 'alpha!'])
    }

    runYjsUpdate(b, (yjs) => yjs.undo())
    syncConnectedPeers(peers)
    for (const peer of peers) {
      assert.deepEqual(topLevelTexts(peer), ['alpha!', 'beta', 'gamma'])
    }

    runYjsUpdate(b, (yjs) => yjs.redo())
    syncConnectedPeers(peers)
    for (const peer of peers) {
      assert.deepEqual(topLevelTexts(peer), ['beta', 'gamma', 'alpha!'])
    }
    assertNoRootSnapshot(b)
  })

  it('applies local offline cross-parent move without replacing the original Yjs node', () => {
    const peer = createPeer('b', undefined, nestedInitialValue())
    const original = getVisibleYjsNodeAt(peer, [0, 0])

    runYjsUpdate(peer, (yjs) => yjs.disconnect())
    runYjsUpdate(peer, (yjs) => yjs.clearTrace())
    moveNestedBlockToSecondSection(peer)

    assert.deepEqual(nestedTexts(peer), [['beta'], ['gamma', 'alpha']])
    assert.equal(getVisibleYjsNodeAt(peer, [1, 1]), original)
    assert.deepEqual(getYjsState(peer).trace(), [
      {
        fallback: 'virtual-move-placeholder',
        mode: 'traceable-fallback',
        operationType: 'move_node',
      },
    ])
    assertNoRootSnapshot(peer)
  })

  it('preserves concurrent remote text when an offline cross-parent move reconnects', () => {
    const peers = createNestedPeers(['a', 'b', 'c'])
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    moveNestedBlockToSecondSection(b)
    appendNestedRemoteAlpha(a)
    syncConnectedPeers(peers)

    assert.deepEqual(nestedTexts(a), [['alpha!', 'beta'], ['gamma']])
    assert.deepEqual(nestedTexts(b), [['beta'], ['gamma', 'alpha']])

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)

    for (const peer of peers) {
      assert.deepEqual(nestedTexts(peer), [['beta'], ['gamma', 'alpha!']])
    }
    assertNoRootSnapshot(b)
  })

  it('undoes and redoes only the local cross-parent move intent after reconnect', () => {
    const peers = createNestedPeers(['a', 'b', 'c'])
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    moveNestedBlockToSecondSection(b)
    appendNestedRemoteAlpha(a)
    syncConnectedPeers(peers)

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)
    for (const peer of peers) {
      assert.deepEqual(nestedTexts(peer), [['beta'], ['gamma', 'alpha!']])
    }

    runYjsUpdate(b, (yjs) => yjs.undo())
    syncConnectedPeers(peers)
    for (const peer of peers) {
      assert.deepEqual(nestedTexts(peer), [['alpha!', 'beta'], ['gamma']])
    }

    runYjsUpdate(b, (yjs) => yjs.redo())
    syncConnectedPeers(peers)
    for (const peer of peers) {
      assert.deepEqual(nestedTexts(peer), [['beta'], ['gamma', 'alpha!']])
    }
    assertNoRootSnapshot(b)
  })
})
