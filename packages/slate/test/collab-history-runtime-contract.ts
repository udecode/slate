import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { withHistory } from 'slate-history'

import { createEditor, type Descendant, Editor } from '../src'

const paragraph = (text: string): Descendant => ({
  type: 'paragraph',
  children: [{ text }],
})

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
      () => {
        editor.insertText('a')
        editor.insertText('b')
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
})
