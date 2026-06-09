import assert from 'node:assert/strict'
import { createEditor, type Descendant } from 'slate'
import { Editor } from 'slate/internal'
import * as Y from 'yjs'

import { createYjsExtension } from '../../src'
import { getYjsNode } from '../../src/core/document'
import type {
  YjsAwarenessChange,
  YjsAwarenessLike,
  YjsProviderLike,
  YjsState,
  YjsTx,
} from '../../src/core/types'

export type Peer = {
  cleanup: () => void
  doc: Y.Doc
  editor: ReturnType<typeof createEditor>
}

type YjsStateView = {
  yjs: YjsState
}

type YjsTxView = {
  yjs: YjsTx
}

export class FakeAwareness implements YjsAwarenessLike {
  readonly clientID: number
  readonly doc: { clientID: number }

  private readonly listeners = new Set<(event: YjsAwarenessChange) => void>()
  private localState: Record<string, unknown> | null = null
  private readonly states = new Map<number, Record<string, unknown>>()

  constructor(clientID: number) {
    this.clientID = clientID
    this.doc = { clientID }
  }

  getLocalState() {
    return this.localState
  }

  getStates() {
    return this.states
  }

  off(event: 'change', handler: (event: YjsAwarenessChange) => void) {
    if (event === 'change') {
      this.listeners.delete(handler)
    }
  }

  on(event: 'change', handler: (event: YjsAwarenessChange) => void) {
    if (event === 'change') {
      this.listeners.add(handler)
    }
  }

  removeRemoteState(clientId: number) {
    this.states.delete(clientId)
    this.emit({ added: [], removed: [clientId], updated: [] })
  }

  setLocalStateField(field: string, value: unknown) {
    this.localState = {
      ...(this.localState ?? {}),
      [field]: value,
    }
    this.states.set(this.clientID, this.localState)
    this.emit({ added: [], removed: [], updated: [this.clientID] })
  }

  setRemoteState(clientId: number, state: Record<string, unknown>) {
    const added = this.states.has(clientId) ? [] : [clientId]
    const updated = this.states.has(clientId) ? [clientId] : []

    this.states.set(clientId, state)
    this.emit({ added, removed: [], updated })
  }

  private emit(event: YjsAwarenessChange) {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

export const createYjsPeer = ({
  children,
  awareness,
  clientId,
  numericClientId,
  provider,
  seedUpdate,
}: {
  awareness?: YjsAwarenessLike
  children: Descendant[]
  clientId: string
  numericClientId?: number
  provider?: YjsProviderLike
  seedUpdate?: Uint8Array
}): Peer => {
  const editor = createEditor()

  Editor.replace(editor, {
    children,
    marks: null,
    selection: null,
  })

  const doc = new Y.Doc()

  if (numericClientId !== undefined) {
    doc.clientID = numericClientId
  }

  if (seedUpdate) {
    Y.applyUpdate(doc, seedUpdate)
  }

  const cleanup = editor.extend(
    createYjsExtension({
      awareness,
      clientId,
      doc,
      provider,
      rootName: 'slate',
    })
  )

  return { cleanup, doc, editor }
}

export const createSeededYjsPeers = ({
  children,
  clientIds,
  numericClientIds,
}: {
  children: Descendant[]
  clientIds: string[]
  numericClientIds?: Record<string, number>
}) => {
  const [firstClientId, ...remainingClientIds] = clientIds

  if (!firstClientId) {
    return []
  }

  const firstPeer = createYjsPeer({
    children,
    clientId: firstClientId,
    numericClientId: numericClientIds?.[firstClientId],
  })
  const seedUpdate = Y.encodeStateAsUpdate(firstPeer.doc)

  return [
    firstPeer,
    ...remainingClientIds.map((clientId) =>
      createYjsPeer({
        children,
        clientId,
        numericClientId: numericClientIds?.[clientId],
        seedUpdate,
      })
    ),
  ]
}

export const getParagraphTexts = (peer: Peer) =>
  Editor.getSnapshot(peer.editor).children.map((_, index) =>
    Editor.string(peer.editor, [index])
  )

export const getYjsNodeAt = (
  peer: Peer,
  path: number[]
): Y.XmlElement | Y.XmlText => {
  let current: Y.XmlElement | Y.XmlText = getYjsState(peer).root()

  for (const index of path) {
    if (current instanceof Y.XmlText) {
      throw new Error(`Cannot descend into Y.XmlText at ${path.join('.')}`)
    }

    const child = current
      .toArray()
      .filter(
        (value): value is Y.XmlElement | Y.XmlText =>
          value instanceof Y.XmlElement || value instanceof Y.XmlText
      )[index]

    if (!child) {
      throw new Error(`No Yjs node at ${path.join('.')}`)
    }

    current = child
  }

  return current
}

export const getVisibleYjsNodeAt = (
  peer: Peer,
  path: number[]
): Y.XmlElement | Y.XmlText => getYjsNode(getYjsState(peer).root(), path)

export const getYjsState = (peer: Peer) =>
  peer.editor.read((state) => (state as YjsStateView).yjs)

export const runYjsUpdate = (peer: Peer, fn: (tx: YjsTx) => void) => {
  peer.editor.update((tx) => {
    fn((tx as YjsTxView).yjs)
  })
}

export const syncConnectedPeers = (peers: Peer[]) => {
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

export const assertNoRootSnapshot = (peer: Peer) => {
  assert.equal(
    getYjsState(peer)
      .trace()
      .some((entry: { mode: string }) => entry.mode === 'root-snapshot'),
    false
  )
}

export const assertPeerTexts = (peers: Peer[], expected: string[]) => {
  for (const [index, peer] of peers.entries()) {
    assert.deepEqual(getParagraphTexts(peer), expected, `peer ${index}`)
  }
}
