import { PathApi } from 'slate'
import {
  cloneSlateViewBoundaryProjectedPoint,
  getSlateViewBoundaryOwnerKey,
  getSlateViewBoundaryPointRoot,
  SlateViewBoundaryGraph,
  type SlateViewBoundaryGraphModel,
  type SlateViewBoundaryPoint,
  type SlateViewBoundaryRangeSegments,
} from './view-boundary-graph'

export type SlateViewSelection = Readonly<{
  anchor: SlateViewBoundaryPoint
  focus: SlateViewBoundaryPoint
  segments: SlateViewBoundaryRangeSegments
}>

export type SlateViewSelectionCollapseEdge =
  | 'anchor'
  | 'end'
  | 'focus'
  | 'start'

const EDITOR_TO_VIEW_SELECTION = new WeakMap<object, SlateViewSelection>()
const EDITOR_TO_VIEW_SELECTION_STORE_KEY = new WeakMap<object, object>()
const HISTORY_BATCH_TO_VIEW_SELECTION = new WeakMap<
  object,
  Readonly<{
    redo: SlateViewSelection | null
    undo: SlateViewSelection | null
  }>
>()

const cloneProjectedPoint = cloneSlateViewBoundaryProjectedPoint

export const setSlateViewSelectionStoreKey = (
  editor: object,
  storeKey: object
) => {
  EDITOR_TO_VIEW_SELECTION_STORE_KEY.set(editor, storeKey)
}

const getViewSelectionStoreKey = (editor: object): object =>
  EDITOR_TO_VIEW_SELECTION_STORE_KEY.get(editor) ?? editor

const getProjectedPointOwnerKey = (projectedPoint: SlateViewBoundaryPoint) =>
  projectedPoint.owner
    ? getSlateViewBoundaryOwnerKey(projectedPoint.owner)
    : null

const isProjectedPointEqual = (
  left: SlateViewBoundaryPoint,
  right: SlateViewBoundaryPoint
) =>
  getProjectedPointOwnerKey(left) === getProjectedPointOwnerKey(right) &&
  left.point.offset === right.point.offset &&
  getSlateViewBoundaryPointRoot(left) ===
    getSlateViewBoundaryPointRoot(right) &&
  PathApi.equals(left.point.path, right.point.path)

export const createSlateViewSelection = (
  graph: SlateViewBoundaryGraphModel,
  range: Readonly<{
    anchor: SlateViewBoundaryPoint
    focus: SlateViewBoundaryPoint
  }>
): SlateViewSelection => {
  const anchor = cloneProjectedPoint(range.anchor)
  const focus = cloneProjectedPoint(range.focus)

  return Object.freeze({
    anchor,
    focus,
    segments: SlateViewBoundaryGraph.segmentRange(graph, {
      anchor,
      focus,
    }),
  })
}

export const extendSlateViewSelection = (
  graph: SlateViewBoundaryGraphModel,
  selection: SlateViewSelection,
  focus: SlateViewBoundaryPoint
): SlateViewSelection =>
  createSlateViewSelection(graph, {
    anchor: selection.anchor,
    focus,
  })

export const isSlateViewSelectionCollapsed = (selection: SlateViewSelection) =>
  isProjectedPointEqual(selection.anchor, selection.focus)

export const collapseSlateViewSelection = (
  selection: SlateViewSelection,
  edge: SlateViewSelectionCollapseEdge
): SlateViewBoundaryPoint => {
  switch (edge) {
    case 'anchor':
      return cloneProjectedPoint(selection.anchor)
    case 'focus':
      return cloneProjectedPoint(selection.focus)
    case 'start':
      return cloneProjectedPoint(
        selection.segments.backward ? selection.focus : selection.anchor
      )
    case 'end':
      return cloneProjectedPoint(
        selection.segments.backward ? selection.anchor : selection.focus
      )
  }
}

export const readSlateViewSelection = (
  editor: object
): SlateViewSelection | null =>
  EDITOR_TO_VIEW_SELECTION.get(getViewSelectionStoreKey(editor)) ?? null

export const writeSlateViewSelection = (
  editor: object,
  selection: SlateViewSelection | null
) => {
  const key = getViewSelectionStoreKey(editor)

  if (!selection) {
    EDITOR_TO_VIEW_SELECTION.delete(key)
    return
  }

  EDITOR_TO_VIEW_SELECTION.set(key, selection)
}

type HistoryStackName = 'redos' | 'undos'

type HistoryDirection = 'redo' | 'undo'

type EditorWithHistory = {
  read: <T>(fn: (state: unknown) => T) => T
}

const getHistoryBatch = (
  editor: EditorWithHistory,
  stackName: HistoryStackName
): object | null =>
  editor.read((state) => {
    const stack = (
      state as {
        history?: {
          redos?: () => readonly object[]
          undos?: () => readonly object[]
        }
      }
    ).history?.[stackName]?.()

    return stack?.at(-1) ?? null
  })

export const saveSlateViewSelectionHistoryEntry = (
  editor: EditorWithHistory,
  entry: Readonly<{
    redo: SlateViewSelection | null
    undo: SlateViewSelection | null
  }>
) => {
  const batch = getHistoryBatch(editor, 'undos')

  if (batch) {
    HISTORY_BATCH_TO_VIEW_SELECTION.set(batch, entry)
  }
}

export const readSlateViewSelectionHistoryEntry = (
  editor: EditorWithHistory,
  direction: HistoryDirection
): SlateViewSelection | null | undefined => {
  const batch = getHistoryBatch(
    editor,
    direction === 'undo' ? 'undos' : 'redos'
  )
  const entry = batch ? HISTORY_BATCH_TO_VIEW_SELECTION.get(batch) : undefined

  return entry?.[direction]
}
