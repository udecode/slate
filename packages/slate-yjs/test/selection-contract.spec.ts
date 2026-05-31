import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Descendant, Range } from 'slate'

import {
  slatePointToYjsRelativePosition,
  slateRangeToYjsRelativeRange,
  yjsRelativePositionToSlatePoint,
  yjsRelativeRangeToSlateRange,
} from '../src'
import {
  createSeededYjsPeers,
  createYjsPeer,
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

const root = (peer: ReturnType<typeof createPeer>) => getYjsState(peer).root()

const moveFirstBlockToEnd = (peer: ReturnType<typeof createPeer>) => {
  peer.editor.update((tx) => {
    tx.nodes.move({ at: [0], to: [2] })
  })
}

const insertInsideAlpha = (peer: ReturnType<typeof createPeer>) => {
  peer.editor.update((tx) => {
    tx.text.insert('!', { at: { path: [0, 0], offset: 2 } })
  })
}

const removeFirstBlock = (peer: ReturnType<typeof createPeer>) => {
  peer.editor.update((tx) => {
    tx.nodes.remove({ at: [0] })
  })
}

describe('@slate/yjs selection relative-position contract', () => {
  it('round trips a Slate point through a Yjs relative position', () => {
    const peer = createPeer('b')
    const point = { path: [0, 0], offset: 3 }
    const relative = slatePointToYjsRelativePosition(root(peer), point)

    assert.deepEqual(
      yjsRelativePositionToSlatePoint(root(peer), relative),
      point
    )
  })

  it('round trips a Slate range without changing anchor/focus direction', () => {
    const peer = createPeer('b')
    const range: Range = {
      anchor: { path: [1, 0], offset: 4 },
      focus: { path: [0, 0], offset: 1 },
    }
    const relative = slateRangeToYjsRelativeRange(root(peer), range)

    assert.deepEqual(yjsRelativeRangeToSlateRange(root(peer), relative), range)
  })

  it('rebases a stored point across a concurrent text insert', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers
    const relative = slatePointToYjsRelativePosition(root(b), {
      path: [0, 0],
      offset: 3,
    })

    insertInsideAlpha(a)
    syncConnectedPeers(peers)

    assert.deepEqual(yjsRelativePositionToSlatePoint(root(b), relative), {
      path: [0, 0],
      offset: 4,
    })
  })

  it('resolves a stored point through virtual moved-node identity', () => {
    const peer = createPeer('b')
    const relative = slatePointToYjsRelativePosition(root(peer), {
      path: [0, 0],
      offset: 2,
    })

    moveFirstBlockToEnd(peer)

    assert.deepEqual(yjsRelativePositionToSlatePoint(root(peer), relative), {
      path: [2, 0],
      offset: 2,
    })
  })

  it('returns null when the relative position target is no longer visible', () => {
    const peer = createPeer('b')
    const relative = slatePointToYjsRelativePosition(root(peer), {
      path: [0, 0],
      offset: 2,
    })

    removeFirstBlock(peer)

    assert.equal(yjsRelativePositionToSlatePoint(root(peer), relative), null)
  })

  it('does not record selection-only conversions in the Yjs operation trace', () => {
    const peer = createPeer('b')

    runYjsUpdate(peer, (yjs) => yjs.clearTrace())
    slateRangeToYjsRelativeRange(root(peer), {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [1, 0], offset: 2 },
    })

    assert.deepEqual(getYjsState(peer).trace(), [])
  })
})
