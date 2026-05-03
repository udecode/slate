import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Editor } from 'slate/internal'

import { withHistory } from 'slate-history'

import { createEditor, type Descendant, type Operation } from '../src'

const paragraph = (text: string): Descendant => ({
  type: 'paragraph',
  children: [{ text }],
})

const createCollabEditor = () => {
  const editor = createEditor()

  Editor.replace(editor, {
    children: [paragraph('one'), paragraph('two'), paragraph('three')],
    selection: {
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    },
    marks: null,
  })

  return editor
}

describe('collab and history runtime contract', () => {
  it('publishes one commit truth for collab subscribers, extension listeners, and history', () => {
    const editor = withHistory(createEditor())

    Editor.replace(editor, {
      children: [paragraph('one')],
      selection: {
        anchor: { path: [0, 0], offset: 3 },
        focus: { path: [0, 0], offset: 3 },
      },
      marks: null,
    })

    const runtimeId = Editor.getRuntimeId(editor, [0, 0])
    const subscribedCommits: NonNullable<
      ReturnType<typeof Editor.getLastCommit>
    >[] = []
    const extensionCommits: NonNullable<
      ReturnType<typeof Editor.getLastCommit>
    >[] = []

    const unsubscribeSubscribe = Editor.subscribe(
      editor,
      (_snapshot, commit) => {
        if (commit) {
          subscribedCommits.push(commit)
        }
      }
    )
    const unsubscribeCommit = Editor.registerCommitListener(
      editor,
      (commit) => {
        extensionCommits.push(commit)
      }
    )

    editor.update(
      (tx) => {
        tx.text.insert('a')
        tx.text.insert('b')
      },
      { tag: 'collab-local' }
    )

    unsubscribeSubscribe()
    unsubscribeCommit()

    assert.equal(subscribedCommits.length, 1)
    assert.equal(extensionCommits.length, 1)

    const commit = subscribedCommits[0]!

    assert.equal(extensionCommits[0], commit)
    assert.equal(Editor.getLastCommit(editor), commit)
    assert.deepEqual(commit.classes, ['text'])
    assert.deepEqual(
      commit.operations.map((operation) => operation.type),
      ['insert_text', 'insert_text']
    )
    assert.deepEqual(commit.tags, ['collab-local'])
    assert.deepEqual(commit.selectionBefore, {
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })
    assert.deepEqual(commit.selectionAfter, {
      anchor: { path: [0, 0], offset: 5 },
      focus: { path: [0, 0], offset: 5 },
    })
    assert.equal(commit.selectionChanged, true)
    assert.equal(commit.textChanged, true)
    assert.equal(commit.snapshotChanged, true)
    assert.deepEqual(commit.dirty.paths, [[], [0], [0, 0]])
    assert.deepEqual(commit.dirty.runtimeIds, [runtimeId])
    assert.deepEqual(commit.dirty.topLevelRange, [0, 0])
    assert.equal(commit.dirty.wholeDocument, false)
    assert.equal(Object.isFrozen(commit.operations), true)

    assert.equal(editor.history.undos.length, 1)
    assert.deepEqual(editor.history.undos[0]?.operations, commit.operations)
    assert.deepEqual(
      editor.history.undos[0]?.selectionBefore,
      commit.selectionBefore
    )
  })

  it('replays local operations remotely with deterministic snapshot and metadata', () => {
    const source = createCollabEditor()
    const remote = createCollabEditor()
    const remoteCommits: NonNullable<
      ReturnType<typeof Editor.getLastCommit>
    >[] = []
    const unsubscribe = Editor.subscribe(remote, (_snapshot, commit) => {
      if (commit) {
        remoteCommits.push(commit)
      }
    })

    source.update(
      (tx) => {
        tx.text.insert('!')
      },
      { tag: 'local-edit' }
    )

    const sourceCommit = Editor.getLastCommit(source)

    assert(sourceCommit)

    remote.update((tx) => {
      tx.operations.replay(sourceCommit.operations, { tag: 'remote-import' })
    })
    unsubscribe()

    assert.deepEqual(
      Editor.getSnapshot(remote).children,
      Editor.getSnapshot(source).children
    )
    assert.equal(remoteCommits.length, 1)
    assert.deepEqual(remoteCommits[0]?.tags, ['remote-import'])
    assert.deepEqual(
      remoteCommits[0]?.operations.map((operation) => operation.type),
      sourceCommit.operations.map((operation) => operation.type)
    )
    assert.equal(remoteCommits[0]?.snapshotChanged, true)
  })

  it('uses typed remote collaboration metadata to skip local undo history', () => {
    const source = createCollabEditor()
    const remote = withHistory(createCollabEditor())

    source.update(
      (tx) => {
        tx.text.insert('!')
      },
      { tag: 'local-edit' }
    )

    const sourceCommit = Editor.getLastCommit(source)

    assert(sourceCommit)

    remote.update(
      (tx) => {
        tx.operations.replay(sourceCommit.operations)
      },
      {
        metadata: {
          collab: { origin: 'remote', saveToHistory: false },
          history: { mode: 'skip' },
          selection: { dom: 'preserve' },
        },
        tag: ['collaboration', 'remote-import'],
      }
    )

    const remoteCommit = Editor.getLastCommit(remote)

    assert(remoteCommit)
    assert.deepEqual(remoteCommit.tags, ['collaboration', 'remote-import'])
    assert.deepEqual(remoteCommit.metadata.collab, {
      origin: 'remote',
      saveToHistory: false,
    })
    assert.deepEqual(remoteCommit.metadata.history, { mode: 'skip' })
    assert.equal(remote.history.undos.length, 0)
    assert.deepEqual(
      Editor.getSnapshot(remote).children,
      Editor.getSnapshot(source).children
    )
  })

  it('replays remote operations without losing local bookmark ranges', () => {
    const remote = createCollabEditor()
    const bookmark = Editor.bookmark(remote, {
      anchor: { path: [1, 0], offset: 1 },
      focus: { path: [1, 0], offset: 3 },
    })

    remote.update((tx) => {
      tx.operations.replay(
        [
          {
            type: 'insert_text',
            path: [1, 0],
            offset: 0,
            text: '!',
          },
        ],
        { tag: 'remote-import' }
      )
    })

    const commit = Editor.getLastCommit(remote)

    assert(commit)
    assert.deepEqual(commit.tags, ['remote-import'])
    assert.deepEqual(bookmark.resolve(), {
      anchor: { path: [1, 0], offset: 2 },
      focus: { path: [1, 0], offset: 4 },
    })
    assert.equal(Editor.string(remote, bookmark.resolve()!), 'wo')

    bookmark.unref()
  })

  it('keeps runtime targets local while remote remove and move operations rebase or null them', () => {
    const removeEditor = createCollabEditor()
    const removedBlockId = Editor.getRuntimeId(removeEditor, [1])
    const removedTextId = Editor.getRuntimeId(removeEditor, [1, 0])
    const removedNode = Editor.getSnapshot(removeEditor).children[1]!

    assert(removedBlockId)
    assert(removedTextId)

    const removeOperation: Operation = {
      type: 'remove_node',
      path: [1],
      node: removedNode,
    }

    assert.equal(
      JSON.stringify(removeOperation).includes(removedBlockId),
      false
    )

    removeEditor.update((tx) => {
      tx.operations.replay([removeOperation], { tag: 'remote-remove' })
    })

    const removeCommit = Editor.getLastCommit(removeEditor)

    assert(removeCommit)
    assert.deepEqual(removeCommit.tags, ['remote-remove'])
    assert.equal(Editor.getPathByRuntimeId(removeEditor, removedBlockId), null)
    assert.equal(Editor.getPathByRuntimeId(removeEditor, removedTextId), null)

    const moveEditor = createCollabEditor()
    const movedBlockId = Editor.getRuntimeId(moveEditor, [2])
    const movedTextId = Editor.getRuntimeId(moveEditor, [2, 0])
    const moveOperation: Operation = {
      type: 'move_node',
      path: [2],
      newPath: [0],
    }

    assert(movedBlockId)
    assert(movedTextId)
    assert.equal(JSON.stringify(moveOperation).includes(movedBlockId), false)

    moveEditor.update((tx) => {
      tx.operations.replay([moveOperation], { tag: 'remote-move' })
    })

    const moveCommit = Editor.getLastCommit(moveEditor)

    assert(moveCommit)
    assert.deepEqual(moveCommit.tags, ['remote-move'])
    assert.deepEqual(Editor.getPathByRuntimeId(moveEditor, movedBlockId), [0])
    assert.deepEqual(Editor.getPathByRuntimeId(moveEditor, movedTextId), [0, 0])
    assert.equal(Editor.string(moveEditor, [0]), 'three')
  })
})
