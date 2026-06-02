import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'

import { createEditor } from 'slate'
import { Editor } from 'slate/internal'
import * as Y from 'yjs'

import { createYjsExtension } from '../../../../packages/slate-yjs/src/index.ts'
import { summarize, writeBenchmarkArtifact } from '../../shared/stats.mjs'

const iterations = Number.parseInt(
  process.env.SLATE_YJS_COLLAB_ITERATIONS ?? '5',
  10
)
const peerCount = Number.parseInt(process.env.SLATE_YJS_COLLAB_PEERS ?? '4', 10)
const syncBlocks = Number.parseInt(
  process.env.SLATE_YJS_COLLAB_SYNC_BLOCKS ?? '100',
  10
)
const syncOps = Number.parseInt(
  process.env.SLATE_YJS_COLLAB_SYNC_OPS ?? '40',
  10
)
const awarenessUpdates = Number.parseInt(
  process.env.SLATE_YJS_COLLAB_AWARENESS_UPDATES ?? '100',
  10
)
const reconnectOps = Number.parseInt(
  process.env.SLATE_YJS_COLLAB_RECONNECT_OPS ?? '40',
  10
)
const largeBlocks = Number.parseInt(
  process.env.SLATE_YJS_COLLAB_LARGE_BLOCKS ?? '1000',
  10
)
const largeOps = Number.parseInt(
  process.env.SLATE_YJS_COLLAB_LARGE_OPS ?? '120',
  10
)

class FakeAwareness {
  constructor(clientID) {
    this.clientID = clientID
    this.doc = { clientID }
    this.listeners = new Set()
    this.localState = null
    this.states = new Map()
  }

  getLocalState() {
    return this.localState
  }

  getStates() {
    return this.states
  }

  off(event, handler) {
    if (event === 'change') {
      this.listeners.delete(handler)
    }
  }

  on(event, handler) {
    if (event === 'change') {
      this.listeners.add(handler)
    }
  }

  setLocalStateField(field, value) {
    this.localState = {
      ...(this.localState ?? {}),
      [field]: value,
    }
    this.states.set(this.clientID, this.localState)
    this.emit({ added: [], removed: [], updated: [this.clientID] })
  }

  setRemoteState(clientId, state) {
    const added = this.states.has(clientId) ? [] : [clientId]
    const updated = this.states.has(clientId) ? [clientId] : []

    this.states.set(clientId, state)
    this.emit({ added, removed: [], updated })
  }

  emit(event) {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

const paragraph = (text) => ({
  type: 'paragraph',
  children: [{ text }],
})

const createDocument = (blocks, prefix = 'block') =>
  Array.from({ length: blocks }, (_, index) =>
    paragraph(`${prefix}-${String(index).padStart(5, '0')}`)
  )

const createPeer = ({
  awareness,
  children,
  clientId,
  numericClientId,
  seed,
}) => {
  const editor = createEditor()

  Editor.replace(editor, {
    children: structuredClone(children),
    marks: null,
    selection: {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    },
  })

  const doc = new Y.Doc()

  if (numericClientId !== undefined) {
    doc.clientID = numericClientId
  }

  if (seed) {
    Y.applyUpdate(doc, seed)
  }

  editor.extend(
    createYjsExtension({ awareness, clientId, doc, rootName: 'slate' })
  )

  return { awareness, doc, editor, id: clientId }
}

const createSeededPeers = ({
  blocks,
  prefix = 'block',
  withAwareness = false,
}) => {
  const children = createDocument(blocks, prefix)
  const ids = Array.from({ length: peerCount }, (_, index) => `peer-${index}`)
  const firstAwareness = withAwareness ? new FakeAwareness(101) : undefined
  const first = createPeer({
    awareness: firstAwareness,
    children,
    clientId: ids[0],
    numericClientId: 101,
  })
  const seed = Y.encodeStateAsUpdate(first.doc)

  return [
    first,
    ...ids.slice(1).map((clientId, index) => {
      const numericClientId = 102 + index

      return createPeer({
        awareness: withAwareness
          ? new FakeAwareness(numericClientId)
          : undefined,
        children,
        clientId,
        numericClientId,
        seed,
      })
    }),
  ]
}

const getYjsState = (peer) => peer.editor.read((state) => state.yjs)

const runYjsUpdate = (peer, fn) => {
  peer.editor.update((tx) => {
    fn(tx.yjs)
  })
}

const getParagraphTexts = (peer) =>
  Editor.getSnapshot(peer.editor).children.map((_, index) =>
    Editor.string(peer.editor, [index])
  )

const syncConnectedPeers = (peers) => {
  for (const source of peers) {
    if (!getYjsState(source).connected()) {
      continue
    }

    const update = Y.encodeStateAsUpdate(source.doc)

    for (const target of peers) {
      if (source === target || !getYjsState(target).connected()) {
        continue
      }

      Y.applyUpdate(target.doc, update, source)
    }
  }
}

const assertPeerTexts = (peers) => {
  const expected = getParagraphTexts(peers[0])

  for (const peer of peers) {
    assert.deepEqual(getParagraphTexts(peer), expected)
  }
}

const assertNoRootSnapshot = (peer) => {
  assert.equal(
    getYjsState(peer)
      .trace()
      .some((entry) => entry.mode === 'root-snapshot'),
    false
  )
}

const measure = (run) => {
  const samples = []

  for (let iteration = 0; iteration < iterations + 1; iteration += 1) {
    const start = performance.now()
    run()
    const duration = performance.now() - start

    if (iteration > 0) {
      samples.push(duration)
    }
  }

  return summarize(samples)
}

const insertDistributedText = (peer, ops, blocks, textPrefix) => {
  peer.editor.update((tx) => {
    for (let index = 0; index < ops; index += 1) {
      const blockIndex = index % blocks
      tx.text.insert(`${textPrefix}${index % 10}`, {
        at: { path: [blockIndex, 0], offset: 0 },
      })
    }
  })
}

const measureMultiEditorSync = () =>
  measure(() => {
    const peers = createSeededPeers({ blocks: syncBlocks, prefix: 'sync' })

    insertDistributedText(peers[0], syncOps, syncBlocks, 's')
    syncConnectedPeers(peers)

    assertPeerTexts(peers)
    assertNoRootSnapshot(peers[0])
  })

const broadcastAwareness = (source, targets) => {
  const state = source.awareness.getLocalState()

  assert(state)

  for (const target of targets) {
    target.awareness.setRemoteState(source.doc.clientID, state)
  }
}

const selection = (blockIndex, offset = 1) => ({
  anchor: { path: [blockIndex, 0], offset },
  focus: { path: [blockIndex, 0], offset },
})

const measureAwarenessUpdates = () =>
  measure(() => {
    const blocks = Math.max(1, Math.min(syncBlocks, awarenessUpdates))
    const peers = createSeededPeers({
      blocks,
      prefix: 'awareness',
      withAwareness: true,
    })

    for (let index = 0; index < awarenessUpdates; index += 1) {
      const source = peers[index % peers.length]
      const targets = peers.filter((peer) => peer !== source)

      runYjsUpdate(source, (yjs) => {
        yjs.sendSelection(selection(index % blocks), {
          name: source.id,
          update: index,
        })
      })
      broadcastAwareness(source, targets)
    }

    for (const peer of peers) {
      assert.equal(getYjsState(peer).remoteCursors().length, peerCount - 1)
    }
  })

const measureReconnect = () =>
  measure(() => {
    const peers = createSeededPeers({ blocks: syncBlocks, prefix: 'reconnect' })
    const [online, offline] = peers

    runYjsUpdate(offline, (yjs) => yjs.disconnect())
    insertDistributedText(offline, reconnectOps, syncBlocks, 'o')
    insertDistributedText(online, reconnectOps, syncBlocks, 'r')
    syncConnectedPeers(peers)

    runYjsUpdate(offline, (yjs) => yjs.connect())
    syncConnectedPeers(peers)

    assertPeerTexts(peers)
    assertNoRootSnapshot(offline)
  })

const measureLargeDocSync = () =>
  measure(() => {
    const peers = createSeededPeers({ blocks: largeBlocks, prefix: 'large' })

    insertDistributedText(peers[0], largeOps, largeBlocks, 'l')
    syncConnectedPeers(peers)

    assertPeerTexts(peers)
    assertNoRootSnapshot(peers[0])
  })

const lanes = {
  multiEditorSyncMs: measureMultiEditorSync(),
  awarenessUpdatesMs: measureAwarenessUpdates(),
  reconnectMs: measureReconnect(),
  largeDocSyncMs: measureLargeDocSync(),
}

const metrics = {
  yjs_multi_editor_sync_p95_ms: lanes.multiEditorSyncMs.p95,
  yjs_awareness_updates_p95_ms: lanes.awarenessUpdatesMs.p95,
  yjs_reconnect_p95_ms: lanes.reconnectMs.p95,
  yjs_large_doc_sync_p95_ms: lanes.largeDocSyncMs.p95,
  yjs_collaboration_worst_p95_ms: Math.max(
    lanes.multiEditorSyncMs.p95,
    lanes.awarenessUpdatesMs.p95,
    lanes.reconnectMs.p95,
    lanes.largeDocSyncMs.p95
  ),
  yjs_correctness_failures: 0,
}

const result = {
  benchmark: 'slate-yjs-collaboration',
  artifactVersion: 1,
  config: {
    awarenessUpdates,
    iterations,
    largeBlocks,
    largeOps,
    peerCount,
    reconnectOps,
    syncBlocks,
    syncOps,
  },
  invariants: {
    awarenessCursorsConverge: true,
    connectedPeersOnlyReceiveUpdates: true,
    largeDocumentConverges: true,
    multiEditorConverges: true,
    noRootSnapshotFallback: true,
    reconnectConverges: true,
  },
  lanes,
  metrics,
  thresholdPolicy: {
    mode: 'calibration-only',
    releaseGate: false,
    repeatRunsRequiredBeforeEnforcement: 3,
  },
}

await writeBenchmarkArtifact(
  'tmp/slate-yjs-collaboration-benchmark.json',
  result
)

for (const [name, value] of Object.entries(metrics)) {
  console.log(`METRIC ${name}=${value}`)
}

console.log(JSON.stringify(result, null, 2))
