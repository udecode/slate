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
import {
  createEditor,
  type Descendant,
  Editor,
  Element,
  GeneralTransforms,
  Location,
  NodeTransforms,
  Operation,
  Path,
  Range,
  Scrubber,
  SelectionTransforms,
  Span,
  Text,
  TextTransforms,
  Transforms,
} from '../src'

describe('slate surface contract', () => {
  it('keeps legacy editor helper type names and transform family exports on the current surface', () => {
    const editor = createEditor()
    const paragraph = {
      type: 'paragraph',
      children: [{ text: 'alpha' }],
    } satisfies Descendant

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

    editor.children = []
    editor.selection = null
    editor.operations = []
    assert.deepEqual(editor.children, [])
    assert.deepEqual(editor.operations, [])

    editor.insertNode(paragraph)
    assert.equal(Editor.getSnapshot(editor).children.length, 1)

    editor.selection = {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    }
    editor.removeNodes()
    assert.equal(Editor.getSnapshot(editor).children.length, 0)

    assert.equal(typeof GeneralTransforms.transform, 'function')
    assert.equal(typeof NodeTransforms.insertNodes, 'function')
    assert.equal(typeof SelectionTransforms.select, 'function')
    assert.equal(typeof TextTransforms.insertText, 'function')
    assert.equal(typeof Transforms.insertNodes, 'function')
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

    GeneralTransforms.transform(editor, {
      type: 'insert_text',
      path: [0, 0],
      offset: 5,
      text: '!',
    })

    assert.equal(
      Editor.getSnapshot(editor).children[0].children[0].text,
      'alpha!'
    )

    Editor.replace(editor, {
      children: [element],
      selection: null,
      marks: null,
    })

    GeneralTransforms.applyBatch(editor, [
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

    assert.equal(Operation.isOperationList(editor.operations), true)
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
      'first',
      'fragment',
      'getChildren',
      'getDirtyPaths',
      'getFragment',
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
      'setChildren',
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

  it('children accessor routes through getChildren and setChildren', () => {
    const editor = createEditor() as typeof createEditor extends () => infer T
      ? T & Record<string, unknown>
      : never
    const calls: string[] = []
    const originalGetChildren = editor.getChildren
    const originalSetChildren = editor.setChildren
    const value = [{ type: 'paragraph', children: [{ text: 'one' }] }]

    editor.getChildren = () => {
      calls.push('get')
      return originalGetChildren()
    }

    editor.setChildren = (children) => {
      calls.push('set')
      originalSetChildren(children)
    }

    editor.children = value
    const currentChildren = editor.children

    assert.deepEqual(currentChildren, value)
    assert.equal(calls[0], 'set')
    assert.equal(calls.includes('get'), true)
    assert(Object.keys(editor).includes('children'))
  })

  it('Editor and Transforms helpers delegate through overrideable instance methods', () => {
    const editor = createEditor() as typeof createEditor extends () => infer T
      ? T & Record<string, unknown>
      : never
    const calls: unknown[][] = []
    const expectedPoint = { path: [0, 0], offset: 1 }

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
    editor.withTransaction = (...args: unknown[]) => {
      calls.push(['withTransaction', ...args])
      const fn = args[0] as () => void
      fn()
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

    GeneralTransforms.applyBatch(editor, [
      {
        type: 'set_selection',
        properties: null,
        newProperties: {
          anchor: expectedPoint,
          focus: expectedPoint,
        },
      },
    ])
    assert.equal(
      calls.some((call) => call[0] === 'withTransaction'),
      true
    )

    assert.equal(Editor.rangeRefs(editor).size, 0)
    assert.equal(calls.at(-1)?.[0], 'rangeRefs')
  })
})
