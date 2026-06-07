import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { type Descendant } from 'slate'
import { Editor } from 'slate/internal'

import { readSlateValueFromYjs } from '../src/core/document'
import {
  assertNoRootSnapshot,
  createSeededYjsPeers,
  createYjsPeer,
  getParagraphTexts,
  getYjsState,
  type Peer,
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

const paragraphParts = (...texts: string[]): Descendant => ({
  type: 'paragraph',
  children: texts.map((text) => ({ text })),
})

const quote = (children: Descendant[]): Descendant => ({
  type: 'quote',
  children,
})

const initialValue = () => [paragraph('Hello world!')]

const createPeer = (
  clientId: keyof typeof clientIds,
  children = initialValue()
) =>
  createYjsPeer({
    children,
    clientId,
    numericClientId: clientIds[clientId],
  })

const createPeers = (ids: Array<keyof typeof clientIds>) =>
  createSeededYjsPeers({
    children: initialValue(),
    clientIds: ids,
    numericClientIds: clientIds,
  })

const splitThenDeleteBackwardEmptyParagraph = (peer: Peer) => {
  const textLength = Editor.string(peer.editor, [0]).length

  peer.editor.update((tx) => {
    tx.selection.set({
      anchor: { path: [0, 0], offset: textLength },
      focus: { path: [0, 0], offset: textLength },
    })
  })

  peer.editor.update((tx) => {
    tx.break.insert()
  })

  peer.editor.update((tx) => {
    tx.selection.set({
      anchor: { path: [1, 0], offset: 0 },
      focus: { path: [1, 0], offset: 0 },
    })
  })

  peer.editor.update((tx) => {
    tx.text.deleteBackward({ unit: 'character' })
  })
}

const repeatSplitMerge = (peer: Peer, times: number) => {
  for (let index = 0; index < times; index++) {
    splitThenDeleteBackwardEmptyParagraph(peer)
  }
}

const assertNoLeakedVirtualPlaceholder = (nodes: readonly Descendant[]) => {
  for (const node of nodes) {
    if (!('children' in node)) {
      continue
    }

    assert.notEqual(node.type, 'slate-yjs-virtual-placeholder')
    assertNoLeakedVirtualPlaceholder(node.children)
  }
}

const assertNoNestedElements = (nodes: readonly Descendant[]) => {
  for (const node of nodes) {
    if (!('children' in node)) {
      continue
    }

    assert.equal(
      node.children.some((child) => 'children' in child),
      false
    )
  }
}

describe('@slate/yjs split and merge collaboration contract', () => {
  it('keeps repeated paragraph split and merge from leaking virtual placeholders', () => {
    const peers = createPeers(['a', 'b', 'c'])
    const [a] = peers

    repeatSplitMerge(a, 2)
    syncConnectedPeers(peers)

    for (const peer of peers) {
      const snapshotChildren = Editor.getSnapshot(peer.editor).children

      assert.deepEqual(getParagraphTexts(peer), ['Hello world!'])
      assertNoLeakedVirtualPlaceholder(snapshotChildren)
      assertNoNestedElements(snapshotChildren)
      assert.deepEqual(readSlateValueFromYjs(getYjsState(peer).root()), [
        paragraph('Hello world!'),
      ])
    }
    assertNoRootSnapshot(a)
  })

  it('keeps repeated local paragraph split and merge traceable', () => {
    const peer = createPeer('b')

    runYjsUpdate(peer, (yjs) => yjs.clearTrace())
    repeatSplitMerge(peer, 2)

    const snapshotChildren = Editor.getSnapshot(peer.editor).children

    assert.deepEqual(getParagraphTexts(peer), ['Hello world!'])
    assertNoLeakedVirtualPlaceholder(snapshotChildren)
    assertNoNestedElements(snapshotChildren)
    assert.deepEqual(readSlateValueFromYjs(getYjsState(peer).root()), [
      paragraph('Hello world!'),
    ])
    assertNoRootSnapshot(peer)
  })

  it('keeps nested virtual placeholder content when splitting a parent element', () => {
    const peer = createPeer('b', [
      quote([paragraph('intro'), paragraph('alpha'), paragraph('beta')]),
    ])

    peer.editor.update((tx) => {
      tx.nodes.merge({ at: [0, 2] })
    })

    assert.deepEqual(readSlateValueFromYjs(getYjsState(peer).root()), [
      quote([paragraph('intro'), paragraphParts('alpha', 'beta')]),
    ])

    peer.editor.update((tx) => {
      tx.operations.replay([
        {
          path: [0],
          position: 1,
          properties: { type: 'quote' },
          type: 'split_node',
        },
      ])
    })

    assert.deepEqual(readSlateValueFromYjs(getYjsState(peer).root()), [
      quote([paragraph('intro')]),
      quote([paragraphParts('alpha', 'beta')]),
    ])
    assertNoRootSnapshot(peer)
  })

  it('keeps parent-level virtual move content when merging the adopted target element', () => {
    const peer = createPeer('b', [
      quote([paragraph('left')]),
      quote([]),
      paragraph('moved'),
    ])

    peer.editor.update((tx) => {
      tx.operations.replay([
        {
          newPath: [1, 0],
          path: [2],
          type: 'move_node',
        },
      ])
    })

    assert.deepEqual(readSlateValueFromYjs(getYjsState(peer).root()), [
      quote([paragraph('left')]),
      quote([paragraph('moved')]),
    ])

    peer.editor.update((tx) => {
      tx.nodes.merge({ at: [1] })
    })

    assert.deepEqual(readSlateValueFromYjs(getYjsState(peer).root()), [
      quote([paragraph('left'), paragraph('moved')]),
    ])
    assertNoRootSnapshot(peer)
  })
})
