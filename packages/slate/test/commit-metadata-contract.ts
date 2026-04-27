import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createEditor, type Descendant, Editor } from '../src'

const paragraph = (text: string): Descendant => ({
  type: 'paragraph',
  children: [{ text }],
})

describe('commit metadata contract', () => {
  it('captures update tags and selection before/after on text commits', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [paragraph('one')],
      selection: {
        anchor: { path: [0, 0], offset: 3 },
        focus: { path: [0, 0], offset: 3 },
      },
    })

    editor.update(
      () => {
        editor.insertText('!')
      },
      { tag: ['history-push', 'paste'] }
    )

    const commit = Editor.getLastCommit(editor)

    assert(commit)
    assert.deepEqual(commit.classes, ['text'])
    assert.deepEqual(commit.tags, ['history-push', 'paste'])
    assert.deepEqual(commit.selectionBefore, {
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })
    assert.deepEqual(commit.selectionAfter, {
      anchor: { path: [0, 0], offset: 4 },
      focus: { path: [0, 0], offset: 4 },
    })
    assert.equal(commit.selectionChanged, true)
    assert.equal(commit.textChanged, true)
    assert.equal(commit.snapshotChanged, true)
  })

  it('groups multiple primitive writes inside one update into one commit', () => {
    const editor = createEditor()
    const commits: NonNullable<ReturnType<typeof Editor.getLastCommit>>[] = []

    Editor.replace(editor, {
      children: [paragraph('one')],
      selection: {
        anchor: { path: [0, 0], offset: 3 },
        focus: { path: [0, 0], offset: 3 },
      },
    })

    const unsubscribe = Editor.subscribe(editor, (_snapshot, commit) => {
      if (commit) {
        commits.push(commit)
      }
    })

    editor.update(() => {
      editor.insertText('!')
      editor.insertText('?')
    })

    unsubscribe()

    const commit = Editor.getLastCommit(editor)

    assert(commit)
    assert.equal(commits.length, 1)
    assert.equal(commits[0], commit)
    assert.deepEqual(
      commit.operations.map((operation) => operation.type),
      ['insert_text', 'insert_text']
    )
    assert.deepEqual(commit.classes, ['text'])
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
    assert.deepEqual(commit.dirty.paths, [[], [0], [0, 0]])
    assert.deepEqual(commit.dirty.topLevelRange, [0, 0])
    assert.deepEqual(commit.dirty.runtimeIds, commit.touchedRuntimeIds)
  })
})
