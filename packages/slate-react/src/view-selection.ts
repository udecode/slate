import { type Path, PathApi, type Point } from 'slate'
import {
  getSlateProjectionOwnerKey,
  type SlateProjectedPoint,
  SlateProjectionGraph,
  type SlateProjectionGraphModel,
  type SlateProjectionGraphRangeSegments,
  type SlateProjectionOwner,
} from './projection-graph'

const MAIN_ROOT_KEY = 'main'

export type SlateViewSelection = Readonly<{
  anchor: SlateProjectedPoint
  focus: SlateProjectedPoint
  segments: SlateProjectionGraphRangeSegments
}>

export type SlateViewSelectionCollapseEdge =
  | 'anchor'
  | 'end'
  | 'focus'
  | 'start'

const EDITOR_TO_VIEW_SELECTION = new WeakMap<object, SlateViewSelection>()
const HISTORY_BATCH_TO_VIEW_SELECTION = new WeakMap<
  object,
  Readonly<{
    redo: SlateViewSelection | null
    undo: SlateViewSelection | null
  }>
>()

const clonePath = (path: Path): Path => [...path] as Path

const clonePoint = (point: Point): Point =>
  Object.freeze({
    ...(point.root ? { root: point.root } : {}),
    path: Object.freeze(clonePath(point.path)) as Path,
    offset: point.offset,
  }) as Point

const cloneOwner = (
  owner: SlateProjectionOwner | null | undefined
): SlateProjectionOwner | null =>
  owner
    ? Object.freeze({
        childRoot: owner.childRoot,
        ownerPath: Object.freeze(clonePath(owner.ownerPath)) as Path,
        ownerRoot: owner.ownerRoot,
      })
    : null

const cloneProjectedPoint = (
  projectedPoint: SlateProjectedPoint
): SlateProjectedPoint =>
  Object.freeze({
    ...(projectedPoint.owner
      ? { owner: cloneOwner(projectedPoint.owner) }
      : {}),
    point: clonePoint(projectedPoint.point),
  })

const getProjectedPointOwnerKey = (projectedPoint: SlateProjectedPoint) =>
  projectedPoint.owner ? getSlateProjectionOwnerKey(projectedPoint.owner) : null

const isProjectedPointEqual = (
  left: SlateProjectedPoint,
  right: SlateProjectedPoint
) =>
  getProjectedPointOwnerKey(left) === getProjectedPointOwnerKey(right) &&
  left.point.offset === right.point.offset &&
  (left.point.root ?? MAIN_ROOT_KEY) === (right.point.root ?? MAIN_ROOT_KEY) &&
  PathApi.equals(left.point.path, right.point.path)

export const createSlateViewSelection = (
  graph: SlateProjectionGraphModel,
  range: Readonly<{
    anchor: SlateProjectedPoint
    focus: SlateProjectedPoint
  }>
): SlateViewSelection => {
  const anchor = cloneProjectedPoint(range.anchor)
  const focus = cloneProjectedPoint(range.focus)

  return Object.freeze({
    anchor,
    focus,
    segments: SlateProjectionGraph.segmentRange(graph, {
      anchor,
      focus,
    }),
  })
}

export const extendSlateViewSelection = (
  graph: SlateProjectionGraphModel,
  selection: SlateViewSelection,
  focus: SlateProjectedPoint
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
): SlateProjectedPoint => {
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
): SlateViewSelection | null => EDITOR_TO_VIEW_SELECTION.get(editor) ?? null

export const writeSlateViewSelection = (
  editor: object,
  selection: SlateViewSelection | null
) => {
  if (!selection) {
    EDITOR_TO_VIEW_SELECTION.delete(editor)
    return
  }

  EDITOR_TO_VIEW_SELECTION.set(editor, selection)
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
