import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createEditor, type Descendant } from 'slate'
import { Editor } from 'slate/internal'
import * as Y from 'yjs'

import { createYjsExtension } from '../src'

type Peer = {
  doc: Y.Doc
  editor: ReturnType<typeof createEditor>
}

const paragraph = (text: string): Descendant => ({
  type: 'paragraph',
  children: [{ text }],
})

const initialValue = () => [paragraph('alphabeta')]

const createPeer = (clientId: string, seedUpdate?: Uint8Array): Peer => {
  const editor = createEditor()

  Editor.replace(editor, {
    children: initialValue(),
    selection: null,
    marks: null,
  })

  const doc = new Y.Doc()

  if (seedUpdate) {
    Y.applyUpdate(doc, seedUpdate)
  }

  editor.extend(createYjsExtension({ clientId, doc, rootName: 'slate' }))

  return { doc, editor }
}

const createPeers = (clientIds: string[]) => {
  const [firstClientId, ...remainingClientIds] = clientIds

  if (!firstClientId) {
    return []
  }

  const firstPeer = createPeer(firstClientId)
  const seedUpdate = Y.encodeStateAsUpdate(firstPeer.doc)

  return [
    firstPeer,
    ...remainingClientIds.map((clientId) => createPeer(clientId, seedUpdate)),
  ]
}

const yjsState = (peer: Peer) => peer.editor.read((state) => (state as any).yjs)

const yjsUpdate = (peer: Peer, fn: (tx: any) => void) => {
  peer.editor.update((tx) => {
    fn((tx as any).yjs)
  })
}

const paragraphTexts = (peer: Peer) =>
  Editor.getSnapshot(peer.editor).children.map((_, index) =>
    Editor.string(peer.editor, [index])
  )

const yjsNodeAt = (peer: Peer, path: number[]): Y.XmlElement | Y.XmlText => {
  let current: Y.XmlElement | Y.XmlText = yjsState(peer).root()

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

const assertNoRootSnapshot = (peer: Peer) => {
  assert.equal(
    yjsState(peer)
      .trace()
      .some((entry: { mode: string }) => entry.mode === 'root-snapshot'),
    false
  )
}

const syncConnected = (peers: Peer[]) => {
  for (const source of peers) {
    if (!yjsState(source).connected()) {
      continue
    }

    const update = Y.encodeStateAsUpdate(source.doc)

    for (const target of peers) {
      if (source === target || !yjsState(target).connected()) {
        continue
      }

      Y.applyUpdate(target.doc, update, source)
    }
  }
}

const assertAllTexts = (peers: Peer[], expected: string[]) => {
  for (const peer of peers) {
    assert.deepEqual(paragraphTexts(peer), expected)
  }
}

const splitParagraph = (peer: Peer) => {
  peer.editor.update((tx) => {
    tx.nodes.split({ at: { path: [0, 0], offset: 'alph'.length } })
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
