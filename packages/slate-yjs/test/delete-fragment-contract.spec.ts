import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createEditor, type Descendant, type Operation } from 'slate'
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

const collectDeleteFragmentOperations = (
  selection: NonNullable<ReturnType<typeof Editor.getSnapshot>['selection']>
) => {
  const editor = createEditor()
  const operations: Operation[] = []

  Editor.replace(editor, {
    children: initialValue(),
    marks: null,
    selection: null,
  })

  editor.extend({
    name: 'delete-fragment-operation-capture',
    onCommit({ commit }) {
      operations.push(...commit.operations)
    },
  })

  editor.update((tx) => {
    tx.selection.set(selection)
  })

  operations.length = 0

  editor.update((tx) => {
    tx.fragment.delete()
  })

  return operations.map((operation) => operation.type)
}

const selectAndDeleteFragment = (
  peer: ReturnType<typeof createPeer>,
  selection: NonNullable<ReturnType<typeof Editor.getSnapshot>['selection']>
) => {
  peer.editor.update((tx) => {
    tx.selection.set(selection)
  })

  peer.editor.update((tx) => {
    tx.fragment.delete()
  })
}

const deleteBetaMiddle = (peer: ReturnType<typeof createPeer>) => {
  selectAndDeleteFragment(peer, {
    anchor: { path: [1, 0], offset: 1 },
    focus: { path: [1, 0], offset: 3 },
  })
}

const deleteFromAlphaIntoGamma = (peer: ReturnType<typeof createPeer>) => {
  selectAndDeleteFragment(peer, {
    anchor: { path: [0, 0], offset: 2 },
    focus: { path: [2, 0], offset: 2 },
  })
}

const appendRemoteGamma = (peer: ReturnType<typeof createPeer>) => {
  peer.editor.update((tx) => {
    tx.text.insert('!', { at: { path: [2, 0], offset: 'gamma'.length } })
  })
}

describe('@slate/yjs delete_fragment collaboration contract', () => {
  it('characterizes public deleteFragment inside one text as remove_text', () => {
    assert.deepEqual(
      collectDeleteFragmentOperations({
        anchor: { path: [1, 0], offset: 1 },
        focus: { path: [1, 0], offset: 3 },
      }),
      ['remove_text', 'set_selection']
    )
  })

  it('characterizes public deleteFragment across blocks as text removals, node removal, and merges', () => {
    assert.deepEqual(
      collectDeleteFragmentOperations({
        anchor: { path: [0, 0], offset: 2 },
        focus: { path: [2, 0], offset: 2 },
      }),
      [
        'remove_text',
        'remove_node',
        'remove_text',
        'merge_node',
        'merge_node',
        'set_selection',
      ]
    )
  })

  it('applies local offline deleteFragment without replacing the edited Yjs text node', () => {
    const peer = createPeer('b')
    const text = getVisibleYjsNodeAt(peer, [1, 0])

    runYjsUpdate(peer, (yjs) => yjs.disconnect())
    runYjsUpdate(peer, (yjs) => yjs.clearTrace())
    deleteBetaMiddle(peer)

    assert.deepEqual(getParagraphTexts(peer), ['alpha', 'ba', 'gamma'])
    assert.equal(getVisibleYjsNodeAt(peer, [1, 0]), text)
    assert.deepEqual(getYjsState(peer).trace(), [
      { mode: 'operation', operationType: 'remove_text' },
    ])
    assertNoRootSnapshot(peer)
  })

  it('preserves concurrent remote text inside the end block when an offline deleteFragment reconnects', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    deleteFromAlphaIntoGamma(b)
    appendRemoteGamma(a)
    syncConnectedPeers(peers)

    assert.deepEqual(getParagraphTexts(a), ['alpha', 'beta', 'gamma!'])
    assert.deepEqual(getParagraphTexts(b), ['almma'])

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)

    assertPeerTexts(peers, ['almma!'])
    assertNoRootSnapshot(b)
  })

  it('undoes and redoes only the local cross-block deleteFragment intent after reconnect', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a, b] = peers

    runYjsUpdate(b, (yjs) => yjs.disconnect())
    deleteFromAlphaIntoGamma(b)
    appendRemoteGamma(a)
    syncConnectedPeers(peers)

    runYjsUpdate(b, (yjs) => yjs.connect())
    syncConnectedPeers(peers)
    assertPeerTexts(peers, ['almma!'])

    runYjsUpdate(b, (yjs) => yjs.undo())
    syncConnectedPeers(peers)
    assertPeerTexts(peers, ['alpha', 'beta', 'gamma!'])

    runYjsUpdate(b, (yjs) => yjs.redo())
    syncConnectedPeers(peers)
    assertPeerTexts(peers, ['almma!'])
    assertNoRootSnapshot(b)
  })
})
