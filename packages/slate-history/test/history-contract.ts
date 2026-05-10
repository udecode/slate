import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type {
  Descendant,
  Element,
  Selection,
  Editor as SlateEditor,
} from 'slate'
import { createEditor } from 'slate'
import { Editor } from 'slate/internal'

import { History, withHistory } from '../src'

const paragraph = (
  text: string,
  props: Record<string, unknown> = {}
): Descendant => ({
  type: 'paragraph',
  ...props,
  children: [{ text }],
})

const withHistoryTest = () => {
  return withHistory(createEditor())
}

const replace = (
  editor: SlateEditor,
  children: Descendant[],
  selection: Selection = null
) => {
  Editor.replace(editor, {
    children: structuredClone(children),
    selection: structuredClone(selection),
    marks: null,
  })
}

const getVisibleState = (editor: SlateEditor) => {
  const snapshot = Editor.getSnapshot(editor)

  return {
    children: snapshot.children,
    selection: snapshot.selection,
  }
}

const write = (
  editor: SlateEditor,
  fn: Parameters<SlateEditor['update']>[0]
) => {
  editor.update(fn)
}

describe('slate-history contract', () => {
  it('keeps History.isHistory true before edits and across edit, undo, and redo', () => {
    const editor = withHistoryTest()

    replace(editor, [paragraph('Initial text')], {
      anchor: { path: [0, 0], offset: 12 },
      focus: { path: [0, 0], offset: 12 },
    })

    assert.equal(History.isHistory(editor.history), true)

    write(editor, (tx) => {
      tx.text.insert(' additional text')
    })
    assert.equal(History.isHistory(editor.history), true)

    editor.undo()
    assert.equal(History.isHistory(editor.history), true)

    editor.redo()
    assert.equal(History.isHistory(editor.history), true)
  })

  it('undoes a plain insertText commit', () => {
    const editor = withHistoryTest()

    replace(editor, [paragraph('one')], {
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })

    const before = getVisibleState(editor)

    write(editor, (tx) => {
      tx.text.insert('text')
    })
    editor.undo()

    assert.deepEqual(getVisibleState(editor), before)
  })

  it('routes compatibility undo and redo through history commands', () => {
    const editor = withHistoryTest()
    const commands: string[] = []

    replace(editor, [paragraph('one')], {
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })

    const unsubscribeUndo = Editor.registerCommand(
      editor,
      'history_undo',
      (context, next) => {
        commands.push(context.command.type)
        return next()
      }
    )
    const unsubscribeRedo = Editor.registerCommand(
      editor,
      'history_redo',
      (context, next) => {
        commands.push(context.command.type)
        return next()
      }
    )

    write(editor, (tx) => {
      tx.text.insert('!')
    })
    editor.undo()
    editor.redo()
    unsubscribeUndo()
    unsubscribeRedo()

    assert.deepEqual(commands, ['history_undo', 'history_redo'])
    assert.equal(Editor.string(editor, [0]), 'one!')
  })

  it('merges contiguous insertText commits into one undo unit', () => {
    const editor = withHistoryTest()

    replace(editor, [paragraph('one')], {
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })

    const before = getVisibleState(editor)

    write(editor, (tx) => {
      tx.text.insert('t')
    })
    write(editor, (tx) => {
      tx.text.insert('w')
    })
    write(editor, (tx) => {
      tx.text.insert('o')
    })

    assert.equal(editor.history.undos.length, 1)

    editor.undo()

    assert.deepEqual(getVisibleState(editor), before)
  })

  it('uses update metadata to push, merge, and skip history batches', () => {
    const pushEditor = withHistoryTest()

    replace(pushEditor, [paragraph('')], {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })

    pushEditor.update((tx) => {
      tx.text.insert('a')
    })
    pushEditor.update(
      (tx) => {
        tx.text.insert('b')
      },
      { metadata: { history: { mode: 'push' } } }
    )

    assert.equal(pushEditor.history.undos.length, 2)

    const mergeEditor = withHistoryTest()

    replace(mergeEditor, [paragraph('')], {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })

    mergeEditor.update((tx) => {
      tx.text.insert('a')
    })
    mergeEditor.update(
      (tx) => {
        tx.selection.set({
          anchor: { path: [0, 0], offset: 0 },
          focus: { path: [0, 0], offset: 0 },
        })
        tx.text.insert('b')
      },
      { metadata: { history: { mode: 'merge' } } }
    )

    assert.equal(mergeEditor.history.undos.length, 1)

    const skipEditor = withHistoryTest()

    replace(skipEditor, [paragraph('')], {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })

    skipEditor.update(
      (tx) => {
        tx.text.insert('a')
      },
      { metadata: { history: { mode: 'skip' } } }
    )

    assert.equal(skipEditor.history.undos.length, 0)
  })

  it('clears redo history when a new edit follows undo', () => {
    const editor = withHistoryTest()

    replace(editor, [paragraph('one')], {
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })
    const before = getVisibleState(editor)

    write(editor, (tx) => {
      tx.text.insert('a')
    })
    editor.undo()

    assert.equal(editor.history.undos.length, 0)
    assert.equal(editor.history.redos.length, 1)

    write(editor, (tx) => {
      tx.text.insert('b')
    })

    assert.equal(editor.history.undos.length, 1)
    assert.equal(editor.history.redos.length, 0)
    assert.equal(Editor.string(editor, [0]), 'oneb')

    editor.redo()

    assert.equal(Editor.string(editor, [0]), 'oneb')

    editor.undo()

    assert.deepEqual(getVisibleState(editor), before)
  })

  it('undoes and redoes a selected block property change', () => {
    const editor = withHistoryTest()

    replace(editor, [paragraph('AAA'), paragraph('BBB')], {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 3 },
    })
    const before = getVisibleState(editor)

    write(editor, (tx) => {
      tx.nodes.set<Element>({ type: 'quote' }, { at: [0] })
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'quote',
        children: [{ text: 'AAA' }],
      },
      paragraph('BBB'),
    ])

    editor.undo()

    assert.deepEqual(getVisibleState(editor), before)

    editor.redo()

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'quote',
        children: [{ text: 'AAA' }],
      },
      paragraph('BBB'),
    ])
  })

  it('saves node property commits but ignores empty updates', () => {
    const editor = withHistoryTest()

    replace(editor, [paragraph('Initial text')], {
      anchor: { path: [0, 0], offset: 12 },
      focus: { path: [0, 0], offset: 12 },
    })
    const before = getVisibleState(editor)

    editor.update(() => {})

    assert.equal(editor.history.undos.length, 0)

    editor.update((tx) => {
      tx.operations.replay([
        {
          type: 'set_node',
          path: [0],
          properties: {},
          newProperties: { role: 'updated' },
        },
      ])
    })

    assert.equal(editor.history.undos.length, 1)
    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'paragraph',
        role: 'updated',
        children: [{ text: 'Initial text' }],
      },
    ])

    editor.undo()

    assert.deepEqual(getVisibleState(editor), before)
  })

  it('merges contiguous text commits when selection import shares a text commit', () => {
    const editor = withHistoryTest()

    replace(editor, [paragraph('')], null)
    const before = getVisibleState(editor)

    editor.update((tx) => {
      tx.operations.replay([
        {
          offset: 0,
          path: [0, 0],
          text: 'U',
          type: 'insert_text',
        },
      ])
    })
    editor.update((tx) => {
      tx.operations.replay([
        {
          newProperties: {
            anchor: { path: [0, 0], offset: 1 },
            focus: { path: [0, 0], offset: 1 },
          },
          properties: null,
          type: 'set_selection',
        },
        {
          offset: 1,
          path: [0, 0],
          text: 'n',
          type: 'insert_text',
        },
      ])
    })

    assert.equal(editor.history.undos.length, 1)

    editor.undo()

    assert.deepEqual(getVisibleState(editor), before)
  })

  it('undoes a committed composition as one history unit', () => {
    const editor = withHistoryTest()

    replace(editor, [paragraph('This is editable')], {
      anchor: { path: [0, 0], offset: 'This is '.length },
      focus: { path: [0, 0], offset: 'This is '.length },
    })
    const before = getVisibleState(editor)

    write(editor, (tx) => {
      tx.text.insert('す')
    })
    editor.update(
      (tx) => {
        tx.text.insert('し')
      },
      { metadata: { history: { mode: 'merge' } }, tag: 'composition' }
    )

    assert.equal(editor.history.undos.length, 1)
    assert.equal(Editor.string(editor, [0]), 'This is すしeditable')

    editor.undo()

    assert.deepEqual(getVisibleState(editor), before)
  })

  it('does not save canceled composition text to history', () => {
    const editor = withHistoryTest()

    replace(editor, [paragraph('This is editable')], {
      anchor: { path: [0, 0], offset: 'This is '.length },
      focus: { path: [0, 0], offset: 'This is '.length },
    })
    const before = getVisibleState(editor)

    editor.update(
      (tx) => {
        tx.text.insert('す')
        tx.text.delete({ reverse: true })
      },
      { metadata: { history: { mode: 'skip' } }, tag: 'composition-cancel' }
    )

    assert.equal(editor.history.undos.length, 0)
    assert.deepEqual(getVisibleState(editor), before)
  })

  it('does not replay partial set_selection patches during undo after selection is cleared', () => {
    const editor = withHistoryTest()

    replace(editor, [paragraph('')], {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })
    const before = getVisibleState(editor)

    editor.update((tx) => {
      tx.operations.replay([
        {
          offset: 0,
          path: [0, 0],
          text: 'A',
          type: 'insert_text',
        },
        {
          newProperties: {
            focus: { path: [0, 0], offset: 0 },
          },
          properties: {
            anchor: { path: [0, 0], offset: 1 },
            focus: { path: [0, 0], offset: 1 },
          },
          type: 'set_selection',
        },
      ])
    })
    write(editor, (tx) => {
      tx.selection.clear()
    })

    editor.undo()

    assert.deepEqual(getVisibleState(editor), before)
  })

  it('does not merge follow-up typing into a structural text batch', () => {
    const editor = withHistoryTest()

    replace(editor, [paragraph('Alpha')], {
      anchor: { path: [0, 0], offset: 5 },
      focus: { path: [0, 0], offset: 5 },
    })

    write(editor, (tx) => {
      Editor.insertBreak(editor)
      tx.text.insert('Beta')
    })
    const afterStructuralBatch = getVisibleState(editor)

    write(editor, (tx) => {
      tx.text.insert('!')
    })

    assert.equal(editor.history.undos.length, 2)

    editor.undo()

    assert.deepEqual(getVisibleState(editor), afterStructuralBatch)
  })

  it('reselects the restored text after deleteFragment and undo', () => {
    const editor = withHistoryTest()

    replace(editor, [paragraph('abcdef')], {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 4 },
    })

    write(editor, () => {
      Editor.deleteFragment(editor)
    })
    editor.undo()

    assert.deepEqual(Editor.getSnapshot(editor).children, [paragraph('abcdef')])
    assert.deepEqual(Editor.getSnapshot(editor).selection, {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 4 },
    })
  })

  it('restores the saved expanded selection after deleteFragment, blur, refocus, and undo', () => {
    const editor = withHistoryTest()

    replace(editor, [paragraph('Hello')], {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })

    write(editor, (tx) => {
      tx.selection.set({
        anchor: { path: [0, 0], offset: 5 },
        focus: { path: [0, 0], offset: 5 },
      })
    })
    write(editor, (tx) => {
      tx.selection.set({
        anchor: { path: [0, 0], offset: 5 },
        focus: { path: [0, 0], offset: 0 },
      })
    })

    write(editor, () => {
      Editor.deleteFragment(editor)
    })
    write(editor, (tx) => {
      tx.selection.clear()
    })
    write(editor, (tx) => {
      tx.selection.set({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      })
    })

    editor.undo()

    assert.deepEqual(Editor.getSnapshot(editor).children, [paragraph('Hello')])
    assert.deepEqual(Editor.getSnapshot(editor).selection, {
      anchor: { path: [0, 0], offset: 5 },
      focus: { path: [0, 0], offset: 0 },
    })
  })

  it('restores the saved multi-block selection after insertBreak and undo', () => {
    const editor = withHistoryTest()

    replace(editor, [paragraph('one'), paragraph('two'), paragraph('three')], {
      anchor: { path: [0, 0], offset: 2 },
      focus: { path: [2, 0], offset: 3 },
    })

    const before = getVisibleState(editor)

    write(editor, () => {
      Editor.insertBreak(editor)
    })
    editor.undo()

    assert.deepEqual(getVisibleState(editor), before)
  })

  it('restores marks and selection after marked Enter undo', () => {
    const editor = withHistoryTest()

    const children: Descendant[] = [
      {
        type: 'paragraph',
        children: [{ text: 'hey ' }, { bold: true, text: 'you' }],
      },
    ]
    const selection: Selection = {
      anchor: { path: [0, 0], offset: 4 },
      focus: { path: [0, 0], offset: 4 },
    }

    replace(editor, children, selection)

    const before = getVisibleState(editor)

    write(editor, () => {
      Editor.insertBreak(editor)
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'paragraph',
        children: [{ text: 'hey ' }],
      },
      {
        type: 'paragraph',
        children: [{ text: '' }, { bold: true, text: 'you' }],
      },
    ])
    assert.deepEqual(Editor.getSnapshot(editor).selection, {
      anchor: { path: [1, 0], offset: 0 },
      focus: { path: [1, 0], offset: 0 },
    })

    editor.undo()

    assert.deepEqual(getVisibleState(editor), before)
  })

  it('undoes a moveNodes commit back to the original tree and selection', () => {
    const editor = withHistoryTest()

    replace(editor, [paragraph('one'), paragraph('two'), paragraph('three')], {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 1 },
    })

    const before = getVisibleState(editor)

    write(editor, () => {
      Editor.moveNodes(editor, { at: [0], to: [3] })
    })
    editor.undo()

    assert.deepEqual(getVisibleState(editor), before)
  })

  it('undoes reverse block joins cleanly', () => {
    const editor = withHistoryTest()

    replace(editor, [paragraph('Hello'), paragraph('world!')], {
      anchor: { path: [1, 0], offset: 0 },
      focus: { path: [1, 0], offset: 0 },
    })

    const before = getVisibleState(editor)

    write(editor, () => {
      Editor.deleteBackward(editor)
    })
    editor.undo()

    assert.deepEqual(getVisibleState(editor), before)
  })

  it('undoes reverse nested block joins cleanly', () => {
    const editor = withHistoryTest()

    replace(
      editor,
      [
        paragraph('Hello'),
        {
          type: 'paragraph',
          children: [paragraph('world!')],
        } as unknown as Descendant,
      ],
      {
        anchor: { path: [1, 0, 0], offset: 0 },
        focus: { path: [1, 0, 0], offset: 0 },
      }
    )

    const before = getVisibleState(editor)

    write(editor, () => {
      Editor.deleteBackward(editor)
    })
    editor.undo()

    assert.deepEqual(getVisibleState(editor), before)
  })

  it('undoes reverse same-text deletes cleanly', () => {
    const editor = withHistoryTest()

    replace(editor, [paragraph('word')], {
      anchor: { path: [0, 0], offset: 2 },
      focus: { path: [0, 0], offset: 2 },
    })

    const before = getVisibleState(editor)

    write(editor, (tx) => {
      tx.text.delete({ reverse: true })
    })
    editor.undo()

    assert.deepEqual(getVisibleState(editor), before)
  })

  it('undoes same-text deletes without dropping custom props', () => {
    const editor = withHistoryTest()

    replace(
      editor,
      [paragraph('one', { a: true }), paragraph('two', { b: true })],
      {
        anchor: { path: [0, 0], offset: 1 },
        focus: { path: [1, 0], offset: 2 },
      }
    )

    const before = getVisibleState(editor)

    write(editor, (tx) => {
      tx.text.delete()
    })
    editor.undo()

    assert.deepEqual(getVisibleState(editor), before)
  })

  it('undoes insertBreak commits cleanly', () => {
    const editor = withHistoryTest()

    replace(
      editor,
      [
        {
          type: 'paragraph',
          children: [paragraph('one'), paragraph('two')],
        } as unknown as Descendant,
      ],
      {
        anchor: { path: [0, 0, 0], offset: 2 },
        focus: { path: [0, 0, 0], offset: 2 },
      }
    )

    const before = getVisibleState(editor)

    write(editor, () => {
      Editor.insertBreak(editor)
    })
    editor.undo()

    assert.deepEqual(getVisibleState(editor), before)
  })
})
