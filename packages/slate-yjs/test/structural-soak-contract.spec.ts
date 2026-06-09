import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Descendant, Operation } from 'slate'
import { Editor } from 'slate/internal'
import * as Y from 'yjs'

import { readSlateValueFromYjs } from '../src/core/document'
import { applySlateOperationToYjs } from '../src/core/operations'
import type { Peer } from './support/collaboration'
import {
  createSeededYjsPeers,
  createYjsPeer,
  FakeAwareness,
  getYjsState,
  runYjsUpdate,
  syncConnectedPeers,
} from './support/collaboration'

type PeerId = 'a' | 'b' | 'c' | 'd'

const clientIds: Record<PeerId, number> = {
  a: 101,
  b: 202,
  c: 303,
  d: 404,
}

const appendTexts: Record<PeerId, string> = {
  a: ' Ada',
  b: ' Lin',
  c: ' Ken',
  d: ' Eve',
}

const replacementTexts: Record<PeerId, string> = {
  a: 'Ada canonical snapshot.',
  b: 'Lin canonical snapshot.',
  c: 'Ken canonical snapshot.',
  d: 'Eve canonical snapshot.',
}

const paragraph = (text: string): Descendant => ({
  children: [{ text }],
  type: 'paragraph',
})

const initialValue = () => [paragraph('Hello world!')]

const createPeers = () => {
  const peers = createSeededYjsPeers({
    children: initialValue(),
    clientIds: ['a', 'b', 'c', 'd'],
    numericClientIds: clientIds,
  })

  return Object.fromEntries(
    (['a', 'b', 'c', 'd'] as const).map((id, index) => [id, peers[index]!])
  ) as Record<PeerId, Peer>
}

const createAwarePeers = () => {
  const first = createYjsPeer({
    awareness: new FakeAwareness(clientIds.a),
    children: initialValue(),
    clientId: 'a',
    numericClientId: clientIds.a,
  })
  const seedUpdate = Y.encodeStateAsUpdate(first.doc)
  const peers = {
    a: first,
    b: createYjsPeer({
      awareness: new FakeAwareness(clientIds.b),
      children: initialValue(),
      clientId: 'b',
      numericClientId: clientIds.b,
      seedUpdate,
    }),
    c: createYjsPeer({
      awareness: new FakeAwareness(clientIds.c),
      children: initialValue(),
      clientId: 'c',
      numericClientId: clientIds.c,
      seedUpdate,
    }),
    d: createYjsPeer({
      awareness: new FakeAwareness(clientIds.d),
      children: initialValue(),
      clientId: 'd',
      numericClientId: clientIds.d,
      seedUpdate,
    }),
  }

  return peers
}

const allPeers = (peers: Record<PeerId, Peer>) =>
  ['a', 'b', 'c', 'd'].map((id) => peers[id as PeerId])

const editorValueOf = (peer: Peer) =>
  Editor.getSnapshot(peer.editor).children as Descendant[]

type TextEntry = {
  path: number[]
  text: string
}

const isText = (node: Descendant): node is Descendant & { text: string } =>
  'text' in node

const hasChildren = (
  node: Descendant
): node is Descendant & { children: readonly Descendant[] } =>
  'children' in node && Array.isArray(node.children)

const findTextEntryInNode = (
  node: Descendant,
  path: number[],
  direction: 'first' | 'last'
): TextEntry | null => {
  if (isText(node)) {
    return { path, text: node.text }
  }

  if (!hasChildren(node)) {
    return null
  }

  const start = direction === 'first' ? 0 : node.children.length - 1
  const end = direction === 'first' ? node.children.length : -1
  const step = direction === 'first' ? 1 : -1

  for (let index = start; index !== end; index += step) {
    const child = node.children[index]

    if (!child) {
      continue
    }

    const entry = findTextEntryInNode(child, [...path, index], direction)

    if (entry) {
      return entry
    }
  }

  return null
}

const firstBlockTextEntry = (peer: Peer, direction: 'first' | 'last') => {
  const [block] = editorValueOf(peer)

  return block ? findTextEntryInNode(block, [0], direction) : null
}

const topLevelCount = (peer: Peer) => editorValueOf(peer).length

const paragraphTextsOf = (peer: Peer) =>
  editorValueOf(peer).map((_, index) => Editor.string(peer.editor, [index]))

const assertPeerParagraphTexts = (
  peers: readonly Peer[],
  expected: readonly string[]
) => {
  for (const peer of peers) {
    assert.deepEqual(paragraphTextsOf(peer), expected)
  }
}

const firstBlockIsQuote = (peer: Peer) => {
  const [firstBlock] = editorValueOf(peer)

  return (
    !!firstBlock && 'type' in firstBlock && firstBlock.type === 'block-quote'
  )
}

const hasNestedParagraph = (
  node: Descendant,
  insideParagraph = false
): boolean => {
  if (!hasChildren(node)) {
    return false
  }

  const isParagraph = 'type' in node && node.type === 'paragraph'

  if (insideParagraph && isParagraph) {
    return true
  }

  return node.children.some((child) =>
    hasNestedParagraph(child, insideParagraph || isParagraph)
  )
}

const assertNoNestedParagraphs = (peers: readonly Peer[]) => {
  for (const peer of peers) {
    const value = editorValueOf(peer)

    assert.equal(
      value.some((node) => hasNestedParagraph(node)),
      false,
      JSON.stringify(value)
    )
    assert.equal(
      readSlateValueFromYjs(getYjsState(peer).root()).some((node) =>
        hasNestedParagraph(node)
      ),
      false
    )
  }
}

const hasElementDescendantInsideParagraph = (
  node: Descendant,
  insideParagraph = false
): boolean => {
  if (!hasChildren(node)) {
    return false
  }

  if (insideParagraph) {
    return true
  }

  const isParagraph = 'type' in node && node.type === 'paragraph'

  return node.children.some((child) =>
    hasElementDescendantInsideParagraph(child, isParagraph)
  )
}

const assertNoElementDescendantsInsideParagraphs = (peers: readonly Peer[]) => {
  for (const peer of peers) {
    const value = editorValueOf(peer)
    const yjsValue = readSlateValueFromYjs(getYjsState(peer).root())

    assert.equal(
      value.some((node) => hasElementDescendantInsideParagraph(node)),
      false,
      JSON.stringify(value)
    )
    assert.equal(
      yjsValue.some((node) => hasElementDescendantInsideParagraph(node)),
      false,
      JSON.stringify(yjsValue)
    )
  }
}

const getNodeAtPath = (
  children: readonly Descendant[],
  path: readonly number[]
): Descendant | null => {
  let current: { children: readonly Descendant[] } | Descendant = { children }

  for (const index of path) {
    if (!hasChildren(current)) {
      return null
    }

    const child = current.children[index]

    if (!child) {
      return null
    }

    current = child
  }

  return current as Descendant
}

const assertSelectionsTargetText = (peers: readonly Peer[]) => {
  for (const peer of peers) {
    const selection = peer.editor.read((state) => state.selection.get()) as {
      anchor: { path: number[] }
      focus: { path: number[] }
    } | null

    if (!selection) {
      continue
    }

    const value = editorValueOf(peer)

    for (const point of [selection.anchor, selection.focus]) {
      const node = getNodeAtPath(value, point.path)

      assert.equal(
        !!node && isText(node),
        true,
        JSON.stringify({ selection, value })
      )
    }
  }
}

const sync = (peers: Record<PeerId, Peer>) => {
  const peerList = allPeers(peers)

  syncConnectedPeers(peerList)

  for (const peer of peerList) {
    if (!getYjsState(peer).connected()) {
      continue
    }

    runYjsUpdate(peer, (yjs) => yjs.reconcile())
  }
}

const runCommand = (
  peers: Record<PeerId, Peer>,
  peerId: PeerId,
  command: (peer: Peer, peerId: PeerId) => void
) => {
  command(peers[peerId], peerId)
  sync(peers)
}

const setConnected = (
  peers: Record<PeerId, Peer>,
  peerId: PeerId,
  connected: boolean
) => {
  runYjsUpdate(peers[peerId], (yjs) =>
    connected ? yjs.connect() : yjs.disconnect()
  )
  sync(peers)
}

const appendText = (peer: Peer, peerId: PeerId) => {
  const entry = firstBlockTextEntry(peer, 'last')

  if (!entry) {
    return
  }

  peer.editor.update((tx) => {
    tx.text.insert(appendTexts[peerId], {
      at: { path: entry.path, offset: entry.text.length },
    })
  })
}

const splitFirstText = (peer: Peer) => {
  const entry = firstBlockTextEntry(peer, 'first')

  if (!entry || entry.text.length < 2) {
    return
  }

  const offset = Math.max(1, Math.floor(entry.text.length / 2))

  peer.editor.update((tx) => {
    tx.selection.set({
      anchor: { path: entry.path, offset },
      focus: { path: entry.path, offset },
    })
    tx.break.insert()
  })
}

const ensureTopLevelCount = (peer: Peer, count: number) => {
  const current = topLevelCount(peer)

  if (current >= count) {
    return
  }

  peer.editor.update((tx) => {
    for (let index = current; index < count; index++) {
      tx.nodes.insert(paragraph(`block ${index + 1}`), { at: [index] })
    }
  })
}

const moveFirstBlockDown = (peer: Peer) => {
  ensureTopLevelCount(peer, 2)

  peer.editor.update((tx) => {
    tx.nodes.move({ at: [0], to: [1] })
  })
}

const moveFirstBlockAfterSecond = (peer: Peer) => {
  if (topLevelCount(peer) < 2) {
    return
  }

  peer.editor.update((tx) => {
    tx.nodes.move({ at: [0], to: [1] })
  })
}

const mergeSecondBlock = (peer: Peer) => {
  if (topLevelCount(peer) < 2) {
    return
  }

  peer.editor.update((tx) => {
    tx.nodes.merge({ at: [1] })
  })
}

const removeSecondBlock = (peer: Peer) => {
  if (topLevelCount(peer) < 2) {
    return
  }

  peer.editor.update((tx) => {
    tx.nodes.remove({ at: [1] })
  })
}

const replaceDocument = (peer: Peer, peerId: PeerId) => {
  const children = editorValueOf(peer)
  const text = replacementTexts[peerId]

  peer.editor.update((tx) => {
    tx.operations.replay([
      {
        children,
        index: 0,
        newChildren: [paragraph(text)],
        newSelection: {
          anchor: { path: [0, 0], offset: text.length },
          focus: { path: [0, 0], offset: text.length },
        },
        path: [],
        root: 'main',
        selection: null,
        type: 'replace_children',
      },
    ])
  })
}

const wrapFirstBlock = (peer: Peer) => {
  peer.editor.update((tx) => {
    tx.selection.clear()
    tx.nodes.wrap({ children: [], type: 'block-quote' }, { at: [0] })
    tx.selection.clear()
  })
}

const unwrapFirstBlock = (peer: Peer) => {
  if (!firstBlockIsQuote(peer)) {
    return
  }

  peer.editor.update((tx) => {
    tx.nodes.unwrap({ at: [0] })
  })
}

const liftFirstWrappedBlock = (peer: Peer) => {
  if (!firstBlockIsQuote(peer)) {
    return
  }

  peer.editor.update((tx) => {
    tx.nodes.lift({ at: [0, 0] })
  })
}

const unsetFirstBlockRole = (peer: Peer) => {
  const [firstBlock] = editorValueOf(peer)

  if (!firstBlock || !('role' in firstBlock)) {
    return
  }

  peer.editor.update((tx) => {
    tx.nodes.unset('role' as never, { at: [0] })
  })
}

const insertExclamation = (peer: Peer) => {
  const entry = firstBlockTextEntry(peer, 'last')

  if (!entry) {
    return
  }

  peer.editor.update((tx) => {
    tx.text.insert('!', {
      at: { path: entry.path, offset: entry.text.length },
    })
  })
}

const deleteFirstFragment = (peer: Peer) => {
  const entry = firstBlockTextEntry(peer, 'first')

  if (!entry) {
    return
  }

  const length = Math.min(5, entry.text.length)

  if (length === 0) {
    return
  }

  peer.editor.update((tx) => {
    tx.selection.set({
      anchor: { path: entry.path, offset: 0 },
      focus: { path: entry.path, offset: length },
    })
    tx.fragment.delete()
  })
}

const deleteBackwardFromFirstBlockEnd = (peer: Peer) => {
  const entry = firstBlockTextEntry(peer, 'last')

  if (!entry || entry.text.length === 0) {
    return
  }

  peer.editor.update((tx) => {
    tx.selection.set({
      anchor: { path: entry.path, offset: entry.text.length },
      focus: { path: entry.path, offset: entry.text.length },
    })
    tx.text.deleteBackward({ unit: 'character' })
  })
}

const reconcilePeer = (peer: Peer) => {
  runYjsUpdate(peer, (yjs) => yjs.reconcile())
}

const assertDocumentHasTextBoundary = (peers: readonly Peer[]) => {
  for (const peer of peers) {
    const value = editorValueOf(peer)

    assert.notEqual(
      firstBlockTextEntry(peer, 'first'),
      null,
      JSON.stringify(value)
    )
    assert.notEqual(
      firstBlockTextEntry(peer, 'last'),
      null,
      JSON.stringify(value)
    )
  }
}

describe('@slate/yjs structural soak contract', () => {
  it('keeps random-control seed 10 prefix from nesting paragraphs', () => {
    const peers = createPeers()

    runCommand(peers, 'a', wrapFirstBlock)
    runCommand(peers, 'c', appendText)
    runCommand(peers, 'a', splitFirstText)
    runCommand(peers, 'c', moveFirstBlockDown)
    runCommand(peers, 'c', mergeSecondBlock)

    assertNoNestedParagraphs(allPeers(peers))
  })

  it('keeps offline structural mix seed 3 from producing stale leaf paths', () => {
    const peers = createPeers()

    setConnected(peers, 'a', false)
    runCommand(peers, 'a', unsetFirstBlockRole)
    runCommand(peers, 'd', liftFirstWrappedBlock)
    runCommand(peers, 'a', moveFirstBlockDown)
    runCommand(peers, 'd', wrapFirstBlock)
    runCommand(peers, 'a', moveFirstBlockDown)
    runCommand(peers, 'b', unwrapFirstBlock)

    assertNoNestedParagraphs(allPeers(peers))
    assertPeerParagraphTexts([peers.a], ['Hello world!', 'block 2'])
    assertPeerParagraphTexts([peers.b, peers.c, peers.d], ['Hello world!'])

    setConnected(peers, 'a', true)

    assertPeerParagraphTexts(allPeers(peers), ['Hello world!', 'block 2'])
  })

  it('exports selection after structural unwrap only when the Yjs target is text', () => {
    const peers = createAwarePeers()

    runCommand(peers, 'd', wrapFirstBlock)
    peers.b.editor.update((tx) => {
      tx.selection.set({
        anchor: { path: [0], offset: 0 },
        focus: { path: [0], offset: 0 },
      })
    })

    assert.doesNotThrow(() => {
      runCommand(peers, 'b', unwrapFirstBlock)
    })
  })

  it('keeps random-control seed 42 from missing Yjs path 1.0', () => {
    const peers = createAwarePeers()

    runCommand(peers, 'b', insertExclamation)
    runCommand(peers, 'c', wrapFirstBlock)
    runCommand(peers, 'b', appendText)
    runCommand(peers, 'b', splitFirstText)
    reconcilePeer(peers.d)
    runCommand(peers, 'd', moveFirstBlockAfterSecond)
    runCommand(peers, 'c', removeSecondBlock)
    runCommand(peers, 'c', insertExclamation)
    setConnected(peers, 'a', true)
    setConnected(peers, 'd', false)
    runCommand(peers, 'c', mergeSecondBlock)

    assert.doesNotThrow(() => {
      runCommand(peers, 'c', unwrapFirstBlock)
    })
    assertNoNestedParagraphs(allPeers(peers))
    assertPeerParagraphTexts([peers.a, peers.b, peers.c], ['Hello wo'])
    assertPeerParagraphTexts([peers.d], ['Hello world!! Lin!'])

    setConnected(peers, 'd', true)

    assertPeerParagraphTexts(allPeers(peers), ['Hello wo'])
  })

  it('keeps structural edits from projecting block placeholders inside paragraphs', () => {
    const peers = createAwarePeers()

    runCommand(peers, 'a', splitFirstText)
    runCommand(peers, 'c', deleteFirstFragment)
    runCommand(peers, 'c', (peer) => {
      peer.editor.update((tx) => {
        tx.nodes.set({ role: 'title' } as never, { at: [0] })
      })
    })
    reconcilePeer(peers.d)
    runCommand(peers, 'd', deleteBackwardFromFirstBlockEnd)
    setConnected(peers, 'a', true)
    runCommand(peers, 'c', removeSecondBlock)

    assertNoElementDescendantsInsideParagraphs(allPeers(peers))
    assertSelectionsTargetText(allPeers(peers))
  })

  it('keeps random-control seed 85 from missing Yjs nodes', () => {
    const peers = createAwarePeers()

    runCommand(peers, 'b', reconcilePeer)
    runCommand(peers, 'a', moveFirstBlockDown)
    runCommand(peers, 'a', mergeSecondBlock)
    runCommand(peers, 'd', replaceDocument)
    runCommand(peers, 'c', moveFirstBlockAfterSecond)
    setConnected(peers, 'b', true)
    runCommand(peers, 'c', moveFirstBlockDown)
    runCommand(peers, 'b', splitFirstText)
    runCommand(peers, 'c', unsetFirstBlockRole)

    assert.doesNotThrow(() => {
      runCommand(peers, 'd', appendText)
    })
    assertNoElementDescendantsInsideParagraphs(allPeers(peers))
    assertSelectionsTargetText(allPeers(peers))
  })

  it('keeps offline structural mix seed 108 from nesting paragraphs', () => {
    const peers = createAwarePeers()

    setConnected(peers, 'b', false)
    runCommand(peers, 'b', wrapFirstBlock)
    runCommand(peers, 'd', wrapFirstBlock)
    runCommand(peers, 'b', moveFirstBlockDown)
    runCommand(peers, 'c', deleteBackwardFromFirstBlockEnd)
    runCommand(peers, 'b', unsetFirstBlockRole)
    runCommand(peers, 'c', liftFirstWrappedBlock)
    runCommand(peers, 'b', mergeSecondBlock)
    runCommand(peers, 'd', insertExclamation)

    assertNoElementDescendantsInsideParagraphs(allPeers(peers))
    assertSelectionsTargetText(allPeers(peers))
  })

  it('keeps structural mix seed 42 selections on text leaves', () => {
    const peers = createAwarePeers()

    setConnected(peers, 'b', false)
    runCommand(peers, 'b', wrapFirstBlock)
    runCommand(peers, 'c', splitFirstText)
    runCommand(peers, 'b', moveFirstBlockDown)

    assertNoElementDescendantsInsideParagraphs(allPeers(peers))
    assertSelectionsTargetText(allPeers(peers))
  })

  it('keeps random-control seed 42 disconnected remove selections on text leaves', () => {
    const peers = createAwarePeers()

    runCommand(peers, 'b', insertExclamation)
    runCommand(peers, 'c', wrapFirstBlock)
    runCommand(peers, 'b', appendText)
    runCommand(peers, 'b', splitFirstText)
    reconcilePeer(peers.d)
    runCommand(peers, 'd', moveFirstBlockAfterSecond)
    runCommand(peers, 'c', removeSecondBlock)
    runCommand(peers, 'c', insertExclamation)
    setConnected(peers, 'a', true)
    setConnected(peers, 'd', false)
    runCommand(peers, 'c', mergeSecondBlock)
    runCommand(peers, 'c', unwrapFirstBlock)
    runCommand(peers, 'd', removeSecondBlock)

    assertNoElementDescendantsInsideParagraphs(allPeers(peers))
    assertSelectionsTargetText(allPeers(peers))
  })

  it('keeps structural mix seed 43 selections on text leaves', () => {
    const peers = createAwarePeers()

    setConnected(peers, 'b', false)
    runCommand(peers, 'b', (peer, peerId) => {
      const entry = firstBlockTextEntry(peer, 'last')

      if (!entry) {
        return
      }

      peer.editor.update((tx) => {
        tx.selection.set({
          anchor: { path: entry.path, offset: entry.text.length },
          focus: { path: entry.path, offset: entry.text.length },
        })
        tx.fragment.insert([{ text: `${peerId} fragment` }])
      })
    })
    runCommand(peers, 'a', splitFirstText)
    runCommand(peers, 'b', wrapFirstBlock)
    runCommand(peers, 'd', liftFirstWrappedBlock)
    runCommand(peers, 'b', wrapFirstBlock)
    runCommand(peers, 'c', appendText)
    runCommand(peers, 'b', moveFirstBlockDown)

    assertNoElementDescendantsInsideParagraphs(allPeers(peers))
    assertSelectionsTargetText(allPeers(peers))
  })

  it('keeps structural mix seed 46 selections on text leaves', () => {
    const peers = createAwarePeers()

    setConnected(peers, 'b', false)
    runCommand(peers, 'b', (peer) => {
      peer.editor.update((tx) => {
        tx.nodes.set({ role: 'title' } as never, { at: [0] })
      })
    })
    runCommand(peers, 'a', mergeSecondBlock)
    runCommand(peers, 'b', wrapFirstBlock)
    runCommand(peers, 'a', insertExclamation)
    runCommand(peers, 'b', mergeSecondBlock)

    assertNoElementDescendantsInsideParagraphs(allPeers(peers))
    assertSelectionsTargetText(allPeers(peers))
  })

  it('keeps structural mix seed 49 selections on text leaves', () => {
    const peers = createAwarePeers()

    setConnected(peers, 'b', false)
    runCommand(peers, 'b', mergeSecondBlock)
    runCommand(peers, 'c', moveFirstBlockAfterSecond)
    runCommand(peers, 'b', wrapFirstBlock)
    runCommand(peers, 'a', moveFirstBlockAfterSecond)
    runCommand(peers, 'b', unsetFirstBlockRole)

    assertNoElementDescendantsInsideParagraphs(allPeers(peers))
    assertSelectionsTargetText(allPeers(peers))
  })

  it('keeps structural mix seed 55 selections on text leaves', () => {
    const peers = createAwarePeers()

    setConnected(peers, 'b', false)
    runCommand(peers, 'b', wrapFirstBlock)
    runCommand(peers, 'a', moveFirstBlockAfterSecond)
    runCommand(peers, 'b', wrapFirstBlock)
    runCommand(peers, 'a', insertExclamation)
    runCommand(peers, 'b', mergeSecondBlock)
    runCommand(peers, 'c', mergeSecondBlock)

    assertNoElementDescendantsInsideParagraphs(allPeers(peers))
    assertSelectionsTargetText(allPeers(peers))
  })

  it('elides stale move_node source paths after concurrent structural removal', () => {
    const peer = createPeers().a
    const operation: Operation = {
      newPath: [1],
      path: [1, 0],
      root: 'main',
      type: 'move_node',
    }

    assert.deepEqual(
      applySlateOperationToYjs(getYjsState(peer).root(), operation),
      {
        fallback: 'missing-move-source-elided',
        mode: 'traceable-fallback',
        operationType: 'move_node',
      }
    )
  })

  it('keeps offline structural mix seed 16 from losing root text boundaries', () => {
    const peers = createAwarePeers()

    setConnected(peers, 'a', false)
    runCommand(peers, 'a', mergeSecondBlock)
    runCommand(peers, 'd', splitFirstText)
    runCommand(peers, 'a', wrapFirstBlock)
    runCommand(peers, 'c', splitFirstText)
    runCommand(peers, 'a', deleteFirstFragment)
    runCommand(peers, 'c', moveFirstBlockDown)
    runCommand(peers, 'a', wrapFirstBlock)
    runCommand(peers, 'd', splitFirstText)
    setConnected(peers, 'a', true)

    assertNoNestedParagraphs(allPeers(peers))
    assertDocumentHasTextBoundary(allPeers(peers))
    assertPeerParagraphTexts(allPeers(peers), ['', 'l', 'o ', '', 'world!'])
  })
})
