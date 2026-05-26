import type { Point } from 'slate'
import { describe, expect, it } from 'vitest'

import {
  createSlateProjectionGraph,
  getSlateProjectionOwnerKey,
  type SlateProjectionOwner,
} from '../src/projection-graph'
import {
  collapseSlateViewSelection,
  createSlateViewSelection,
  extendSlateViewSelection,
  isSlateViewSelectionCollapsed,
  readSlateViewSelection,
  writeSlateViewSelection,
} from '../src/view-selection'

const SHARED_ROOT = 'synced-block:shared:body'
const SEPARATE_ROOT = 'synced-block:separate:body'

const firstSharedOwner = {
  childRoot: SHARED_ROOT,
  ownerPath: [1],
  ownerRoot: 'main',
} satisfies SlateProjectionOwner

const separateOwner = {
  childRoot: SEPARATE_ROOT,
  ownerPath: [3],
  ownerRoot: 'main',
} satisfies SlateProjectionOwner

const secondSharedOwner = {
  childRoot: SHARED_ROOT,
  ownerPath: [5],
  ownerRoot: 'main',
} satisfies SlateProjectionOwner

const point = (
  root: string | undefined,
  path: readonly number[],
  offset: number
): Point => ({
  ...(root ? { root } : {}),
  path: [...path],
  offset,
})

const graph = createSlateProjectionGraph([
  { path: [0], root: 'main' },
  { owner: firstSharedOwner, path: [0], root: SHARED_ROOT },
  { owner: firstSharedOwner, path: [1], root: SHARED_ROOT },
  { path: [2], root: 'main' },
  { owner: separateOwner, path: [0], root: SEPARATE_ROOT },
  { path: [4], root: 'main' },
  { owner: secondSharedOwner, path: [0], root: SHARED_ROOT },
  { owner: secondSharedOwner, path: [1], root: SHARED_ROOT },
  { path: [6], root: 'main' },
])

describe('slate view selection', () => {
  it('stores a projected selection over visible graph segments without widening Slate points', () => {
    const selection = createSlateViewSelection(graph, {
      anchor: { point: point(undefined, [0, 0], 1) },
      focus: {
        owner: firstSharedOwner,
        point: point(SHARED_ROOT, [1, 0], 4),
      },
    })

    expect(isSlateViewSelectionCollapsed(selection)).toBe(false)
    expect(selection.segments.backward).toBe(false)
    expect(
      selection.segments.parts.map((part) => ({
        ownerKey: part.ownerKey,
        root: part.root,
      }))
    ).toEqual([
      { ownerKey: null, root: 'main' },
      {
        ownerKey: getSlateProjectionOwnerKey(firstSharedOwner),
        root: SHARED_ROOT,
      },
    ])
    expect(JSON.stringify(selection.anchor.point)).not.toContain('owner')
    expect(JSON.stringify(selection.focus.point)).not.toContain('owner')
  })

  it('treats implicit main-root and explicit main-root points as the same view point', () => {
    const selection = createSlateViewSelection(graph, {
      anchor: { point: point(undefined, [0, 0], 1) },
      focus: { point: point('main', [0, 0], 1) },
    })

    expect(isSlateViewSelectionCollapsed(selection)).toBe(true)
  })

  it('collapses by anchor, focus, and visible start/end with repeated-root owner identity intact', () => {
    const forward = createSlateViewSelection(graph, {
      anchor: { point: point(undefined, [0, 0], 1) },
      focus: {
        owner: secondSharedOwner,
        point: point(SHARED_ROOT, [0, 0], 2),
      },
    })
    const backward = createSlateViewSelection(graph, {
      anchor: {
        owner: secondSharedOwner,
        point: point(SHARED_ROOT, [0, 0], 2),
      },
      focus: { point: point(undefined, [0, 0], 1) },
    })

    expect(collapseSlateViewSelection(forward, 'focus')).toEqual({
      owner: secondSharedOwner,
      point: { root: SHARED_ROOT, path: [0, 0], offset: 2 },
    })
    expect(collapseSlateViewSelection(backward, 'start')).toEqual({
      point: { path: [0, 0], offset: 1 },
    })
    expect(collapseSlateViewSelection(backward, 'end')).toEqual({
      owner: secondSharedOwner,
      point: { root: SHARED_ROOT, path: [0, 0], offset: 2 },
    })
  })

  it('extends from a stable anchor to a new projected focus', () => {
    const initial = createSlateViewSelection(graph, {
      anchor: { point: point(undefined, [0, 0], 1) },
      focus: {
        owner: firstSharedOwner,
        point: point(SHARED_ROOT, [0, 0], 2),
      },
    })
    const extended = extendSlateViewSelection(graph, initial, {
      owner: separateOwner,
      point: point(SEPARATE_ROOT, [0, 0], 8),
    })

    expect(extended.anchor).toEqual(initial.anchor)
    expect(extended.focus).toEqual({
      owner: separateOwner,
      point: { root: SEPARATE_ROOT, path: [0, 0], offset: 8 },
    })
    expect(extended.segments.parts.map((part) => part.root)).toEqual([
      'main',
      SHARED_ROOT,
      'main',
      SEPARATE_ROOT,
    ])
  })

  it('keeps runtime view selection state editor-local', () => {
    const editorA = {}
    const editorB = {}
    const selection = createSlateViewSelection(graph, {
      anchor: { point: point(undefined, [0, 0], 1) },
      focus: {
        owner: separateOwner,
        point: point(SEPARATE_ROOT, [0, 0], 8),
      },
    })

    writeSlateViewSelection(editorA, selection)

    expect(readSlateViewSelection(editorA)).toEqual(selection)
    expect(readSlateViewSelection(editorB)).toBe(null)

    writeSlateViewSelection(editorA, null)

    expect(readSlateViewSelection(editorA)).toBe(null)
  })
})
