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

const initialValue = () => [paragraph('alpha'), paragraph('beta')]

const textMergeValue = (): Descendant[] => [
  {
    type: 'paragraph',
    children: [{ text: 'alpha' }, { text: 'beta' }],
  },
]

const createPeer = (
  clientId: string,
  seedUpdate?: Uint8Array,
  children: Descendant[] = initialValue()
): Peer => {
  const editor = createEditor()

  Editor.replace(editor, {
    children,
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

const createPeers = (
  clientIds: string[],
  children: Descendant[] = initialValue()
) => {
  const [firstClientId, ...remainingClientIds] = clientIds

  if (!firstClientId) {
    return []
  }

  const firstPeer = createPeer(firstClientId, undefined, children)
  const seedUpdate = Y.encodeStateAsUpdate(firstPeer.doc)

  return [
    firstPeer,
    ...remainingClientIds.map((clientId) =>
      createPeer(clientId, seedUpdate, children)
    ),
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

const mergeSecondParagraph = (peer: Peer) => {
  peer.editor.update((tx) => {
    tx.nodes.merge({ at: [1] })
  })
}

const mergeRightText = (peer: Peer) => {
  peer.editor.update((tx) => {
    tx.operations.replay([
      {
        path: [0, 1],
        position: 'alpha'.length,
        properties: {},
        type: 'merge_node',
      },
    ])
  })
}

const appendRemoteTextToLeftParagraph = (peer: Peer) => {
  peer.editor.update((tx) => {
    tx.text.insert('!', { at: { path: [0, 0], offset: 'alpha'.length } })
  })
}

describe('@slate/yjs merge_node collaboration contract', () => {
  it('applies local offline public merge without a root snapshot fallback', () => {
    const peer = createPeer('b')
    const survivor = yjsNodeAt(peer, [0])

    yjsUpdate(peer, (yjs) => yjs.disconnect())
    yjsUpdate(peer, (yjs) => yjs.clearTrace())
    mergeSecondParagraph(peer)

    assert.deepEqual(paragraphTexts(peer), ['alphabeta'])
    assert.equal(yjsNodeAt(peer, [0]), survivor)
    assert.deepEqual(yjsState(peer).trace(), [
      {
        fallback: 'virtual-merge-ref',
        mode: 'traceable-fallback',
        operationType: 'merge_node',
      },
    ])
    assertNoRootSnapshot(peer)
  })

  it('preserves concurrent remote survivor edits when an offline merge reconnects', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    yjsUpdate(b, (yjs) => yjs.disconnect())
    mergeSecondParagraph(b)
    appendRemoteTextToLeftParagraph(a)
    syncConnected(peers)

    assert.deepEqual(paragraphTexts(a), ['alpha!', 'beta'])
    assert.deepEqual(paragraphTexts(b), ['alphabeta'])

    yjsUpdate(b, (yjs) => yjs.connect())
    syncConnected(peers)

    assertAllTexts(peers, ['alpha!beta'])
    assertNoRootSnapshot(b)
  })

  it('recovers merge convergence through real Yjs updates after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [, b] = peers

    yjsUpdate(b, (yjs) => yjs.disconnect())
    mergeSecondParagraph(b)
    yjsUpdate(b, (yjs) => yjs.connect())
    syncConnected(peers)

    assertAllTexts(peers, ['alphabeta'])
  })

  it('undoes and redoes only the local merge intent after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    yjsUpdate(b, (yjs) => yjs.disconnect())
    mergeSecondParagraph(b)
    appendRemoteTextToLeftParagraph(a)
    syncConnected(peers)

    yjsUpdate(b, (yjs) => yjs.connect())
    syncConnected(peers)
    assertAllTexts(peers, ['alpha!beta'])

    yjsUpdate(b, (yjs) => yjs.undo())
    syncConnected(peers)
    assertAllTexts(peers, ['alpha!', 'beta'])

    yjsUpdate(b, (yjs) => yjs.redo())
    syncConnected(peers)
    assertAllTexts(peers, ['alpha!beta'])
    assertNoRootSnapshot(b)
  })

  it('keeps raw text merge_node in a traceable identity-preserving fallback', () => {
    const peers = createPeers(['a', 'b', 'c'], textMergeValue())
    const [a, b] = peers
    const survivor = yjsNodeAt(b, [0, 0])
    const rightText = yjsNodeAt(b, [0, 1])

    yjsUpdate(b, (yjs) => yjs.disconnect())
    yjsUpdate(b, (yjs) => yjs.clearTrace())
    mergeRightText(b)
    appendRemoteTextToLeftParagraph(a)
    syncConnected(peers)

    assert.deepEqual(paragraphTexts(a), ['alpha!beta'])
    assert.deepEqual(paragraphTexts(b), ['alphabeta'])
    assert.equal(yjsNodeAt(b, [0, 0]), survivor)
    assert.equal(yjsNodeAt(b, [0, 1]), rightText)
    assert.deepEqual(yjsState(b).trace(), [
      {
        fallback: 'text-merge-preserve-yjs-boundary',
        mode: 'traceable-fallback',
        operationType: 'merge_node',
      },
    ])

    yjsUpdate(b, (yjs) => yjs.connect())
    syncConnected(peers)
    assertAllTexts(peers, ['alpha!beta'])

    yjsUpdate(b, (yjs) => yjs.undo())
    syncConnected(peers)
    assertAllTexts(peers, ['alpha!beta'])

    yjsUpdate(b, (yjs) => yjs.redo())
    syncConnected(peers)
    assertAllTexts(peers, ['alpha!beta'])
    assertNoRootSnapshot(b)
  })
})
