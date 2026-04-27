import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createEditor,
  type Descendant,
  Editor,
  type Editor as EditorType,
} from '../src'

type LegacyOnChangeKey = Extract<keyof EditorType, 'onChange'>

const editorHasNoOnChangeKey: LegacyOnChangeKey extends never ? true : never =
  true

const paragraph = (text: string): Descendant => ({
  type: 'paragraph',
  children: [{ text }],
})

describe('apply/onChange hard cuts', () => {
  void editorHasNoOnChangeKey

  it('does not expose editor.onChange as an instance extension point', () => {
    const editor = createEditor()

    assert.equal('onChange' in editor, false)
    assert.equal((editor as Record<string, unknown>).onChange, undefined)
  })

  it('seals editor.apply against direct method replacement', () => {
    const editor = createEditor()
    const descriptor = Object.getOwnPropertyDescriptor(editor, 'apply')

    assert.equal(descriptor?.writable, false)
    assert.equal(descriptor?.configurable, false)
    assert.throws(() => {
      Object.defineProperty(editor, 'apply', {
        value: () => {},
      })
    }, /Cannot redefine property|readonly property/)
  })

  it('imports operations through applyOperations and publishes one commit', () => {
    const editor = createEditor()
    const commits: NonNullable<ReturnType<typeof Editor.getLastCommit>>[] = []
    const unsubscribe = editor.subscribe((_snapshot, commit) => {
      if (commit) {
        commits.push(commit)
      }
    })

    editor.replace({
      children: [paragraph('one')],
      selection: {
        anchor: { path: [0, 0], offset: 3 },
        focus: { path: [0, 0], offset: 3 },
      },
      marks: null,
    })
    commits.length = 0

    editor.applyOperations(
      [
        {
          type: 'insert_text',
          path: [0, 0],
          offset: 3,
          text: '!',
        },
      ],
      { tag: 'remote-import' }
    )

    unsubscribe()

    assert.equal(Editor.string(editor, []), 'one!')
    assert.equal(commits.length, 1)
    assert.deepEqual(commits[0]?.tags, ['remote-import'])
    assert.deepEqual(
      commits[0]?.operations.map((operation) => operation.type),
      ['insert_text']
    )
  })

  it('uses commit listeners instead of onChange callback timing', () => {
    const editor = createEditor()
    const events: string[] = []

    editor.replace({
      children: [paragraph('one')],
      selection: {
        anchor: { path: [0, 0], offset: 3 },
        focus: { path: [0, 0], offset: 3 },
      },
      marks: null,
    })

    const unsubscribeSubscribe = editor.subscribe((_snapshot, commit) => {
      if (commit) {
        events.push(`subscribe:${commit.operations.length}`)
      }
    })
    const unsubscribeCommit = Editor.registerCommitListener(
      editor,
      (commit) => {
        events.push(`commit:${commit.operations.length}`)
      }
    )

    editor.update(() => {
      editor.insertText('!')
      editor.insertText('?')
    })

    unsubscribeSubscribe()
    unsubscribeCommit()

    assert.deepEqual(events, ['subscribe:2', 'commit:2'])
  })
})
