import {
  createEditorRuntime,
  createEditorView,
  defineEditorExtension,
  type Point,
  type RootKey,
} from 'slate'
import { Editor } from 'slate/internal'
import { history } from 'slate-history'
import { describe, expect, it } from 'vitest'
import {
  applyEditableCommand,
  applyModelOwnedHistoryIntent,
} from '../src/editable/mutation-controller'
import type { ReactRuntimeEditor } from '../src/plugin/react-editor'
import {
  createSlateProjectionGraph,
  type SlateProjectionOwner,
} from '../src/projection-graph'
import {
  createSlateViewSelection,
  readSlateViewSelection,
  writeSlateViewSelection,
} from '../src/view-selection'

const SHARED_ROOT = 'synced-block:shared:body' as RootKey

const contentRootExtension = defineEditorExtension({
  elements: [
    {
      type: 'content-card',
      contentRoot: { slot: 'body' },
      void: 'editable-island',
    },
  ],
  name: 'projected-command-test',
})

const paragraph = (text: string) => ({
  type: 'paragraph',
  children: [{ text }],
})

const contentCard = (bodyRoot = SHARED_ROOT) => ({
  type: 'content-card',
  childRoots: { body: bodyRoot },
  children: [{ text: '' }],
})

const sharedOwner = {
  childRoot: SHARED_ROOT,
  ownerPath: [1],
  ownerRoot: 'main',
} satisfies SlateProjectionOwner

const secondSharedOwner = {
  childRoot: SHARED_ROOT,
  ownerPath: [3],
  ownerRoot: 'main',
} satisfies SlateProjectionOwner

const point = (
  root: RootKey | undefined,
  path: readonly number[],
  offset: number
): Point => ({
  ...(root ? { root } : {}),
  path: [...path],
  offset,
})

const createFixture = () => {
  const runtime = createEditorRuntime({
    extensions: [history(), contentRootExtension],
    initialValue: {
      roots: {
        [SHARED_ROOT]: [paragraph('Inside'), paragraph('More')],
        main: [paragraph('Before'), contentCard(), paragraph('After')],
      },
    },
  })
  const editor = createEditorView(runtime, {
    root: 'main',
  }) as unknown as ReactRuntimeEditor
  const graph = createSlateProjectionGraph([
    { path: [0], root: 'main' },
    { owner: sharedOwner, path: [0], root: SHARED_ROOT },
    { owner: sharedOwner, path: [1], root: SHARED_ROOT },
    { path: [2], root: 'main' },
  ])

  return { editor, graph }
}

const createRepeatedRootFixture = () => {
  const runtime = createEditorRuntime({
    extensions: [history(), contentRootExtension],
    initialValue: {
      roots: {
        [SHARED_ROOT]: [paragraph('Inside')],
        main: [
          paragraph('Before'),
          contentCard(),
          paragraph('Between'),
          contentCard(),
          paragraph('After'),
        ],
      },
    },
  })
  const editor = createEditorView(runtime, {
    root: 'main',
  }) as unknown as ReactRuntimeEditor
  const graph = createSlateProjectionGraph([
    { path: [0], root: 'main' },
    { owner: sharedOwner, path: [0], root: SHARED_ROOT },
    { path: [2], root: 'main' },
    { owner: secondSharedOwner, path: [0], root: SHARED_ROOT },
    { path: [4], root: 'main' },
  ])

  return { editor, graph }
}

const writeForwardProjectedSelection = (
  editor: ReactRuntimeEditor,
  graph: ReturnType<typeof createSlateProjectionGraph>
) => {
  writeSlateViewSelection(
    editor,
    createSlateViewSelection(graph, {
      anchor: { point: point(undefined, [0, 0], 'Bef'.length) },
      focus: {
        owner: sharedOwner,
        point: point(SHARED_ROOT, [0, 0], 'In'.length),
      },
    })
  )
}

describe('projected editable commands', () => {
  it('typing over a projected selection replaces the visible span across roots in one commit', () => {
    const { editor, graph } = createFixture()

    writeForwardProjectedSelection(editor, graph)
    expect(readSlateViewSelection(editor)).not.toBe(null)

    expect(
      applyEditableCommand({
        command: { inputType: 'insertText', kind: 'insert-text', text: 'X' },
        editor,
      })
    ).toBe(true)

    expect(editor.read((state) => state.value.get())).toEqual({
      roots: {
        [SHARED_ROOT]: [paragraph('side'), paragraph('More')],
        main: [paragraph('BefX'), contentCard(), paragraph('After')],
      },
    })
    expect(editor.read((state) => state.selection.get())).toEqual({
      anchor: { path: [0, 0], offset: 'BefX'.length },
      focus: { path: [0, 0], offset: 'BefX'.length },
    })
    expect(readSlateViewSelection(editor)).toBe(null)
    const textOperations = Editor.getLastCommit(editor)?.operations.filter(
      (operation) =>
        operation.type === 'insert_text' || operation.type === 'remove_text'
    )

    expect(textOperations).toEqual([
      {
        offset: 0,
        path: [0, 0],
        root: SHARED_ROOT,
        text: 'In',
        type: 'remove_text',
      },
      {
        offset: 'Bef'.length,
        path: [0, 0],
        root: 'main',
        text: 'ore',
        type: 'remove_text',
      },
      {
        offset: 'Bef'.length,
        path: [0, 0],
        root: 'main',
        text: 'X',
        type: 'insert_text',
      },
    ])
  })

  it('delete-fragment over a projected selection deletes the visible span and collapses at the visual start', () => {
    const { editor, graph } = createFixture()

    writeForwardProjectedSelection(editor, graph)

    expect(
      applyEditableCommand({
        command: { kind: 'delete-fragment' },
        editor,
      })
    ).toBe(true)

    expect(editor.read((state) => state.value.get())).toEqual({
      roots: {
        [SHARED_ROOT]: [paragraph('side'), paragraph('More')],
        main: [paragraph('Bef'), contentCard(), paragraph('After')],
      },
    })
    expect(editor.read((state) => state.selection.get())).toEqual({
      anchor: { path: [0, 0], offset: 'Bef'.length },
      focus: { path: [0, 0], offset: 'Bef'.length },
    })
    expect(readSlateViewSelection(editor)).toBe(null)
  })

  it('undo and redo restore the projected selection sidecar instead of losing owner identity', () => {
    const { editor, graph } = createFixture()

    writeForwardProjectedSelection(editor, graph)
    const projectedSelection = readSlateViewSelection(editor)

    expect(projectedSelection).not.toBe(null)
    applyEditableCommand({
      command: { inputType: 'insertText', kind: 'insert-text', text: 'X' },
      editor,
    })
    expect(readSlateViewSelection(editor)).toBe(null)

    expect(applyModelOwnedHistoryIntent({ direction: 'undo', editor })).toBe(
      true
    )
    expect(editor.read((state) => state.value.get())).toEqual({
      roots: {
        [SHARED_ROOT]: [paragraph('Inside'), paragraph('More')],
        main: [paragraph('Before'), contentCard(), paragraph('After')],
      },
    })
    expect(readSlateViewSelection(editor)).toEqual(projectedSelection)

    expect(applyModelOwnedHistoryIntent({ direction: 'redo', editor })).toBe(
      true
    )
    expect(editor.read((state) => state.value.get())).toEqual({
      roots: {
        [SHARED_ROOT]: [paragraph('side'), paragraph('More')],
        main: [paragraph('BefX'), contentCard(), paragraph('After')],
      },
    })
    expect(readSlateViewSelection(editor)).toBe(null)
  })

  it('rejects ambiguous commands across repeated copies of the same content root', () => {
    const { editor, graph } = createRepeatedRootFixture()

    editor.update((tx) => {
      tx.selection.set({
        anchor: point(undefined, [0, 0], 0),
        focus: point(undefined, [0, 0], 0),
      })
    })
    writeSlateViewSelection(
      editor,
      createSlateViewSelection(graph, {
        anchor: {
          owner: sharedOwner,
          point: point(SHARED_ROOT, [0, 0], 1),
        },
        focus: {
          owner: secondSharedOwner,
          point: point(SHARED_ROOT, [0, 0], 3),
        },
      })
    )

    expect(
      applyEditableCommand({
        command: { inputType: 'insertText', kind: 'insert-text', text: 'X' },
        editor,
      })
    ).toBe(true)

    expect(editor.read((state) => state.value.get())).toEqual({
      roots: {
        [SHARED_ROOT]: [paragraph('Inside')],
        main: [
          paragraph('XBefore'),
          contentCard(),
          paragraph('Between'),
          contentCard(),
          paragraph('After'),
        ],
      },
    })
    expect(readSlateViewSelection(editor)).toBe(null)
  })

  it('clears projected selection when an explicit root-local select command runs', () => {
    const { editor, graph } = createFixture()

    writeForwardProjectedSelection(editor, graph)

    applyEditableCommand({
      command: {
        kind: 'select',
        selection: {
          anchor: point(undefined, [2, 0], 0),
          focus: point(undefined, [2, 0], 'After'.length),
        },
      },
      editor,
    })

    expect(readSlateViewSelection(editor)).toBe(null)
    expect(editor.read((state) => state.selection.get())).toEqual({
      anchor: { path: [2, 0], offset: 0 },
      focus: { path: [2, 0], offset: 'After'.length },
    })
  })
})
