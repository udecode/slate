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
  section(paragraph('alpha'), paragraph('beta')),
  paragraph('gamma'),
]

const onlyChildValue = () => [section(paragraph('alpha'))]

const tripleChildValue = () => [
  section(paragraph('alpha'), paragraph('beta'), paragraph('gamma')),
  paragraph('delta'),
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

const createPeers = (
  ids: Array<keyof typeof clientIds>,
  children: Descendant[] = initialValue()
) =>
  createSeededYjsPeers({
    children,
    clientIds: ids,
    numericClientIds: clientIds,
  })

const topLevelTexts = (peer: ReturnType<typeof createPeer>) =>
  Editor.getSnapshot(peer.editor).children.map((_, index) =>
    Editor.string(peer.editor, [index])
  )

const liftFirstNestedBlock = (peer: ReturnType<typeof createPeer>) => {
  peer.editor.update((tx) => {
    tx.nodes.lift({ at: [0, 0] })
  })
}

const liftOnlyNestedBlock = liftFirstNestedBlock

const liftLastNestedBlock = (peer: ReturnType<typeof createPeer>) => {
  peer.editor.update((tx) => {
    tx.nodes.lift({ at: [0, 1] })
  })
}

const liftMiddleNestedBlock = (peer: ReturnType<typeof createPeer>) => {
  peer.editor.update((tx) => {
    tx.nodes.lift({ at: [0, 1] })
  })
}

const appendNestedAlpha = (peer: ReturnType<typeof createPeer>) => {
  peer.editor.update((tx) => {
    tx.text.insert('!', { at: { path: [0, 0, 0], offset: 'alpha'.length } })
  })
}

const appendNestedBeta = (peer: ReturnType<typeof createPeer>) => {
  peer.editor.update((tx) => {
    tx.text.insert('!', { at: { path: [0, 1, 0], offset: 'beta'.length } })
  })
}

const collectLiftOperations = (
  lift: (peer: ReturnType<typeof createPeer>) => void = liftFirstNestedBlock,
  children: Descendant[] = initialValue()
) => {
  const peer = createPeer('b', undefined, children)
  const operations: string[] = []

  peer.editor.extend(
    defineEditorExtension({
      name: 'lift-operation-recorder',
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
  lift(peer)

  return operations
}

describe('@slate/yjs liftNodes collaboration contract', () => {
  it('characterizes first-child public liftNodes as move_node', () => {
    assert.deepEqual(collectLiftOperations(), ['move_node'])
  })

  it('characterizes only-child public liftNodes as move_node then remove_node', () => {
    assert.deepEqual(
      collectLiftOperations(liftOnlyNestedBlock, onlyChildValue()),
      ['move_node', 'remove_node']
    )
  })

  it('characterizes middle-child public liftNodes as split_node then move_node', () => {
    assert.deepEqual(
      collectLiftOperations(liftMiddleNestedBlock, tripleChildValue()),
      ['split_node', 'move_node']
    )
  })

  it('applies local offline first-child lift without replacing the original Yjs node', () => {
    const peer = createPeer('b')
    const original = getVisibleYjsNodeAt(peer, [0, 0])

    runYjsUpdate(peer, (yjs) => yjs.disconnect())
    runYjsUpdate(peer, (yjs) => yjs.clearTrace())
    liftFirstNestedBlock(peer)

    assert.deepEqual(topLevelTexts(peer), ['alpha', 'beta', 'gamma'])
    assert.equal(getVisibleYjsNodeAt(peer, [0]), original)
    assert.deepEqual(getYjsState(peer).trace(), [
      {
        fallback: 'virtual-move-placeholder',
        mode: 'traceable-fallback',
        operationType: 'move_node',
      },
    ])
    assertNoRootSnapshot(peer)
  })

  it('preserves concurrent remote text when an offline first-child lift reconnects', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    liftFirstNestedBlock(b)
    appendNestedAlpha(a)
    syncConnectedPeers(peers)

    assert.deepEqual(topLevelTexts(a), ['alpha!beta', 'gamma'])
    assert.deepEqual(topLevelTexts(b), ['alpha', 'beta', 'gamma'])

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)

    for (const peer of peers) {
      assert.deepEqual(topLevelTexts(peer), ['alpha!', 'beta', 'gamma'])
    }
    assertNoRootSnapshot(b)
  })

  it('recovers first-child lift convergence through real Yjs updates after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    liftFirstNestedBlock(b)
    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)

    for (const peer of peers) {
      assert.deepEqual(topLevelTexts(peer), ['alpha', 'beta', 'gamma'])
    }
  })

  it('undoes and redoes only the local first-child lift intent after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    liftFirstNestedBlock(b)
    appendNestedAlpha(a)
    syncConnectedPeers(peers)

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)
    for (const peer of peers) {
      assert.deepEqual(topLevelTexts(peer), ['alpha!', 'beta', 'gamma'])
    }

    runYjsUpdate(b, (yjs) => yjs.undo())
    syncConnectedPeers(peers)
    for (const peer of peers) {
      assert.deepEqual(topLevelTexts(peer), ['alpha!beta', 'gamma'])
    }

    runYjsUpdate(b, (yjs) => yjs.redo())
    syncConnectedPeers(peers)
    for (const peer of peers) {
      assert.deepEqual(topLevelTexts(peer), ['alpha!', 'beta', 'gamma'])
    }
    assertNoRootSnapshot(b)
  })

  it('applies local offline only-child lift without replacing the original Yjs node', () => {
    const peer = createPeer('b', undefined, onlyChildValue())
    const original = getVisibleYjsNodeAt(peer, [0, 0])

    runYjsUpdate(peer, (yjs) => yjs.disconnect())
    runYjsUpdate(peer, (yjs) => yjs.clearTrace())
    liftOnlyNestedBlock(peer)

    assert.deepEqual(topLevelTexts(peer), ['alpha'])
    assert.equal(getVisibleYjsNodeAt(peer, [0]), original)
    assert.deepEqual(getYjsState(peer).trace(), [
      {
        fallback: 'virtual-move-placeholder',
        mode: 'traceable-fallback',
        operationType: 'move_node',
      },
      {
        fallback: 'virtual-move-parent-remove',
        mode: 'traceable-fallback',
        operationType: 'remove_node',
      },
    ])
    assertNoRootSnapshot(peer)
  })

  it('preserves concurrent remote text when an offline only-child lift reconnects', () => {
    const peers = createPeers(['a', 'b', 'c'], onlyChildValue())
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    liftOnlyNestedBlock(b)
    appendNestedAlpha(a)
    syncConnectedPeers(peers)

    assert.deepEqual(topLevelTexts(a), ['alpha!'])
    assert.deepEqual(topLevelTexts(b), ['alpha'])

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)

    for (const peer of peers) {
      assert.deepEqual(topLevelTexts(peer), ['alpha!'])
    }
    assertNoRootSnapshot(b)
  })

  it('recovers only-child lift convergence through real Yjs updates after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'], onlyChildValue())
    const [, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    liftOnlyNestedBlock(b)
    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)

    for (const peer of peers) {
      assert.deepEqual(topLevelTexts(peer), ['alpha'])
    }
  })

  it('undoes and redoes only the local only-child lift intent after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'], onlyChildValue())
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    liftOnlyNestedBlock(b)
    appendNestedAlpha(a)
    syncConnectedPeers(peers)

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)
    for (const peer of peers) {
      assert.deepEqual(topLevelTexts(peer), ['alpha!'])
    }

    runYjsUpdate(b, (yjs) => yjs.undo())
    syncConnectedPeers(peers)
    for (const peer of peers) {
      assert.deepEqual(topLevelTexts(peer), ['alpha!'])
    }

    runYjsUpdate(b, (yjs) => yjs.redo())
    syncConnectedPeers(peers)
    for (const peer of peers) {
      assert.deepEqual(topLevelTexts(peer), ['alpha!'])
    }
    assertNoRootSnapshot(b)
  })

  it('applies local offline last-child lift without replacing the original Yjs node', () => {
    const peer = createPeer('b')
    const original = getVisibleYjsNodeAt(peer, [0, 1])

    runYjsUpdate(peer, (yjs) => yjs.disconnect())
    runYjsUpdate(peer, (yjs) => yjs.clearTrace())
    liftLastNestedBlock(peer)

    assert.deepEqual(topLevelTexts(peer), ['alpha', 'beta', 'gamma'])
    assert.equal(getVisibleYjsNodeAt(peer, [1]), original)
    assert.deepEqual(getYjsState(peer).trace(), [
      {
        fallback: 'virtual-move-placeholder',
        mode: 'traceable-fallback',
        operationType: 'move_node',
      },
    ])
    assertNoRootSnapshot(peer)
  })

  it('preserves concurrent remote text when an offline last-child lift reconnects', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    liftLastNestedBlock(b)
    appendNestedBeta(a)
    syncConnectedPeers(peers)

    assert.deepEqual(topLevelTexts(a), ['alphabeta!', 'gamma'])
    assert.deepEqual(topLevelTexts(b), ['alpha', 'beta', 'gamma'])

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)

    for (const peer of peers) {
      assert.deepEqual(topLevelTexts(peer), ['alpha', 'beta!', 'gamma'])
    }
    assertNoRootSnapshot(b)
  })

  it('recovers last-child lift convergence through real Yjs updates after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    liftLastNestedBlock(b)
    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)

    for (const peer of peers) {
      assert.deepEqual(topLevelTexts(peer), ['alpha', 'beta', 'gamma'])
    }
  })

  it('undoes and redoes only the local last-child lift intent after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    liftLastNestedBlock(b)
    appendNestedBeta(a)
    syncConnectedPeers(peers)

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)
    for (const peer of peers) {
      assert.deepEqual(topLevelTexts(peer), ['alpha', 'beta!', 'gamma'])
    }

    runYjsUpdate(b, (yjs) => yjs.undo())
    syncConnectedPeers(peers)
    for (const peer of peers) {
      assert.deepEqual(topLevelTexts(peer), ['alphabeta!', 'gamma'])
    }

    runYjsUpdate(b, (yjs) => yjs.redo())
    syncConnectedPeers(peers)
    for (const peer of peers) {
      assert.deepEqual(topLevelTexts(peer), ['alpha', 'beta!', 'gamma'])
    }
    assertNoRootSnapshot(b)
  })

  it('applies local offline middle-child lift through split_node and move_node', () => {
    const peer = createPeer('b', undefined, tripleChildValue())
    const original = getVisibleYjsNodeAt(peer, [0, 1])

    runYjsUpdate(peer, (yjs) => yjs.disconnect())
    runYjsUpdate(peer, (yjs) => yjs.clearTrace())
    liftMiddleNestedBlock(peer)

    assert.deepEqual(topLevelTexts(peer), ['alpha', 'beta', 'gamma', 'delta'])
    assert.equal(getVisibleYjsNodeAt(peer, [1]), original)
    assert.deepEqual(getYjsState(peer).trace(), [
      { mode: 'operation', operationType: 'split_node' },
      {
        fallback: 'virtual-move-placeholder',
        mode: 'traceable-fallback',
        operationType: 'move_node',
      },
    ])
    assertNoRootSnapshot(peer)
  })

  it('preserves concurrent remote text when an offline middle-child lift reconnects', () => {
    const peers = createPeers(['a', 'b', 'c'], tripleChildValue())
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    liftMiddleNestedBlock(b)
    appendNestedBeta(a)
    syncConnectedPeers(peers)

    assert.deepEqual(topLevelTexts(a), ['alphabeta!gamma', 'delta'])
    assert.deepEqual(topLevelTexts(b), ['alpha', 'beta', 'gamma', 'delta'])

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)

    for (const peer of peers) {
      assert.deepEqual(topLevelTexts(peer), [
        'alpha',
        'beta!',
        'gamma',
        'delta',
      ])
    }
    assertNoRootSnapshot(b)
  })

  it('recovers middle-child lift convergence through real Yjs updates after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'], tripleChildValue())
    const [, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    liftMiddleNestedBlock(b)
    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)

    for (const peer of peers) {
      assert.deepEqual(topLevelTexts(peer), ['alpha', 'beta', 'gamma', 'delta'])
    }
  })

  it('undoes and redoes only the local middle-child lift intent after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'], tripleChildValue())
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    liftMiddleNestedBlock(b)
    appendNestedBeta(a)
    syncConnectedPeers(peers)

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)
    for (const peer of peers) {
      assert.deepEqual(topLevelTexts(peer), [
        'alpha',
        'beta!',
        'gamma',
        'delta',
      ])
    }

    runYjsUpdate(b, (yjs) => yjs.undo())
    syncConnectedPeers(peers)
    for (const peer of peers) {
      assert.deepEqual(topLevelTexts(peer), ['alphabeta!gamma', 'delta'])
    }

    runYjsUpdate(b, (yjs) => yjs.redo())
    syncConnectedPeers(peers)
    for (const peer of peers) {
      assert.deepEqual(topLevelTexts(peer), [
        'alpha',
        'beta!',
        'gamma',
        'delta',
      ])
    }
    assertNoRootSnapshot(b)
  })
})
