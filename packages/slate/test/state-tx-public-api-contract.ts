import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createEditor, type Descendant } from '../src'
import { Editor } from '../src/interfaces/editor'

const paragraph = (text: string, props: Record<string, unknown> = {}) =>
  ({
    type: 'paragraph',
    ...props,
    children: [{ text }],
  }) as Descendant

describe('state/tx public API contract', () => {
  const createSeededEditor = () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [paragraph('one'), paragraph('two')],
      selection: {
        anchor: { path: [0, 0], offset: 3 },
        focus: { path: [0, 0], offset: 3 },
      },
      marks: null,
    })

    return editor
  }

  it('passes grouped read state into editor.read', () => {
    const editor = createSeededEditor()

    const state = editor.read((state) => ({
      isVoid: state.schema.isVoid({
        type: 'image',
        children: [{ text: '' }],
      }),
      selection: state.selection.get(),
      text: state.text.string([]),
      value: state.value.get(),
    }))

    assert.equal(state.isVoid, false)
    assert.equal(state.text, 'onetwo')
    assert.deepEqual(state.selection, {
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })
    assert.deepEqual(state.value, [paragraph('one'), paragraph('two')])
  })

  it('reads fragments through grouped read state', () => {
    const editor = createSeededEditor()

    Editor.replace(editor, {
      children: [paragraph('one'), paragraph('two')],
      selection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 3 },
      },
      marks: null,
    })

    const fragments = editor.read((state) => ({
      explicit: state.fragment.get({
        at: {
          anchor: { path: [1, 0], offset: 0 },
          focus: { path: [1, 0], offset: 3 },
        },
      }),
      selected: state.fragment.get(),
    }))

    assert.deepEqual(fragments.selected, [paragraph('one')])
    assert.deepEqual(fragments.explicit, [paragraph('two')])
    assert.deepEqual(Editor.getSelection(editor), {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 3 },
    })
  })

  it('exposes complete read-only state groups for document, runtime, and commit metadata', () => {
    const editor = createSeededEditor()
    const firstTextRuntimeId = editor.read((state) =>
      state.runtime.idAt([0, 0])
    )

    assert.equal(typeof firstTextRuntimeId, 'string')

    const state = editor.read((state) => ({
      lastCommit: state.value.lastCommit(),
      operations: state.value.operations(),
      path: state.runtime.pathOf(firstTextRuntimeId!),
      snapshot: state.runtime.snapshot(),
      valueHasSnapshot: 'snapshot' in state.value,
    }))

    assert.equal(state.valueHasSnapshot, false)
    assert.deepEqual(state.snapshot.children, [
      paragraph('one'),
      paragraph('two'),
    ])
    assert.deepEqual(state.snapshot.selection, {
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })
    assert.deepEqual(state.operations, [])
    assert.equal(state.lastCommit?.classes.includes('replace'), true)
    assert.equal(state.lastCommit?.operations.length, 0)
    assert.deepEqual(state.path, [0, 0])
  })

  it('exposes complete query groups through state instead of direct editor aliases', () => {
    const editor = createSeededEditor()

    const state = editor.read((state) => ({
      after: state.points.after({ path: [0, 0], offset: 3 }),
      before: state.points.before({ path: [1, 0], offset: 0 }),
      edge: state.points.isEdge({ path: [0, 0], offset: 0 }, [0]),
      first: state.nodes.first([]),
      hasBlocks: state.nodes.hasBlocks({ children: [paragraph('nested')] }),
      hasPath: state.nodes.hasPath([1, 0]),
      isBlock: state.schema.isBlock(paragraph('one')),
      isEmpty: state.nodes.isEmpty({ children: [{ text: '' }] }),
      last: state.nodes.last([]),
      levels: Array.from(state.nodes.levels({ at: [0, 0] })),
      projected: state.ranges.project({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 3 },
      }),
      range: state.ranges.get([0]),
      unhang: state.ranges.unhang({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 3 },
      }),
      voidNode: state.nodes.void({ at: [] }),
    }))

    assert.deepEqual(state.after, { path: [1, 0], offset: 0 })
    assert.deepEqual(state.before, { path: [0, 0], offset: 3 })
    assert.equal(state.edge, true)
    assert.deepEqual(state.first?.[1], [0, 0])
    assert.equal(state.hasBlocks, true)
    assert.equal(state.hasPath, true)
    assert.equal(state.isBlock, true)
    assert.equal(state.isEmpty, true)
    assert.deepEqual(state.last?.[1], [1, 0])
    assert.ok(state.levels.length > 0)
    assert.ok(state.projected.length > 0)
    assert.deepEqual(state.range, {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 3 },
    })
    assert.deepEqual(state.unhang, {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 3 },
    })
    assert.equal(state.voidNode, undefined)
  })

  it('passes grouped tx writes into editor.update and reads the live draft', () => {
    const editor = createSeededEditor()
    let draftText = ''
    let draftSelection = null as ReturnType<typeof Editor.getSelection>

    editor.update((tx) => {
      tx.text.insert('!')
      tx.nodes.set({ role: 'edited' }, { at: [0] })
      tx.selection.set({
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 3 },
      })

      draftText = tx.text.string([])
      draftSelection = tx.selection.get()
    })

    assert.equal(draftText, 'one!two')
    assert.deepEqual(draftSelection, {
      anchor: { path: [1, 0], offset: 0 },
      focus: { path: [1, 0], offset: 3 },
    })
    assert.equal(Editor.string(editor, []), 'one!two')
    assert.deepEqual(Editor.getSnapshot(editor).children, [
      paragraph('one!', { role: 'edited' }),
      paragraph('two'),
    ])
  })

  it('reads fragments through the update transaction draft', () => {
    const editor = createSeededEditor()
    let before = [] as Descendant[]
    let after = [] as Descendant[]

    Editor.replace(editor, {
      children: [paragraph('one'), paragraph('two')],
      selection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 3 },
      },
      marks: null,
    })

    editor.update((tx) => {
      before = tx.fragment.get()
      tx.fragment.insert([paragraph('z')])
      after = tx.fragment.get({
        at: {
          anchor: { path: [0, 0], offset: 0 },
          focus: { path: [0, 0], offset: 1 },
        },
      })
    })

    assert.deepEqual(before, [paragraph('one')])
    assert.deepEqual(after, [paragraph('z')])
    assert.deepEqual(Editor.getSnapshot(editor).children, [
      paragraph('z'),
      paragraph('two'),
    ])
  })

  it('groups break and directed text deletes under tx namespaces', () => {
    const editor = createSeededEditor()
    let hasRootBreak = true

    editor.update((tx) => {
      hasRootBreak = 'insertBreak' in tx || 'insertSoftBreak' in tx
      tx.text.deleteBackward({ unit: 'character' })
      tx.break.insert()
      tx.text.insert('z')
    })

    assert.equal(hasRootBreak, false)
    assert.equal(Editor.string(editor, []), 'onztwo')
    assert.deepEqual(Editor.getSelection(editor), {
      anchor: { path: [1, 0], offset: 1 },
      focus: { path: [1, 0], offset: 1 },
    })
  })

  it('replaces the whole document through the update transaction', () => {
    const editor = createSeededEditor()
    let txValueHasSnapshot = true

    editor.update((tx) => {
      txValueHasSnapshot = 'snapshot' in tx.value
      tx.value.replace({
        children: [paragraph('replacement')],
        marks: { bold: true },
        selection: {
          anchor: { path: [0, 0], offset: 11 },
          focus: { path: [0, 0], offset: 11 },
        },
      })
    })

    assert.equal(txValueHasSnapshot, false)
    const snapshot = Editor.getSnapshot(editor)

    assert.deepEqual(snapshot.children, [paragraph('replacement')])
    assert.deepEqual(snapshot.marks, { bold: true })
    assert.deepEqual(snapshot.selection, {
      anchor: { path: [0, 0], offset: 11 },
      focus: { path: [0, 0], offset: 11 },
    })
  })

  it('routes tx writes through the internal transform registry', () => {
    const editor = createSeededEditor()
    let primitiveCalls = 0
    const staleInsertTextKey = `insert${'Text'}`

    ;(editor as unknown as Record<string, unknown>)[staleInsertTextKey] =
      () => {
        primitiveCalls += 1
        throw new Error('primitive instance writer should not back tx writes')
      }

    editor.update((tx) => {
      tx.text.insert('!')
    })

    assert.equal(primitiveCalls, 0)
    assert.equal(Editor.string(editor, []), 'one!two')
  })

  it('keeps tx reads coherent after mark writes in the same update', () => {
    const editor = createSeededEditor()
    let marks = null as unknown

    editor.update((tx) => {
      tx.marks.add('bold', true)
      marks = tx.marks.get()
      tx.marks.remove('bold')
    })

    assert.deepEqual(marks, { bold: true })
  })

  it('replays operation batches through the update transaction', () => {
    const editor = createSeededEditor()

    editor.update((tx) => {
      tx.operations.replay([
        {
          offset: 3,
          path: [0, 0],
          text: '!',
          type: 'insert_text',
        },
      ])
    })

    assert.equal(Editor.string(editor, []), 'one!two')
    assert.equal(Editor.getLastCommit(editor)?.operations.length, 1)
  })
})
