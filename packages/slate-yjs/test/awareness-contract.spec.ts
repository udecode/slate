import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Descendant, Range } from 'slate'

import {
  createYjsPeer,
  FakeAwareness,
  getYjsState,
  runYjsUpdate,
} from './support/collaboration'

const paragraph = (text: string): Descendant => ({
  type: 'paragraph',
  children: [{ text }],
})

const initialValue = () => [
  paragraph('alpha'),
  paragraph('beta'),
  paragraph('gamma'),
]

const selection = (path = [0, 0], offset = 2): Range => ({
  anchor: { path, offset },
  focus: { path, offset },
})

const createAwarePeer = () => {
  const awareness = new FakeAwareness(2)
  const peer = createYjsPeer({
    awareness,
    children: initialValue(),
    clientId: 'b',
    numericClientId: 2,
  })

  return { awareness, peer }
}

const sendRemoteSelection = (
  peer: ReturnType<typeof createAwarePeer>['peer'],
  awareness: FakeAwareness,
  range: Range,
  clientId = 101
) => {
  runYjsUpdate(peer, (yjs) => {
    yjs.sendSelection(range)
    awareness.setRemoteState(clientId, {
      data: { name: 'Ada' },
      selection: awareness.getLocalState()?.selection,
    })
  })
}

describe('@slate/yjs awareness contract', () => {
  it('publishes local selections as relative positions without changing document trace', () => {
    const { awareness, peer } = createAwarePeer()
    const range = selection([1, 0], 3)

    runYjsUpdate(peer, (yjs) => {
      yjs.clearTrace()
      yjs.sendSelection(range, { name: 'B' })
    })

    assert.deepEqual(awareness.getLocalState()?.data, { name: 'B' })
    assert.deepEqual(getYjsState(peer).trace(), [])
    assert.deepEqual(getYjsState(peer).remoteCursors(), [])
  })

  it('projects remote awareness selections to Slate ranges', () => {
    const { awareness, peer } = createAwarePeer()
    const range = selection([1, 0], 3)

    sendRemoteSelection(peer, awareness, range)

    assert.deepEqual(getYjsState(peer).remoteCursors(), [
      {
        clientId: 101,
        data: { name: 'Ada' },
        selection: range,
      },
    ])
  })

  it('auto-publishes local selection commits without document operations', () => {
    const { awareness, peer } = createAwarePeer()
    const range = selection([0, 0], 1)

    runYjsUpdate(peer, (yjs) => yjs.clearTrace())
    peer.editor.update((tx) => {
      tx.selection.set(range)
    })
    awareness.setRemoteState(101, {
      selection: awareness.getLocalState()?.selection,
    })

    assert.deepEqual(getYjsState(peer).trace(), [])
    assert.deepEqual(getYjsState(peer).remoteCursors()[0]?.selection, range)
  })

  it('does not expose remote cursors while disconnected', () => {
    const { awareness, peer } = createAwarePeer()

    sendRemoteSelection(peer, awareness, selection())
    runYjsUpdate(peer, (yjs) => yjs.disconnect())

    assert.deepEqual(getYjsState(peer).remoteCursors(), [])

    runYjsUpdate(peer, (yjs) => yjs.connect())

    assert.equal(getYjsState(peer).remoteCursors().length, 1)
  })

  it('increments awareness revision on remote changes', () => {
    const { awareness, peer } = createAwarePeer()
    const before = getYjsState(peer).awarenessRevision()

    sendRemoteSelection(peer, awareness, selection())

    assert.equal(getYjsState(peer).awarenessRevision() > before, true)
  })

  it('notifies awareness subscribers on remote changes', () => {
    const { awareness, peer } = createAwarePeer()
    let notifications = 0
    const unsubscribe = getYjsState(peer).subscribeAwareness(() => {
      notifications += 1
    })

    sendRemoteSelection(peer, awareness, selection())
    unsubscribe()
    sendRemoteSelection(peer, awareness, selection([1, 0], 1))

    assert.equal(notifications, 2)
  })

  it('rebases remote selections through virtual moved-node identity', () => {
    const { awareness, peer } = createAwarePeer()

    sendRemoteSelection(peer, awareness, selection([0, 0], 2))

    peer.editor.update((tx) => {
      tx.nodes.move({ at: [0], to: [2] })
    })

    assert.deepEqual(getYjsState(peer).remoteCursors()[0]?.selection, {
      anchor: { path: [2, 0], offset: 2 },
      focus: { path: [2, 0], offset: 2 },
    })
  })

  it('clears the local awareness selection without clearing cursor data', () => {
    const { awareness, peer } = createAwarePeer()

    runYjsUpdate(peer, (yjs) => {
      yjs.sendSelection(selection(), { name: 'B' })
      yjs.clearSelection()
    })

    assert.deepEqual(awareness.getLocalState(), {
      data: { name: 'B' },
      selection: null,
    })
  })
})
