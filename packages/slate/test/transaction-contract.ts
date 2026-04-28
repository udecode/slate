import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createEditor, type Descendant, Editor, type Operation } from '../src'

const paragraph = (
  text: string,
  props: Record<string, unknown> = {}
): Descendant => ({
  type: 'paragraph',
  ...props,
  children: [{ text }],
})

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const replaceChildren = (
  editor: ReturnType<typeof createEditor>,
  children: Descendant[]
) => {
  Editor.replace(editor, {
    children: clone(children),
    selection: null,
    marks: null,
  })
}

const selectEditor = (
  editor: ReturnType<typeof createEditor>,
  selection: NonNullable<ReturnType<typeof Editor.getSelection>>
) => {
  editor.update(() => {
    editor.select(selection)
  })
}

const runManualTransaction = (
  editor: ReturnType<typeof createEditor>,
  operations: Operation[]
) => {
  Editor.withTransaction(editor, (tx) => {
    for (const operation of clone(operations)) {
      tx.apply(operation)
    }
  })
}

const getVisibleState = (editor: ReturnType<typeof createEditor>) => {
  const snapshot = Editor.getSnapshot(editor)

  return {
    children: snapshot.children,
    marks: snapshot.marks,
    selection: snapshot.selection,
    pathToId: snapshot.index.pathToId,
  }
}

describe('slate transaction contract', () => {
  it('applyBatch matches manual withTransaction for duplicate exact-path set_node writes', () => {
    const children = [paragraph('one'), paragraph('two'), paragraph('three')]
    const batchEditor = createEditor()
    const manualEditor = createEditor()
    const operations: Operation[] = [
      {
        type: 'set_node',
        path: [0],
        properties: {},
        newProperties: { id: 'blue' },
      },
      {
        type: 'set_node',
        path: [0],
        properties: {},
        newProperties: { id: 'final', role: 'final' },
      },
    ]

    replaceChildren(batchEditor, children)
    replaceChildren(manualEditor, children)

    batchEditor.applyOperations(clone(operations))
    runManualTransaction(manualEditor, operations)

    assert.deepEqual(
      getVisibleState(batchEditor),
      getVisibleState(manualEditor)
    )
    assert.deepEqual(Editor.getSnapshot(batchEditor).children, [
      {
        type: 'paragraph',
        id: 'final',
        role: 'final',
        children: [{ text: 'one' }],
      },
      paragraph('two'),
      paragraph('three'),
    ])
  })

  it('applyBatch matches manual withTransaction for mixed text, selection, and node ops', () => {
    const children = [paragraph('abcd')]
    const selection = {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    }
    const batchEditor = createEditor()
    const manualEditor = createEditor()
    const operations: Operation[] = [
      {
        type: 'insert_text',
        path: [0, 0],
        offset: 1,
        text: 'X',
      },
      {
        type: 'set_selection',
        properties: {
          anchor: { path: [0, 0], offset: 0 },
          focus: { path: [0, 0], offset: 0 },
        },
        newProperties: {
          anchor: { path: [0, 0], offset: 2 },
          focus: { path: [0, 0], offset: 2 },
        },
      },
      {
        type: 'set_node',
        path: [0],
        properties: {},
        newProperties: { id: 'p0' },
      },
    ]

    replaceChildren(batchEditor, children)
    replaceChildren(manualEditor, children)
    selectEditor(batchEditor, selection)
    selectEditor(manualEditor, selection)

    batchEditor.applyOperations(clone(operations))
    runManualTransaction(manualEditor, operations)

    assert.deepEqual(
      getVisibleState(batchEditor),
      getVisibleState(manualEditor)
    )
    assert.deepEqual(Editor.getSnapshot(batchEditor).children, [
      {
        type: 'paragraph',
        id: 'p0',
        children: [{ text: 'aXbcd' }],
      },
    ])
    assert.deepEqual(Editor.getSnapshot(batchEditor).selection, {
      anchor: { path: [0, 0], offset: 2 },
      focus: { path: [0, 0], offset: 2 },
    })
  })

  it('applyBatch matches manual withTransaction for structural insert, move, and set batches', () => {
    const children = [paragraph('zero'), paragraph('one')]
    const batchEditor = createEditor()
    const manualEditor = createEditor()
    const operations: Operation[] = [
      {
        type: 'insert_node',
        path: [2],
        node: paragraph('two'),
      },
      {
        type: 'move_node',
        path: [2],
        newPath: [0],
      },
      {
        type: 'set_node',
        path: [1],
        properties: {},
        newProperties: { id: 'shifted' },
      },
    ]

    replaceChildren(batchEditor, children)
    replaceChildren(manualEditor, children)

    batchEditor.applyOperations(clone(operations))
    runManualTransaction(manualEditor, operations)

    assert.deepEqual(
      getVisibleState(batchEditor),
      getVisibleState(manualEditor)
    )
    assert.deepEqual(Editor.getSnapshot(batchEditor).children, [
      paragraph('two'),
      {
        type: 'paragraph',
        id: 'shifted',
        children: [{ text: 'zero' }],
      },
      paragraph('one'),
    ])
  })

  it('withTransaction keeps direct replacement draft-visible and publishes once on exit', () => {
    const editor = createEditor()
    const publishedStates: ReturnType<typeof getVisibleState>[] = []

    replaceChildren(editor, [paragraph('one'), paragraph('two')])

    const unsubscribe = Editor.subscribe(editor, () => {
      publishedStates.push(getVisibleState(editor))
    })

    publishedStates.length = 0

    Editor.withTransaction(editor, (transaction) => {
      Editor.replace(editor, {
        children: [paragraph('replacement')],
        selection: null,
        marks: null,
      })

      assert.equal(publishedStates.length, 0)
      assert.equal(Editor.string(editor, [0]), 'replacement')

      transaction.apply({
        type: 'set_node',
        path: [0],
        properties: {},
        newProperties: { id: 'p0' },
      })

      assert.equal(publishedStates.length, 0)
      assert.deepEqual(Editor.getChildren(editor), [
        {
          type: 'paragraph',
          id: 'p0',
          children: [{ text: 'replacement' }],
        },
      ])
    })

    unsubscribe()

    assert.equal(publishedStates.length, 1)
    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'paragraph',
        id: 'p0',
        children: [{ text: 'replacement' }],
      },
    ])
  })

  it('withTransaction exposes live draft state through the transaction argument', () => {
    const editor = createEditor()

    replaceChildren(editor, [paragraph('one'), paragraph('two')])

    Editor.withTransaction(editor, (transaction) => {
      assert.deepEqual(transaction.children, [
        paragraph('one'),
        paragraph('two'),
      ])
      assert.equal(transaction.selection, null)
      assert.deepEqual(transaction.operations, [])

      transaction.apply({
        type: 'insert_text',
        path: [0, 0],
        offset: 3,
        text: '!',
      })

      assert.equal(transaction.children[0]?.children[0]?.text, 'one!')
      assert.equal(transaction.operations.length, 1)

      editor.select({
        anchor: { path: [0, 0], offset: 4 },
        focus: { path: [0, 0], offset: 4 },
      })

      assert.deepEqual(transaction.selection, {
        anchor: { path: [0, 0], offset: 4 },
        focus: { path: [0, 0], offset: 4 },
      })
    })

    assert.equal(
      Editor.getSnapshot(editor).children[0].children[0].text,
      'one!'
    )
  })

  it('withTransaction exposes tx.apply as the transaction-owned write seam', () => {
    const editor = createEditor()

    replaceChildren(editor, [paragraph('one')])

    Editor.withTransaction(editor, (transaction) => {
      transaction.apply({
        type: 'insert_text',
        path: [0, 0],
        offset: 3,
        text: '!',
      })

      assert.equal(transaction.children[0]?.children[0]?.text, 'one!')
      assert.equal(transaction.operations.length, 1)
    })

    assert.equal(
      Editor.getSnapshot(editor).children[0].children[0].text,
      'one!'
    )
  })

  it('publishes explicit last commit metadata without requiring snapshot subscribers', () => {
    const editor = createEditor()

    assert.equal(Editor.getLastCommit(editor), null)

    replaceChildren(editor, [paragraph('one')])

    const replaceCommit = Editor.getLastCommit(editor)

    assert(replaceCommit)
    assert.deepEqual(replaceCommit.classes, ['replace'])
    assert.equal(replaceCommit.version, 1)
    assert.equal(replaceCommit.dirty.wholeDocument, true)
    assert.equal(replaceCommit.dirty.topLevelRange, null)

    editor.update(() => {
      editor.insertText('!', {
        at: { path: [0, 0], offset: 3 },
      })
    })

    const commit = Editor.getLastCommit(editor)

    assert(commit)
    assert.equal(commit.previousVersion, 1)
    assert.equal(commit.version, 2)
    assert.deepEqual(commit.classes, ['text'])
    assert.equal(commit.textChanged, true)
    assert.equal(commit.selectionChanged, false)
    assert.equal(commit.structureChanged, false)
    assert.equal(commit.snapshotChanged, true)
    assert.deepEqual(commit.dirty.paths, [[], [0], [0, 0]])
    assert.deepEqual(commit.dirty.topLevelRange, [0, 0])
    assert.deepEqual(commit.dirty.runtimeIds, commit.touchedRuntimeIds)
    assert.equal(commit.dirty.wholeDocument, false)
    assert.equal(commit.operations.length, 1)
    assert.equal(commit.operations[0]?.type, 'insert_text')
  })

  it('passes explicit commit metadata through subscribers', () => {
    const editor = createEditor()
    const commits: NonNullable<ReturnType<typeof Editor.getLastCommit>>[] = []

    replaceChildren(editor, [paragraph('one')])

    const unsubscribe = Editor.subscribe(editor, (_snapshot, commit) => {
      if (commit) {
        commits.push(commit)
      }
    })

    editor.update(() => {
      editor.insertText('!', {
        at: { path: [0, 0], offset: 3 },
      })
    })

    unsubscribe()

    assert.equal(commits.length, 1)
    assert.deepEqual(commits[0]?.classes, ['text'])
    assert.equal(commits[0], Editor.getLastCommit(editor))
    assert.deepEqual(commits[0]?.dirty.topLevelRange, [0, 0])
  })

  it('tx.apply routes through operation middleware and the core transaction seam', () => {
    const editor = createEditor()

    replaceChildren(editor, [paragraph('one')])

    const seenOperations: Operation[] = []
    const unextend = editor.extend({
      name: 'operation-spy',
      operationMiddlewares: [
        ({ operation }, next) => {
          seenOperations.push(operation)
          next(operation)
        },
      ],
    })

    Editor.withTransaction(editor, (transaction) => {
      transaction.apply({
        type: 'insert_text',
        path: [0, 0],
        offset: 3,
        text: '!',
      })
    })

    assert.equal(seenOperations.length, 1)
    assert.equal(
      Editor.getSnapshot(editor).children[0].children[0].text,
      'one!'
    )

    editor.applyOperations([
      {
        type: 'insert_text',
        path: [0, 0],
        offset: 4,
        text: '?',
      },
    ])

    unextend()

    assert.equal(seenOperations.length, 2)
    assert.equal(
      Editor.getSnapshot(editor).children[0].children[0].text,
      'one!?'
    )
  })

  it('transaction.apply reuses the transaction writer and publishes once', () => {
    const editor = createEditor()
    const publishedStates: ReturnType<typeof getVisibleState>[] = []

    replaceChildren(editor, [paragraph('one')])

    const unsubscribe = Editor.subscribe(editor, () => {
      publishedStates.push(getVisibleState(editor))
    })

    publishedStates.length = 0

    Editor.withTransaction(editor, (transaction) => {
      transaction.apply({
        type: 'insert_text',
        path: [0, 0],
        offset: 3,
        text: '!',
      })

      assert.equal(publishedStates.length, 0)
      assert.equal(transaction.children[0]?.children[0]?.text, 'one!')
      assert.equal(transaction.operations.length, 1)
    })

    unsubscribe()

    assert.equal(publishedStates.length, 1)
    assert.equal(
      Editor.getSnapshot(editor).children[0].children[0].text,
      'one!'
    )
  })

  it('withTransaction exposes tx.setMarks as the transaction-owned marks seam', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [paragraph('one')],
      selection: {
        anchor: { path: [0, 0], offset: 1 },
        focus: { path: [0, 0], offset: 1 },
      },
      marks: null,
    })

    Editor.withTransaction(editor, (transaction) => {
      transaction.setMarks({ bold: true })

      assert.deepEqual(transaction.marks, { bold: true })
      assert.deepEqual(Editor.marks(editor), { bold: true })
    })

    assert.deepEqual(Editor.getSnapshot(editor).marks, { bold: true })
  })

  it('withTransaction exposes tx.setSelection as the transaction-owned selection seam', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [paragraph('one')],
      selection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      },
      marks: null,
    })

    Editor.withTransaction(editor, (transaction) => {
      transaction.setSelection({
        anchor: { path: [0, 0], offset: 3 },
        focus: { path: [0, 0], offset: 3 },
      })

      assert.deepEqual(transaction.selection, {
        anchor: { path: [0, 0], offset: 3 },
        focus: { path: [0, 0], offset: 3 },
      })
    })

    assert.deepEqual(Editor.getSnapshot(editor).selection, {
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })
  })

  it('withTransaction rolls back staged changes when a later operation throws', () => {
    const editor = createEditor()

    replaceChildren(editor, [paragraph('one'), paragraph('two')])

    const before = getVisibleState(editor)

    assert.throws(() => {
      Editor.withTransaction(editor, (transaction) => {
        transaction.apply({
          type: 'set_node',
          path: [0],
          properties: {},
          newProperties: { id: 'temp' },
        })

        transaction.apply({
          type: 'set_node',
          path: [99],
          properties: {},
          newProperties: { boom: true },
        })
      })
    })

    assert.deepEqual(getVisibleState(editor), before)
  })

  it('routes insertText through command middleware and preserves commit metadata', () => {
    const editor = createEditor()
    const seenCommands: unknown[] = []

    replaceChildren(editor, [paragraph('one')])
    editor.update(() => {
      editor.select({
        anchor: { path: [0, 0], offset: 3 },
        focus: { path: [0, 0], offset: 3 },
      })
    })

    const unsubscribe = Editor.registerCommand(
      editor,
      'insert_text',
      (context, next) => {
        seenCommands.push(context.command)
        return next({
          ...context.command,
          text: '!',
        })
      }
    )

    editor.update(() => {
      Editor.insertText(editor, '?')
    })
    unsubscribe()

    const commit = Editor.getLastCommit(editor)

    assert.equal(seenCommands.length, 1)
    assert.deepEqual(seenCommands[0], {
      options: {},
      text: '?',
      type: 'insert_text',
    })
    assert.equal(Editor.string(editor, [0]), 'one!')
    assert(commit)
    assert.deepEqual(commit.command, {
      origin: 'command',
      type: 'insert_text',
    })
    assert.deepEqual(commit.classes, ['text'])
    assert.deepEqual(commit.operations, [
      {
        offset: 3,
        path: [0, 0],
        text: '!',
        type: 'insert_text',
      },
    ])
    assert.deepEqual(commit.dirty.paths, [[], [0], [0, 0]])
    assert.deepEqual(commit.dirty.runtimeIds, commit.touchedRuntimeIds)
    assert.deepEqual(commit.selectionBefore, {
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })
    assert.deepEqual(
      commit.selectionAfter,
      Editor.getSnapshot(editor).selection
    )
  })

  it('preserves command metadata when a command runs inside an open update', () => {
    const editor = createEditor()

    replaceChildren(editor, [paragraph('one')])
    editor.update(() => {
      editor.select({
        anchor: { path: [0, 0], offset: 3 },
        focus: { path: [0, 0], offset: 3 },
      })
    })

    editor.update(() => {
      Editor.insertText(editor, '!')
    })

    const commit = Editor.getLastCommit(editor)

    assert(commit)
    assert.deepEqual(commit.command, {
      origin: 'command',
      type: 'insert_text',
    })
    assert.deepEqual(commit.classes, ['text'])
    assert.deepEqual(commit.operations, [
      {
        offset: 3,
        path: [0, 0],
        text: '!',
        type: 'insert_text',
      },
    ])
  })

  it('routes insertBreak through command middleware and preserves structural commit metadata', () => {
    const editor = createEditor()
    const seenCommands: unknown[] = []

    replaceChildren(editor, [paragraph('one')])
    editor.update(() => {
      editor.select({
        anchor: { path: [0, 0], offset: 1 },
        focus: { path: [0, 0], offset: 1 },
      })
    })

    const unsubscribe = Editor.registerCommand(
      editor,
      'insert_break',
      (context, next) => {
        seenCommands.push(context.command)
        return next()
      }
    )

    editor.update(() => {
      Editor.insertBreak(editor)
    })
    unsubscribe()

    const commit = Editor.getLastCommit(editor)

    assert.deepEqual(seenCommands, [{ type: 'insert_break' }])
    assert.deepEqual(Editor.getSnapshot(editor).children, [
      paragraph('o'),
      paragraph('ne'),
    ])
    assert(commit)
    assert.deepEqual(commit.command, {
      origin: 'command',
      type: 'insert_break',
    })
    assert.deepEqual(commit.classes, ['structural'])
    assert.deepEqual(
      commit.operations.map((operation) => operation.type),
      ['split_node', 'split_node']
    )
    assert.equal(commit.structureChanged, true)
    assert.equal(commit.selectionChanged, true)
    assert.deepEqual(commit.selectionBefore, {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 1 },
    })
    assert.deepEqual(commit.selectionAfter, {
      anchor: { path: [1, 0], offset: 0 },
      focus: { path: [1, 0], offset: 0 },
    })
  })

  it('routes delete commands through command middleware and preserves history-shaped commits', () => {
    const backwardEditor = createEditor()
    const fragmentEditor = createEditor()
    const seenCommands: unknown[] = []

    replaceChildren(backwardEditor, [paragraph('one')])
    selectEditor(backwardEditor, {
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })

    const unsubscribeDelete = Editor.registerCommand(
      backwardEditor,
      'delete',
      (context, next) => {
        seenCommands.push(context.command)
        return next()
      }
    )

    backwardEditor.update(() => {
      Editor.deleteBackward(backwardEditor)
    })
    unsubscribeDelete()

    const backwardCommit = Editor.getLastCommit(backwardEditor)

    assert.deepEqual(seenCommands, [
      {
        direction: 'backward',
        unit: 'character',
        type: 'delete',
      },
    ])
    assert.equal(Editor.string(backwardEditor, [0]), 'on')
    assert(backwardCommit)
    assert.deepEqual(backwardCommit.classes, ['text'])
    assert.deepEqual(backwardCommit.operations[0], {
      offset: 2,
      path: [0, 0],
      text: 'e',
      type: 'remove_text',
    })
    assert.deepEqual(
      backwardCommit.operations.map((operation) => operation.type),
      ['remove_text', 'set_selection']
    )

    replaceChildren(fragmentEditor, [paragraph('hello')])
    selectEditor(fragmentEditor, {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 4 },
    })

    const unsubscribeFragment = Editor.registerCommand(
      fragmentEditor,
      'delete_fragment',
      (context, next) => {
        seenCommands.push(context.command)
        return next()
      }
    )

    fragmentEditor.update(() => {
      Editor.deleteFragment(fragmentEditor, { direction: 'backward' })
    })
    unsubscribeFragment()

    const fragmentCommit = Editor.getLastCommit(fragmentEditor)

    assert.deepEqual(seenCommands[1], {
      direction: 'backward',
      type: 'delete_fragment',
    })
    assert.equal(Editor.string(fragmentEditor, [0]), 'ho')
    assert(fragmentCommit)
    assert.deepEqual(fragmentCommit.classes, ['text'])
    assert.deepEqual(
      fragmentCommit.operations.map((operation) => operation.type),
      ['remove_text', 'set_selection']
    )
  })

  it('routes selection through command middleware and preserves selection-only commit metadata', () => {
    const editor = createEditor()
    const seenCommands: unknown[] = []

    replaceChildren(editor, [paragraph('one')])

    const unsubscribe = Editor.registerCommand(
      editor,
      'set_selection',
      (context, next) => {
        seenCommands.push(context.command)
        return next({
          ...context.command,
          newProperties: {
            anchor: { path: [0, 0], offset: 2 },
            focus: { path: [0, 0], offset: 2 },
          },
        })
      }
    )

    selectEditor(editor, {
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })
    unsubscribe()

    const commit = Editor.getLastCommit(editor)

    assert.deepEqual(seenCommands, [
      {
        newProperties: {
          anchor: { path: [0, 0], offset: 3 },
          focus: { path: [0, 0], offset: 3 },
        },
        properties: null,
        type: 'set_selection',
      },
    ])
    assert.deepEqual(Editor.getSnapshot(editor).selection, {
      anchor: { path: [0, 0], offset: 2 },
      focus: { path: [0, 0], offset: 2 },
    })
    assert(commit)
    assert.deepEqual(commit.command, {
      origin: 'command',
      type: 'set_selection',
    })
    assert.deepEqual(commit.classes, ['selection'])
    assert.equal(commit.childrenChanged, false)
    assert.equal(commit.selectionChanged, true)
    assert.deepEqual(commit.operations, [
      {
        newProperties: {
          anchor: { path: [0, 0], offset: 2 },
          focus: { path: [0, 0], offset: 2 },
        },
        properties: null,
        type: 'set_selection',
      },
    ])
    assert.deepEqual(commit.dirty.paths, [])
    assert.deepEqual(commit.touchedRuntimeIds, [])
  })

  it('routes movement through command middleware and preserves selection-only commit metadata', () => {
    const editor = createEditor()
    const seenCommands: unknown[] = []

    replaceChildren(editor, [paragraph('one')])
    selectEditor(editor, {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })

    const unsubscribe = Editor.registerCommand(
      editor,
      'move_selection',
      (context, next) => {
        seenCommands.push(context.command)
        return next({
          ...context.command,
          options: {
            distance: 2,
          },
        })
      }
    )

    editor.update(() => {
      editor.move()
    })
    unsubscribe()

    const commit = Editor.getLastCommit(editor)

    assert.deepEqual(seenCommands, [
      {
        options: {},
        type: 'move_selection',
      },
    ])
    assert.deepEqual(Editor.getSnapshot(editor).selection, {
      anchor: { path: [0, 0], offset: 2 },
      focus: { path: [0, 0], offset: 2 },
    })
    assert(commit)
    assert.deepEqual(commit.command, {
      origin: 'command',
      type: 'move_selection',
    })
    assert.deepEqual(commit.classes, ['selection'])
    assert.deepEqual(
      commit.operations.map((operation) => operation.type),
      ['set_selection']
    )
    assert.deepEqual(commit.dirty.paths, [])
    assert.deepEqual(commit.touchedRuntimeIds, [])
  })

  it('routes mark commands through command middleware and preserves mark commit metadata', () => {
    const editor = createEditor()
    const seenCommands: unknown[] = []

    replaceChildren(editor, [paragraph('one')])
    selectEditor(editor, {
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })

    const unsubscribeAdd = Editor.registerCommand(
      editor,
      'add_mark',
      (context, next) => {
        seenCommands.push(context.command)
        return next({
          ...context.command,
          key: 'italic',
        })
      }
    )

    editor.update(() => {
      Editor.addMark(editor, 'bold', true)
    })
    unsubscribeAdd()

    const addCommit = Editor.getLastCommit(editor)

    assert.deepEqual(seenCommands[0], {
      key: 'bold',
      type: 'add_mark',
      value: true,
    })
    assert.deepEqual(Editor.marks(editor), { italic: true })
    assert(addCommit)
    assert.deepEqual(addCommit.classes, ['mark'])
    assert.deepEqual(addCommit.marksBefore, null)
    assert.deepEqual(addCommit.marksAfter, { italic: true })
    assert.deepEqual(addCommit.operations, [])

    const unsubscribeRemove = Editor.registerCommand(
      editor,
      'remove_mark',
      (context, next) => {
        seenCommands.push(context.command)
        return next({
          ...context.command,
          key: 'italic',
        })
      }
    )

    editor.update(() => {
      Editor.removeMark(editor, 'bold')
    })
    unsubscribeRemove()

    const removeCommit = Editor.getLastCommit(editor)

    assert.deepEqual(seenCommands[1], {
      key: 'bold',
      type: 'remove_mark',
    })
    assert.deepEqual(Editor.marks(editor), {})
    assert(removeCommit)
    assert.deepEqual(removeCommit.classes, ['mark'])
    assert.deepEqual(removeCommit.marksBefore, { italic: true })
    assert.deepEqual(removeCommit.marksAfter, {})
    assert.deepEqual(removeCommit.operations, [])
  })

  it('stores command handlers in the extension registry command slot', () => {
    const editor = createEditor()
    const registry = Editor.getExtensionRegistry(editor)
    const seenCommands: unknown[] = []

    replaceChildren(editor, [paragraph('one')])
    selectEditor(editor, {
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })

    const unsubscribe = Editor.registerCommand(
      editor,
      'insert_text',
      (context, next) => {
        seenCommands.push(context.command)
        return next()
      }
    )

    assert.equal(Editor.getExtensionRegistry(editor), registry)
    assert.equal(registry.commands.get('insert_text')?.length, 1)

    editor.update(() => {
      Editor.insertText(editor, '!')
    })
    unsubscribe()

    assert.deepEqual(seenCommands, [
      {
        options: {},
        text: '!',
        type: 'insert_text',
      },
    ])
    assert.equal(registry.commands.get('insert_text')?.length, 0)
  })

  it('exposes stable extension registry slots beyond commands', () => {
    const editor = createEditor()
    const registry = Editor.getExtensionRegistry(editor)
    const capability = { type: 'link' }
    const normalizer = () => {}
    const commitListener = () => {}

    const unregisterCapability = Editor.registerCapability(
      editor,
      'inline',
      capability
    )
    const unregisterNormalizer = Editor.registerNormalizer(
      editor,
      'paragraph-normalizer',
      normalizer
    )
    const unregisterCommitListener = Editor.registerCommitListener(
      editor,
      commitListener
    )

    assert.equal(Editor.getExtensionRegistry(editor), registry)
    assert.deepEqual(registry.capabilities.get('inline'), [capability])
    assert.equal(registry.normalizers.get('paragraph-normalizer'), normalizer)
    assert.equal(registry.commitListeners.has(commitListener), true)

    unregisterCapability()
    unregisterNormalizer()
    unregisterCommitListener()

    assert.equal(registry.capabilities.has('inline'), false)
    assert.equal(registry.normalizers.has('paragraph-normalizer'), false)
    assert.equal(registry.commitListeners.has(commitListener), false)
  })

  it('routes insertFragment through command middleware and preserves commit metadata', () => {
    const editor = createEditor()
    const seenCommands: unknown[] = []

    replaceChildren(editor, [paragraph('one')])
    selectEditor(editor, {
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })

    const unsubscribe = Editor.registerCommand(
      editor,
      'insert_fragment',
      (context, next) => {
        seenCommands.push(context.command)
        return next({
          ...context.command,
          fragment: [{ text: '!' }],
        })
      }
    )

    editor.update(() => {
      editor.insertFragment([{ text: '?' }])
    })
    unsubscribe()

    const commit = Editor.getLastCommit(editor)

    assert.deepEqual(seenCommands, [
      {
        fragment: [{ text: '?' }],
        options: {},
        type: 'insert_fragment',
      },
    ])
    assert.equal(Editor.string(editor, [0]), 'one!')
    assert(commit)
    assert.deepEqual(commit.classes, ['structural'])
    assert.deepEqual(
      commit.operations.map((operation) => operation.type),
      ['insert_node', 'set_selection', 'merge_node']
    )
    assert.equal(commit.structureChanged, true)
    assert.equal(commit.selectionChanged, true)
  })

  it('delivers command-backed commits to extension commit listeners and preserves subscribe behavior', () => {
    const editor = createEditor()
    const extensionCommits: NonNullable<
      ReturnType<typeof Editor.getLastCommit>
    >[] = []
    const subscribedCommits: NonNullable<
      ReturnType<typeof Editor.getLastCommit>
    >[] = []

    replaceChildren(editor, [paragraph('one')])
    selectEditor(editor, {
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })

    const unsubscribeCommitListener = Editor.registerCommitListener(
      editor,
      (commit) => {
        extensionCommits.push(commit)
      }
    )
    const unsubscribeSubscriber = Editor.subscribe(
      editor,
      (_snapshot, commit) => {
        if (commit) {
          subscribedCommits.push(commit)
        }
      }
    )

    editor.update(() => {
      Editor.insertText(editor, '!')
    })
    unsubscribeCommitListener()
    unsubscribeSubscriber()
    editor.update(() => {
      Editor.insertText(editor, '?')
    })

    assert.equal(extensionCommits.length, 1)
    assert.equal(subscribedCommits.length, 1)
    assert.equal(extensionCommits[0], subscribedCommits[0])
    assert.deepEqual(extensionCommits[0]?.command, {
      origin: 'command',
      type: 'insert_text',
    })
    assert.equal(Editor.string(editor, [0]), 'one!?')
  })
})
