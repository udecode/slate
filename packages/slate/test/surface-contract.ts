import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type {
  EditorAfterOptions,
  EditorBeforeOptions,
  EditorDirectedDeletionOptions,
  EditorElementReadOnlyOptions,
  EditorFragmentDeletionOptions,
  EditorInterface,
  EditorLeafOptions,
  EditorLevelsOptions,
  EditorNextOptions,
  EditorNodeOptions,
  EditorNodesOptions,
  EditorParentOptions,
  EditorPathOptions,
  EditorPathRefOptions,
  EditorPointOptions,
  EditorPointRefOptions,
  EditorPositionsOptions,
  EditorPreviousOptions,
  EditorRangeRefOptions,
  EditorStringOptions,
  EditorUnhangRangeOptions,
  EditorVoidOptions,
  PropsCompare,
  PropsMerge,
} from '../src'
import * as Slate from '../src'
import {
  createEditor,
  Editor,
  Element,
  Location,
  Operation,
  Path,
  Range,
  Scrubber,
  Span,
  Text,
} from '../src'
import { getEditorLiveSelection, getEditorLiveText } from '../src/internal'

describe('slate surface contract', () => {
  it('keeps raw state setters out of the root package surface', () => {
    const slateSurface = Slate as Record<string, unknown>

    assert.equal('setChildren' in slateSurface, false)
    assert.equal('setCurrentSelection' in slateSurface, false)
    assert.equal('setCurrentMarks' in slateSurface, false)
    assert.equal('setOperations' in slateSurface, false)
    assert.equal('setTargetRuntime' in slateSurface, false)
    assert.equal('getLiveNode' in slateSurface, false)
    assert.equal('getLiveSelection' in slateSurface, false)
    assert.equal('getLiveText' in slateSurface, false)
  })

  it('keeps editor helper type names on the current surface without transform namespaces', () => {
    const editor = createEditor()

    const editorInterface: EditorInterface = Editor
    const beforeOptions: EditorBeforeOptions = { unit: 'word', voids: true }
    const afterOptions: EditorAfterOptions = { distance: 1, unit: 'line' }
    const directedDeletionOptions: EditorDirectedDeletionOptions = {
      unit: 'character',
    }
    const fragmentDeletionOptions: EditorFragmentDeletionOptions = {
      direction: 'backward',
    }
    const elementReadOnlyOptions: EditorElementReadOnlyOptions = { at: [] }
    const leafOptions: EditorLeafOptions = { edge: 'start' }
    const levelsOptions: EditorLevelsOptions = { at: [], voids: true }
    const nextOptions: EditorNextOptions = { at: [], voids: true }
    const nodeOptions: EditorNodeOptions = { depth: 1, edge: 'end' }
    const nodesOptions: EditorNodesOptions = { at: [], mode: 'lowest' }
    const parentOptions: EditorParentOptions = { depth: 1 }
    const pathOptions: EditorPathOptions = { depth: 1 }
    const pathRefOptions: EditorPathRefOptions = { affinity: 'backward' }
    const pointOptions: EditorPointOptions = { edge: 'end' }
    const pointRefOptions: EditorPointRefOptions = { affinity: 'forward' }
    const positionsOptions: EditorPositionsOptions = { at: [], unit: 'word' }
    const previousOptions: EditorPreviousOptions = { at: [], voids: true }
    const rangeRefOptions: EditorRangeRefOptions = { affinity: 'inward' }
    const stringOptions: EditorStringOptions = { voids: true }
    const unhangRangeOptions: EditorUnhangRangeOptions = { voids: true }
    const voidOptions: EditorVoidOptions = { at: [] }
    const compare: PropsCompare = (prop, nodeProp) => prop === nodeProp
    const merge: PropsMerge = () => ({ merged: true })

    assert.equal(typeof editorInterface.before, 'function')
    assert.equal(beforeOptions.voids, true)
    assert.equal(afterOptions.unit, 'line')
    assert.equal(directedDeletionOptions.unit, 'character')
    assert.equal(fragmentDeletionOptions.direction, 'backward')
    assert.deepEqual(elementReadOnlyOptions, { at: [] })
    assert.equal(leafOptions.edge, 'start')
    assert.equal(levelsOptions.voids, true)
    assert.equal(nextOptions.voids, true)
    assert.equal(nodeOptions.depth, 1)
    assert.equal(nodesOptions.mode, 'lowest')
    assert.equal(parentOptions.depth, 1)
    assert.equal(pathOptions.depth, 1)
    assert.equal(pathRefOptions.affinity, 'backward')
    assert.equal(pointOptions.edge, 'end')
    assert.equal(pointRefOptions.affinity, 'forward')
    assert.equal(positionsOptions.unit, 'word')
    assert.equal(previousOptions.voids, true)
    assert.equal(rangeRefOptions.affinity, 'inward')
    assert.equal(stringOptions.voids, true)
    assert.equal(unhangRangeOptions.voids, true)
    assert.deepEqual(voidOptions, { at: [] })
    assert.equal(compare('a', 'a'), true)
    assert.deepEqual(merge('left', 'right'), { merged: true })

    assert.deepEqual(editor.getChildren(), [])
    assert.deepEqual(editor.getOperations(), [])
    assert.equal('apply' in editor, false)
    assert.equal('apply' in editorInterface, false)
    assert.equal('getLiveNode' in editor, false)
    assert.equal('getLiveNode' in editorInterface, false)
    assert.equal('getLiveSelection' in editor, false)
    assert.equal('getLiveSelection' in editorInterface, false)
    assert.equal('getLiveText' in editor, false)
    assert.equal('getLiveText' in editorInterface, false)
    assert.equal(typeof editor.getOperations, 'function')
    assert.equal(typeof editorInterface.getOperations, 'function')
    assert.equal(typeof editor.getLastCommit, 'function')
    assert.equal(typeof editorInterface.getLastCommit, 'function')
    assert.equal(typeof editor.getOperationDirtiness, 'function')
    assert.equal(typeof editorInterface.getOperationDirtiness, 'function')
    assert.equal(typeof editor.getPathByRuntimeId, 'function')
    assert.equal(typeof editorInterface.getPathByRuntimeId, 'function')
    assert.equal(typeof editor.getRuntimeId, 'function')
    assert.equal(typeof editorInterface.getRuntimeId, 'function')
    assert.equal(typeof editor.read, 'function')
    assert.equal(typeof editorInterface.read, 'function')
    assert.equal(typeof editor.update, 'function')
    assert.equal(typeof editorInterface.update, 'function')

    assert.equal(typeof editor.insertNodes, 'function')
    assert.equal(typeof editor.select, 'function')
    assert.equal(typeof editor.insertText, 'function')
  })

  it('exposes applyOperations as the explicit public operation replay writer', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [{ text: 'alpha' }],
        },
      ],
      selection: {
        anchor: { path: [0, 0], offset: 5 },
        focus: { path: [0, 0], offset: 5 },
      },
      marks: null,
    })

    editor.applyOperations([
      {
        type: 'insert_text',
        path: [0, 0],
        offset: 5,
        text: '!',
      },
    ])

    assert.equal(
      Editor.getSnapshot(editor).children[0].children[0].text,
      'alpha!'
    )
    assert.equal(Editor.getOperations(editor).length, 1)
  })

  it('does not expose Editor.apply as a public single-operation helper', () => {
    const editorInterface: EditorInterface = Editor

    assert.equal('apply' in editorInterface, false)
    assert.equal((editorInterface as Record<string, unknown>).apply, undefined)
  })

  it('fences live reads behind internal runtime helpers', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [{ text: 'alpha' }],
        },
      ],
      selection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      },
      marks: null,
    })

    const textNode = getEditorLiveText(editor, [0, 0])
    const runtimeId = Editor.getRuntimeId(editor, [0, 0])

    assert.equal(textNode?.text, 'alpha')
    assert.deepEqual(getEditorLiveSelection(editor), {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })
    assert.deepEqual(Editor.getSelection(editor), {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })
    assert.equal(typeof runtimeId, 'string')
    assert.deepEqual(Editor.getPathByRuntimeId(editor, runtimeId!), [0, 0])

    editor.update(() => {
      editor.insertNodes(
        {
          type: 'paragraph',
          children: [{ text: 'before' }],
        },
        { at: [0] }
      )
    })

    assert.deepEqual(Editor.getPathByRuntimeId(editor, runtimeId!), [1, 0])
  })

  it('preserves touched runtime ids for no-subscriber structural removals', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [{ text: 'alpha' }],
        },
        {
          type: 'paragraph',
          children: [{ text: 'beta' }],
        },
      ],
      selection: null,
      marks: null,
    })

    const removedRuntimeId = Editor.getRuntimeId(editor, [1])

    editor.update(() => {
      editor.removeNodes({ at: [1] })
    })

    const commit = Editor.getLastCommit(editor)

    assert(commit)
    assert.deepEqual(commit.classes, ['structural'])
    assert.deepEqual(commit.touchedRuntimeIds, [removedRuntimeId])
    assert.deepEqual(commit.dirty.runtimeIds, [removedRuntimeId])
  })

  it('classifies operation dirtiness by renderer-facing change class', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [{ text: 'alpha' }],
        },
        {
          type: 'paragraph',
          children: [{ text: 'beta' }],
        },
      ],
      selection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      },
      marks: null,
    })

    const textRuntimeId = Editor.getRuntimeId(editor, [0, 0])
    const blockRuntimeId = Editor.getRuntimeId(editor, [0])

    const textChange = Editor.getOperationDirtiness(editor, [
      {
        type: 'insert_text',
        path: [0, 0],
        offset: 0,
        text: '!',
      },
      {
        type: 'remove_text',
        path: [0, 0],
        offset: 0,
        text: 'a',
      },
    ])
    const selectionChange = Editor.getOperationDirtiness(editor, [
      {
        type: 'set_selection',
        properties: null,
        newProperties: {
          anchor: { path: [1, 0], offset: 1 },
          focus: { path: [1, 0], offset: 1 },
        },
      },
    ])
    const structuralChange = Editor.getOperationDirtiness(editor, [
      {
        type: 'set_node',
        path: [0],
        properties: { type: 'paragraph' },
        newProperties: { type: 'heading' },
      },
    ])
    const markChange = Editor.getOperationDirtiness(editor, [])
    const replaceChange = Editor.getOperationDirtiness(editor, [], {
      reason: 'replace',
    })

    assert.deepEqual(textChange.classes, ['text'])
    assert.equal(textChange.childrenChanged, true)
    assert.equal(textChange.selectionChanged, false)
    assert.equal(textChange.marksChanged, false)
    assert.deepEqual(textChange.dirtyPaths, [[], [0], [0, 0]])
    assert.deepEqual(textChange.touchedRuntimeIds, [textRuntimeId])

    assert.deepEqual(selectionChange.classes, ['selection'])
    assert.equal(selectionChange.childrenChanged, false)
    assert.equal(selectionChange.selectionChanged, true)
    assert.equal(selectionChange.marksChanged, false)
    assert.deepEqual(selectionChange.dirtyPaths, [])
    assert.deepEqual(selectionChange.touchedRuntimeIds, [])

    assert.deepEqual(structuralChange.classes, ['structural'])
    assert.equal(structuralChange.childrenChanged, true)
    assert.equal(structuralChange.dirtyScope, 'paths')
    assert.deepEqual(structuralChange.touchedRuntimeIds, [blockRuntimeId])

    assert.deepEqual(markChange.classes, ['mark'])
    assert.equal(markChange.childrenChanged, false)
    assert.equal(markChange.selectionChanged, false)
    assert.equal(markChange.marksChanged, true)
    assert.deepEqual(markChange.touchedRuntimeIds, [])

    assert.deepEqual(replaceChange.classes, ['replace'])
    assert.equal(replaceChange.dirtyScope, 'all')
    assert.equal(replaceChange.childrenChanged, true)
    assert.equal(replaceChange.replaceEpoch, 1)
    assert.equal(replaceChange.touchedRuntimeIds, null)
  })

  it('exports the wider runtime helper surface consumed by sibling packages', () => {
    const editor = createEditor()
    const text = { text: 'alpha' }
    const element = {
      type: 'paragraph',
      children: [text],
    } as const
    const range = {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 5 },
    } as const

    assert.equal(Text.isText(text), true)
    assert.equal(Element.isElement(element), true)
    assert.equal(Path.isPath([0, 1]), true)
    assert.equal(Range.isRange(range), true)
    assert.equal(Location.isLocation([0, 0]), true)
    assert.equal(Span.isSpan([[0], [1]]), true)

    Editor.replace(editor, {
      children: [element],
      selection: null,
      marks: null,
    })

    editor.applyOperations([
      {
        type: 'insert_text',
        path: [0, 0],
        offset: 5,
        text: '!',
      },
    ])

    assert.equal(
      Editor.getSnapshot(editor).children[0].children[0].text,
      'alpha!'
    )

    Editor.replace(editor, {
      children: [element],
      selection: null,
      marks: null,
    })

    editor.applyOperations([
      {
        type: 'insert_text',
        path: [0, 0],
        offset: 5,
        text: '!',
      },
      {
        type: 'insert_text',
        path: [0, 0],
        offset: 6,
        text: '?',
      },
    ])

    assert.equal(
      Editor.getSnapshot(editor).children[0].children[0].text,
      'alpha!?'
    )

    assert.equal(Operation.isOperationList(editor.getOperations()), true)
    assert.equal(Scrubber.stringify({ text: 'secret' }), '{"text":"secret"}')
  })

  it('createEditor exposes an overrideable instance surface for the supported editor and transform methods', () => {
    const editor = createEditor() as typeof createEditor extends () => infer T
      ? T & Record<string, unknown>
      : never

    const methodNames = [
      'addMark',
      'above',
      'after',
      'before',
      'bookmark',
      'collapse',
      'delete',
      'deleteBackward',
      'deleteForward',
      'deleteFragment',
      'deselect',
      'elementReadOnly',
      'edges',
      'end',
      'extend',
      'first',
      'fragment',
      'getChildren',
      'getDirtyPaths',
      'getFragment',
      'getLastCommit',
      'getOperationDirtiness',
      'getPathByRuntimeId',
      'getRuntimeId',
      'getSnapshot',
      'insertBreak',
      'insertFragment',
      'insertNode',
      'insertNodes',
      'insertSoftBreak',
      'insertText',
      'levels',
      'moveNodes',
      'node',
      'nodes',
      'normalize',
      'normalizeNode',
      'pathRef',
      'pathRefs',
      'pointRef',
      'pointRefs',
      'positions',
      'rangeRef',
      'rangeRefs',
      'removeNodes',
      'replace',
      'reset',
      'select',
      'setNodes',
      'setSelection',
      'splitNodes',
      'string',
      'subscribe',
      'unhangRange',
      'unsetNodes',
      'unwrapNodes',
      'withoutNormalizing',
      'withTransaction',
      'wrapNodes',
    ] as const

    methodNames.forEach((methodName) => {
      assert.equal(
        typeof editor[methodName],
        'function',
        `${methodName} exists`
      )
    })
  })

  it('Editor helpers delegate through overrideable instance methods', () => {
    const editor = createEditor() as typeof createEditor extends () => infer T
      ? T & Record<string, unknown>
      : never
    const calls: unknown[][] = []

    editor.insertText = (...args: unknown[]) => {
      calls.push(['insertText', ...args])
    }
    editor.getChildren = (...args: unknown[]) => {
      calls.push(['getChildren', ...args])
      return [{ type: 'paragraph', children: [{ text: 'child' }] }]
    }
    editor.getDirtyPaths = (...args: unknown[]) => {
      calls.push(['getDirtyPaths', ...args])
      return [[0]]
    }
    editor.rangeRefs = (...args: unknown[]) => {
      calls.push(['rangeRefs', ...args])
      return new Set()
    }
    Editor.insertText(editor, 'x')
    assert.deepEqual(calls[0], ['insertText', 'x'])

    assert.deepEqual(Editor.getChildren(editor), [
      { type: 'paragraph', children: [{ text: 'child' }] },
    ])
    assert.deepEqual(calls[1], ['getChildren'])

    assert.deepEqual(
      Editor.getDirtyPaths(editor, {
        type: 'insert_text',
        path: [0, 0],
        offset: 0,
        text: 'x',
      }),
      [[0]]
    )
    assert.deepEqual(calls[2], [
      'getDirtyPaths',
      {
        type: 'insert_text',
        path: [0, 0],
        offset: 0,
        text: 'x',
      },
    ])

    assert.equal(Editor.rangeRefs(editor).size, 0)
    assert.equal(calls.at(-1)?.[0], 'rangeRefs')
  })
})
