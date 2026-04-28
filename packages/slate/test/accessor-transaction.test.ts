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

const clone = <T>(value: T): T => structuredClone(value)

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

describe('slate public accessor + transaction seam', () => {
  it('getChildren and replace are the public snapshot state path', () => {
    const editor = createEditor() as ReturnType<typeof createEditor> &
      Record<string, unknown>
    const calls: string[] = []
    const originalGetChildren = editor.getChildren
    const value = [paragraph('one')]

    editor.getChildren = () => {
      calls.push('get')
      return originalGetChildren()
    }

    Editor.replace(editor, { children: value, selection: null, marks: null })
    const currentChildren = editor.getChildren()

    assert.deepEqual(currentChildren, value)
    assert.equal(calls.includes('get'), true)
    assert.equal(Editor.isEditor(editor, { deep: true }), true)
    assert.deepEqual(Editor.getChildren(editor), value)
    assert.equal('children' in editor, false)
  })

  it('does not expose setChildren as an overrideable public state method', () => {
    const editor = createEditor()
    const value = [paragraph('set')]

    assert.equal('setChildren' in editor, false)
    assert.equal('setChildren' in Editor, false)

    Editor.replace(editor, { children: value, selection: null, marks: null })
    assert.deepEqual(Editor.getChildren(editor), value)
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
    batchEditor.select(selection)
    manualEditor.select(selection)

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
          newProperties: { id: 'blue' },
        })

        transaction.apply({
          type: 'set_node',
          path: [0],
          properties: {},
          newProperties: { children: [] },
        })
      })
    }, /set_node does not update child content/)

    assert.deepEqual(getVisibleState(editor), before)
  })
})
