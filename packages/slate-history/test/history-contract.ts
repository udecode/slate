import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Descendant, Editor as SlateEditor } from 'slate'
import { createEditor, Editor } from 'slate'

import { History, withHistory } from '..'

const paragraph = (
  text: string,
  props: Record<string, unknown> = {}
): Descendant => ({
  type: 'paragraph',
  ...props,
  children: [{ text }],
})

const withHistoryTest = () => {
  const editor = withHistory(createEditor())
  const { isInline, isVoid, isElementReadOnly, isSelectable } = editor

  editor.isInline = (element: any) =>
    element.inline === true ? true : isInline(element)
  editor.isVoid = (element: any) =>
    element.void === true ? true : isVoid(element)
  editor.isElementReadOnly = (element: any) =>
    element.readOnly === true ? true : isElementReadOnly(element)
  editor.isSelectable = (element: any) =>
    element.nonSelectable === true ? false : isSelectable(element)

  return editor
}

const replace = (
  editor: SlateEditor,
  children: Descendant[],
  selection: SlateEditor['selection'] = null
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

const write = (editor: SlateEditor, fn: () => void) => {
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

    write(editor, () => {
      editor.insertText(' additional text')
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

    write(editor, () => {
      editor.insertText('text')
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

    write(editor, () => {
      editor.insertText('!')
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

    write(editor, () => {
      editor.insertText('t')
    })
    write(editor, () => {
      editor.insertText('w')
    })
    write(editor, () => {
      editor.insertText('o')
    })

    assert.equal(editor.history.undos.length, 1)

    editor.undo()

    assert.deepEqual(getVisibleState(editor), before)
  })

  it('merges contiguous text commits when selection import shares a text commit', () => {
    const editor = withHistoryTest()

    replace(editor, [paragraph('')], null)
    const before = getVisibleState(editor)

    editor.applyOperations([
      {
        offset: 0,
        path: [0, 0],
        text: 'U',
        type: 'insert_text',
      },
    ])
    editor.applyOperations([
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

    assert.equal(editor.history.undos.length, 1)

    editor.undo()

    assert.deepEqual(getVisibleState(editor), before)
  })

  it('restores the saved expanded selection after deleteFragment, blur, refocus, and undo', () => {
    const editor = withHistoryTest()

    replace(editor, [paragraph('Hello')], {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })

    write(editor, () => {
      editor.select({
        anchor: { path: [0, 0], offset: 5 },
        focus: { path: [0, 0], offset: 5 },
      })
    })
    write(editor, () => {
      editor.select({
        anchor: { path: [0, 0], offset: 5 },
        focus: { path: [0, 0], offset: 0 },
      })
    })

    write(editor, () => {
      Editor.deleteFragment(editor)
    })
    write(editor, () => {
      editor.deselect()
    })
    write(editor, () => {
      editor.select({
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

  it('undoes reverse block joins cleanly', () => {
    const editor = withHistoryTest()

    replace(editor, [paragraph('Hello'), paragraph('world!')], {
      anchor: { path: [1, 0], offset: 0 },
      focus: { path: [1, 0], offset: 0 },
    })

    const before = getVisibleState(editor)

    write(editor, () => {
      editor.deleteBackward()
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
      editor.deleteBackward()
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

    write(editor, () => {
      editor.delete({ reverse: true })
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

    write(editor, () => {
      editor.delete()
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
      editor.insertBreak()
    })
    editor.undo()

    assert.deepEqual(getVisibleState(editor), before)
  })
})
