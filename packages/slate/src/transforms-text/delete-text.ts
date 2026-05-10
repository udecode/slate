import { getEditorSchema } from '../core/editor-runtime'
import { cleanupTextLeafLifecycle } from '../core/leaf-lifecycle'
import { getCurrentSelection, runEditorTransaction } from '../core/public-state'
import { getEditorTransformRegistry } from '../core/transform-registry'
import { node as getNode } from '../editor/node'
import { nodes as getNodes } from '../editor/nodes'
import {
  type Descendant,
  Location,
  Node as NodeApi,
  type Operation,
  type Path,
  Path as PathApi,
  Point as PointApi,
  Range as RangeApi,
  type Element as SlateElement,
} from '../interfaces'
import { type Editor, Editor as EditorApi } from '../interfaces/editor'
import type { TextMutationMethods } from '../interfaces/transforms/text'
import { mergeNodes } from '../transforms-node'

const getCurrentNode = (editor: Editor, path: Path) => getNode(editor, path)[0]

const isTextNode = (
  node: ReturnType<typeof getCurrentNode>
): node is import('../interfaces').Text => 'text' in node

const getHighestNonEditable = (
  editor: Editor,
  at: Path | import('../interfaces').Point
) =>
  EditorApi.above(editor, {
    at,
    match: (node) =>
      NodeApi.isElement(node) &&
      (getEditorSchema(editor).isVoid(node) ||
        getEditorSchema(editor).isReadOnly(node)),
    mode: 'highest',
  })

const pathContainsPoint = (
  path: readonly number[],
  point: import('../interfaces').Point
) =>
  PathApi.equals(path as Path, point.path) ||
  PathApi.isAncestor(path as Path, point.path)

const valuesEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) {
    return true
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((entry, index) => valuesEqual(entry, right[index]))
    )
  }

  if (left && typeof left === 'object' && right && typeof right === 'object') {
    const leftEntries = Object.entries(left)
    const rightEntries = Object.entries(right)

    return (
      leftEntries.length === rightEntries.length &&
      leftEntries.every(
        ([key, entry]) =>
          Object.hasOwn(right, key) &&
          valuesEqual(entry, (right as Record<string, unknown>)[key])
      )
    )
  }

  return false
}

const textPropsEqual = (
  left: import('../interfaces').Text,
  right: import('../interfaces').Text
) =>
  valuesEqual(
    Object.fromEntries(Object.entries(left).filter(([key]) => key !== 'text')),
    Object.fromEntries(Object.entries(right).filter(([key]) => key !== 'text'))
  )

const canMergeAdjacentTextNodes = (
  left: ReturnType<typeof getCurrentNode>,
  right: ReturnType<typeof getCurrentNode>
) => isTextNode(left) && isTextNode(right) && textPropsEqual(left, right)

const maybeMergeAdjacentTextAt = (
  editor: Editor,
  path: Path | null | undefined
) => {
  if (
    !path ||
    !EditorApi.hasPath(editor, path) ||
    path.length === 0 ||
    path.at(-1) === 0
  ) {
    return
  }

  const previousPath = PathApi.previous(path)

  if (!EditorApi.hasPath(editor, previousPath)) {
    return
  }

  const node = getCurrentNode(editor, path)
  const previous = getCurrentNode(editor, previousPath)

  if (!canMergeAdjacentTextNodes(previous, node)) {
    return
  }

  mergeNodes(editor, { at: path })
}

const hasSingleChildNest = (
  editor: Editor,
  node: import('../interfaces').Node | null | undefined
): boolean => {
  if (node === editor || node == null) {
    return false
  }

  if (NodeApi.isText(node)) {
    return true
  }

  if (NodeApi.isElement(node) && getEditorSchema(editor).isVoid(node)) {
    return true
  }

  return (
    NodeApi.isElement(node) &&
    node.children.length === 1 &&
    hasSingleChildNest(editor, node.children[0])
  )
}

const mergeAdjacentTextRuns = (editor: Editor) => {
  if (EditorApi.getChildren(editor).length === 0) {
    return
  }

  const textPaths = Array.from(
    getNodes(editor, {
      at: [],
      reverse: true,
      match: (node): node is import('../interfaces').Text =>
        NodeApi.isText(node),
      voids: true,
    }),
    ([, path]) => path
  )

  textPaths.forEach((path) => {
    if (
      !EditorApi.hasPath(editor, path) ||
      path.length === 0 ||
      path.at(-1) === 0
    ) {
      return
    }

    const previousPath = PathApi.previous(path)

    if (!EditorApi.hasPath(editor, previousPath)) {
      return
    }

    const node = getCurrentNode(editor, path)
    const previous = getCurrentNode(editor, previousPath)

    if (canMergeAdjacentTextNodes(previous, node)) {
      mergeNodes(editor, { at: path })
    }
  })
}

const removeEmptyStructuralArtifacts = (
  editor: Editor,
  preservePath?: Path | null,
  pruneNestedUnderPath?: Path | null
) => {
  const elementPaths = Array.from(
    getNodes(editor, {
      at: [],
      reverse: true,
      match: (node) => NodeApi.isElement(node),
      voids: true,
    }),
    ([, path]) => path
  )

  elementPaths.forEach((path) => {
    if (!EditorApi.hasPath(editor, path) || path.length === 0) {
      return
    }

    if (
      preservePath &&
      (PathApi.equals(path, preservePath) ||
        PathApi.isAncestor(preservePath, path))
    ) {
      return
    }

    const node = getCurrentNode(editor, path)

    if (
      NodeApi.isElement(node) &&
      (getEditorSchema(editor).isVoid(node) ||
        getEditorSchema(editor).isReadOnly(node))
    ) {
      return
    }

    if (NodeApi.isElement(node) && getEditorSchema(editor).isInline(node)) {
      return
    }

    const isTopLevelBlock =
      NodeApi.isElement(node) &&
      path.length === 1 &&
      EditorApi.isBlock(editor, node)
    const isNestedBlock =
      NodeApi.isElement(node) &&
      path.length > 1 &&
      EditorApi.isBlock(editor, node)

    if (
      isNestedBlock &&
      (!pruneNestedUnderPath || !PathApi.isAncestor(pruneNestedUnderPath, path))
    ) {
      return
    }

    if (
      NodeApi.isElement(node) &&
      NodeApi.string(node) === '' &&
      hasSingleChildNest(editor, node) &&
      (!isTopLevelBlock || EditorApi.getChildren(editor).length > 1)
    ) {
      const parentPath = path.slice(0, -1) as Path
      const parent =
        parentPath.length === 0 ? editor : getCurrentNode(editor, parentPath)

      if (NodeApi.isElement(parent) && parent.children.length === 1) {
        return
      }

      getEditorTransformRegistry(editor).removeNodes({ at: path })
    }
  })
}

const restorePreservedEmptyStartBlock = (
  editor: Editor,
  preservePath: Path | null | undefined,
  preservedBlock: SlateElement | null | undefined
) => {
  if (!preservePath || !preservedBlock) {
    return
  }

  const shouldRestore =
    (EditorApi.getChildren(editor).length === 1 &&
      NodeApi.string(EditorApi.getChildren(editor)[0]!) !== '') ||
    !EditorApi.hasPath(editor, preservePath) ||
    NodeApi.string(getCurrentNode(editor, preservePath)) !== ''

  if (!shouldRestore) {
    return
  }

  getEditorTransformRegistry(editor).insertNodes(preservedBlock, {
    at: preservePath,
  })
}

type DeleteOptions = NonNullable<Parameters<TextMutationMethods['delete']>[1]>
type DeleteUnit = NonNullable<DeleteOptions['unit']>
type DeletePoint = import('../interfaces').Point
type DeleteRange = import('../interfaces').Range
type DeletePathTarget = {
  kind: 'path'
  path: Path
  fallbackPoint?: DeletePoint
  initialAt: DeleteOptions['at']
}
type TransactionWriter = {
  apply: (operation: Operation) => void
  setSelection: (selection: import('../interfaces').Range | null) => void
}
type DeleteRangePlan = {
  kind: 'range'
  initialAt: DeleteOptions['at']
  reverse: boolean
  unit: DeleteUnit
  distance: number
  voids: boolean
  isCollapsed: boolean
  start: DeletePoint
  end: DeletePoint
  effectiveRange: DeleteRange
  isSingleText: boolean
  isAcrossBlocks: boolean
  startNonEditable: ReturnType<typeof getHighestNonEditable>
  endNonEditable: ReturnType<typeof getHighestNonEditable>
  preserveEndBlock: boolean
  preserveEmptyStartBlockPath: Path | null
  preservedEmptyStartBlock: SlateElement | null
  startMergeBlockPath: Path | null
  effectiveStartBlockPath: Path | null
  effectiveEndBlockPath: Path | null
  removedInteriorElementSiblingStructure: boolean
}

const getLivePoint = (
  editor: Editor,
  point: DeletePoint | null | undefined
) => {
  if (!point || !EditorApi.hasPath(editor, point.path)) {
    return null
  }

  return point
}

const resolveRemovalEndPoint = (
  editor: Editor,
  plan: DeleteRangePlan,
  startPoint: DeletePoint | null | undefined,
  endPoint: DeletePoint | null | undefined
) => {
  const liveEndPoint = getLivePoint(editor, endPoint)

  if (liveEndPoint) {
    return liveEndPoint
  }

  const liveStartPoint = getLivePoint(editor, startPoint)

  if (!liveStartPoint) {
    return EditorApi.getChildren(editor).length > 0
      ? EditorApi.point(editor, [], { edge: 'start' })
      : null
  }

  const nextPoint = EditorApi.after(editor, liveStartPoint, {
    distance: 1,
    unit: 'offset',
    voids: true,
  })

  if (nextPoint) {
    return nextPoint
  }

  if (!plan.isAcrossBlocks) {
    return liveStartPoint
  }

  return null
}

const shouldMergeAcrossBlocks = (plan: DeleteRangePlan) =>
  plan.startNonEditable == null && plan.endNonEditable == null

const getClosestIsolatingAncestor = (
  editor: Editor,
  at: DeletePoint,
  voids: boolean
) =>
  EditorApi.above(editor, {
    at,
    match: (node) =>
      NodeApi.isElement(node) && getEditorSchema(editor).isIsolating(node),
    mode: 'lowest',
    voids,
  })

const crossesIsolatingBoundary = (
  editor: Editor,
  from: DeletePoint,
  to: DeletePoint,
  voids: boolean
) => {
  const fromIsolating = getClosestIsolatingAncestor(editor, from, voids)
  const toIsolating = getClosestIsolatingAncestor(editor, to, voids)

  return (
    (fromIsolating && !pathContainsPoint(fromIsolating[1], to)) ||
    (toIsolating && !pathContainsPoint(toIsolating[1], from))
  )
}

const resolveMergePoint = (
  editor: Editor,
  plan: DeleteRangePlan,
  startPoint: DeletePoint | null | undefined,
  endPoint: DeletePoint | null | undefined
) => {
  const liveEndPoint = getLivePoint(editor, endPoint)

  if (liveEndPoint) {
    return liveEndPoint
  }

  const liveStartPoint = getLivePoint(editor, startPoint)

  if (!liveStartPoint) {
    return null
  }

  return (
    EditorApi.after(editor, liveStartPoint, {
      distance: 1,
      unit: 'offset',
      voids: plan.voids,
    }) ?? null
  )
}

const movePointToFollowingInline = (
  editor: Editor,
  point: DeletePoint | null | undefined
) => {
  const livePoint = getLivePoint(editor, point)

  if (!livePoint || livePoint.path.length < 2) {
    return livePoint
  }

  const currentNode = getCurrentNode(editor, livePoint.path)

  if (
    !isTextNode(currentNode) ||
    livePoint.offset !== currentNode.text.length
  ) {
    return livePoint
  }

  const parentPath = livePoint.path.slice(0, -1) as Path

  if (!EditorApi.hasPath(editor, parentPath)) {
    return livePoint
  }

  const parent = getCurrentNode(editor, parentPath)

  if (!NodeApi.isElement(parent) || !getEditorSchema(editor).isInline(parent)) {
    return livePoint
  }

  const nextSiblingPath =
    parentPath.at(-1) == null ? null : PathApi.next(parentPath)

  if (!nextSiblingPath || !EditorApi.hasPath(editor, nextSiblingPath)) {
    return livePoint
  }

  const nextSibling = getCurrentNode(editor, nextSiblingPath)

  if (
    NodeApi.isElement(nextSibling) &&
    getEditorSchema(editor).isInline(nextSibling)
  ) {
    return EditorApi.point(editor, nextSiblingPath, { edge: 'start' })
  }

  if (!isTextNode(nextSibling) || nextSibling.text !== '') {
    return livePoint
  }

  const nextInlinePath =
    nextSiblingPath.at(-1) == null ? null : PathApi.next(nextSiblingPath)

  if (!nextInlinePath || !EditorApi.hasPath(editor, nextInlinePath)) {
    return livePoint
  }

  const nextInline = getCurrentNode(editor, nextInlinePath)

  if (
    !NodeApi.isElement(nextInline) ||
    !getEditorSchema(editor).isInline(nextInline)
  ) {
    return livePoint
  }

  return EditorApi.point(editor, nextInlinePath, { edge: 'start' })
}

const moveLeadingSpacerPointIntoFollowingInline = (
  editor: Editor,
  point: DeletePoint | null | undefined
) => {
  const livePoint = getLivePoint(editor, point)

  if (!livePoint || livePoint.offset !== 0 || livePoint.path.length === 0) {
    return livePoint
  }

  if ((livePoint.path.at(-1) ?? 0) !== 0) {
    return livePoint
  }

  const currentNode = getCurrentNode(editor, livePoint.path)

  if (!isTextNode(currentNode) || currentNode.text !== '') {
    return livePoint
  }

  const nextSiblingPath = PathApi.next(livePoint.path as Path)

  if (!EditorApi.hasPath(editor, nextSiblingPath)) {
    return livePoint
  }

  const nextSibling = getCurrentNode(editor, nextSiblingPath)

  if (
    NodeApi.isElement(nextSibling) &&
    getEditorSchema(editor).isInline(nextSibling) &&
    !getEditorSchema(editor).isVoid(nextSibling)
  ) {
    return EditorApi.point(editor, nextSiblingPath, { edge: 'start' })
  }

  return livePoint
}

const moveTrailingTextPointIntoFollowingInline = (
  editor: Editor,
  point: DeletePoint | null | undefined
) => {
  const livePoint = getLivePoint(editor, point)

  if (!livePoint) {
    return livePoint
  }

  const currentNode = getCurrentNode(editor, livePoint.path)

  if (
    !isTextNode(currentNode) ||
    livePoint.offset !== currentNode.text.length ||
    currentNode.text.length === 0
  ) {
    return livePoint
  }

  const nextSiblingPath = PathApi.next(livePoint.path as Path)

  if (!EditorApi.hasPath(editor, nextSiblingPath)) {
    return livePoint
  }

  const nextSibling = getCurrentNode(editor, nextSiblingPath)

  if (
    NodeApi.isElement(nextSibling) &&
    getEditorSchema(editor).isInline(nextSibling) &&
    !getEditorSchema(editor).isVoid(nextSibling)
  ) {
    return EditorApi.point(editor, nextSiblingPath, { edge: 'start' })
  }

  return livePoint
}

const shouldKeepSplitTextAfterInteriorElementRemoval = (
  editor: Editor,
  start: DeletePoint,
  end: DeletePoint,
  isAcrossBlocks: boolean
) =>
  !isAcrossBlocks &&
  start.path.length === end.path.length &&
  PathApi.equals(
    start.path.slice(0, -1) as Path,
    end.path.slice(0, -1) as Path
  ) &&
  Math.abs((start.path.at(-1) ?? 0) - (end.path.at(-1) ?? 0)) > 1 &&
  (() => {
    const parentPath = start.path.slice(0, -1) as Path

    if (!EditorApi.hasPath(editor, parentPath)) {
      return false
    }

    const parent = getCurrentNode(editor, parentPath)

    if (!NodeApi.isElement(parent)) {
      return false
    }

    const from = Math.min(start.path.at(-1) ?? 0, end.path.at(-1) ?? 0) + 1
    const to = Math.max(start.path.at(-1) ?? 0, end.path.at(-1) ?? 0)

    for (let index = from; index < to; index += 1) {
      const child = parent.children[index]

      if (child && NodeApi.isElement(child)) {
        return true
      }
    }

    return false
  })()

const shouldPreserveEmptyStartBlockForHangingRange = (
  editor: Editor,
  start: DeletePoint,
  isSingleText: boolean,
  isAcrossBlocks: boolean,
  preserveEndBlock: boolean,
  originalHangingBlockRange: boolean,
  effectiveStartBlock: readonly [import('../interfaces').Node, Path] | undefined
) =>
  !isSingleText &&
  isAcrossBlocks &&
  (preserveEndBlock || originalHangingBlockRange) &&
  effectiveStartBlock &&
  NodeApi.isElement(effectiveStartBlock[0]) &&
  !getEditorSchema(editor).isVoid(effectiveStartBlock[0]) &&
  PointApi.equals(start, EditorApi.point(editor, start.path, { edge: 'start' }))
    ? effectiveStartBlock[1]
    : null

const getEmptyEditableInlinePathAtPoint = (
  editor: Editor,
  at: DeletePoint
): Path | null => {
  if (at.offset !== 0 || at.path.length < 2) {
    return null
  }

  if (!EditorApi.hasPath(editor, at.path as Path)) {
    return null
  }

  const currentNode = getCurrentNode(editor, at.path as Path)

  if (!isTextNode(currentNode)) {
    return null
  }

  const parentPath = at.path.slice(0, -1) as Path

  if (!EditorApi.hasPath(editor, parentPath)) {
    return null
  }

  const parent = getCurrentNode(editor, parentPath)

  if (
    NodeApi.isElement(parent) &&
    getEditorSchema(editor).isInline(parent) &&
    !getEditorSchema(editor).isVoid(parent) &&
    !getEditorSchema(editor).isReadOnly(parent) &&
    NodeApi.string(parent) === ''
  ) {
    return parentPath
  }

  return null
}

const resolveDeleteTarget = (
  editor: Editor,
  options: DeleteOptions = {},
  resolvedAt?: Location | null
): DeletePathTarget | DeleteRangePlan | null => {
  const {
    reverse = false,
    unit = 'character',
    distance = 1,
    voids = false,
  } = options
  let { at = resolvedAt ?? getCurrentSelection(editor), hanging = false } =
    options
  const initialAt = at ?? undefined

  if (!at) {
    return null
  }

  let isCollapsed = false

  if (Location.isRange(at) && RangeApi.isCollapsed(at)) {
    isCollapsed = true
    at = at.anchor
  }

  if (Location.isPoint(at)) {
    isCollapsed = true
    const nonEditable = voids ? undefined : getHighestNonEditable(editor, at)

    if (nonEditable) {
      at = nonEditable[1]
    } else {
      const emptyInlinePath =
        reverse && unit === 'character' && distance === 1
          ? getEmptyEditableInlinePathAtPoint(editor, at)
          : null

      if (emptyInlinePath) {
        return {
          kind: 'path',
          path: emptyInlinePath,
          fallbackPoint:
            EditorApi.before(editor, emptyInlinePath, { voids: true }) ??
            EditorApi.after(editor, emptyInlinePath, { voids: true }),
          initialAt,
        }
      }

      const target = getCollapsedDeleteTarget(editor, at, {
        reverse,
        distance,
        unit,
        voids,
      })
      const targetNonEditable = voids
        ? undefined
        : getHighestNonEditable(editor, target)

      if (targetNonEditable && !pathContainsPoint(targetNonEditable[1], at)) {
        return {
          kind: 'path',
          path: targetNonEditable[1],
          fallbackPoint: at,
          initialAt,
        }
      }

      at = { anchor: at, focus: target }
      hanging = true
    }
  }

  if (Location.isPath(at)) {
    const selection = getCurrentSelection(editor)
    const selectionInside =
      selection &&
      (pathContainsPoint(at, selection.anchor) ||
        pathContainsPoint(at, selection.focus))
    const fallbackPoint = selectionInside
      ? (EditorApi.before(editor, at, { voids: true }) ??
        EditorApi.after(editor, at, { voids: true }))
      : undefined

    return {
      kind: 'path',
      path: at,
      fallbackPoint,
      initialAt,
    }
  }

  if (!RangeApi.isRange(at) || RangeApi.isCollapsed(at)) {
    return null
  }

  if (!hanging) {
    const [, end] = RangeApi.edges(at)
    const endOfDocument = EditorApi.point(editor, [], { edge: 'end' })

    if (!PointApi.equals(end, endOfDocument)) {
      at = EditorApi.unhangRange(editor, at, { voids })
    }
  }

  let [start, end] = RangeApi.edges(at)
  const startBlock = EditorApi.above(editor, {
    at: start,
    match: (node) => NodeApi.isElement(node) && EditorApi.isBlock(editor, node),
    mode: 'highest',
    voids,
  })
  const endBlock = EditorApi.above(editor, {
    at: end,
    match: (node) => NodeApi.isElement(node) && EditorApi.isBlock(editor, node),
    mode: 'highest',
    voids,
  })
  const startMergeBlock = EditorApi.above(editor, {
    at: start,
    match: (node) => NodeApi.isElement(node) && EditorApi.isBlock(editor, node),
    mode: 'lowest',
    voids,
  })
  const endMergeBlock = EditorApi.above(editor, {
    at: end,
    match: (node) => NodeApi.isElement(node) && EditorApi.isBlock(editor, node),
    mode: 'lowest',
    voids,
  })
  const prefersLowestMergeBlocks =
    startMergeBlock &&
    endMergeBlock &&
    startMergeBlock[1].length === endMergeBlock[1].length &&
    !PathApi.equals(startMergeBlock[1], endMergeBlock[1])
  const effectiveStartBlock = prefersLowestMergeBlocks
    ? startMergeBlock
    : startBlock
  const effectiveEndBlock = prefersLowestMergeBlocks ? endMergeBlock : endBlock
  const isAcrossBlocks =
    !!effectiveStartBlock &&
    !!effectiveEndBlock &&
    !PathApi.equals(effectiveStartBlock[1], effectiveEndBlock[1])
  const isSingleText = PathApi.equals(start.path, end.path)
  const startNonEditable = voids
    ? undefined
    : getHighestNonEditable(editor, start)
  const endNonEditable = voids ? undefined : getHighestNonEditable(editor, end)

  if (startNonEditable) {
    const before = EditorApi.before(editor, start)

    if (
      before &&
      startBlock &&
      PathApi.isAncestor(startBlock[1], before.path)
    ) {
      start = before
    }
  }

  if (endNonEditable) {
    const after = EditorApi.after(editor, end)

    if (after && endBlock && PathApi.isAncestor(endBlock[1], after.path)) {
      end = after
    }
  }

  const preserveEndBlock =
    !hanging &&
    !isCollapsed &&
    !!effectiveEndBlock &&
    PointApi.equals(
      end,
      EditorApi.point(editor, effectiveEndBlock[1], { edge: 'start' })
    )
  const originalHangingBlockRange =
    !!initialAt &&
    Location.isRange(initialAt) &&
    !RangeApi.isCollapsed(initialAt) &&
    (() => {
      const [, originalEnd] = RangeApi.edges(initialAt)
      const originalEndBlock = EditorApi.above(editor, {
        at: originalEnd,
        match: (node) =>
          NodeApi.isElement(node) && EditorApi.isBlock(editor, node),
        mode: 'highest',
        voids,
      })

      return (
        !!originalEndBlock &&
        !!effectiveStartBlock &&
        !PathApi.equals(effectiveStartBlock[1], originalEndBlock[1]) &&
        PointApi.equals(
          originalEnd,
          EditorApi.point(editor, originalEndBlock[1], { edge: 'start' })
        )
      )
    })()
  const preserveEmptyStartBlockPath =
    shouldPreserveEmptyStartBlockForHangingRange(
      editor,
      start,
      isSingleText,
      isAcrossBlocks,
      preserveEndBlock,
      originalHangingBlockRange,
      effectiveStartBlock
    )
  const preservedEmptyStartBlock =
    preserveEmptyStartBlockPath &&
    effectiveStartBlock &&
    NodeApi.isElement(effectiveStartBlock[0])
      ? ({
          ...effectiveStartBlock[0],
          children: [{ text: '' }],
        } as SlateElement)
      : null

  return {
    kind: 'range',
    initialAt,
    reverse,
    unit,
    distance,
    voids,
    isCollapsed,
    start,
    end,
    effectiveRange: { anchor: start, focus: end },
    isSingleText,
    isAcrossBlocks,
    startNonEditable,
    endNonEditable,
    preserveEndBlock,
    preserveEmptyStartBlockPath,
    preservedEmptyStartBlock,
    startMergeBlockPath: startMergeBlock?.[1] ?? null,
    effectiveStartBlockPath: effectiveStartBlock?.[1] ?? null,
    effectiveEndBlockPath: effectiveEndBlock?.[1] ?? null,
    removedInteriorElementSiblingStructure:
      shouldKeepSplitTextAfterInteriorElementRemoval(
        editor,
        start,
        end,
        isAcrossBlocks
      ),
  }
}

const deletePathTarget = (
  editor: Editor,
  target: DeletePathTarget,
  tx: TransactionWriter
) => {
  const fallbackRef = target.fallbackPoint
    ? EditorApi.pointRef(editor, target.fallbackPoint)
    : null

  tx.apply({
    type: 'remove_node',
    path: target.path,
    node: getCurrentNode(editor, target.path) as Descendant,
  })

  if (EditorApi.hasPath(editor, target.path)) {
    maybeMergeAdjacentTextAt(editor, target.path)
  }

  const fallbackPoint = fallbackRef?.unref()

  if (fallbackPoint) {
    tx.setSelection({
      anchor: fallbackPoint,
      focus: fallbackPoint,
    })
  }
}

const collectDeleteMatchPaths = (editor: Editor, plan: DeleteRangePlan) => {
  const matches: Path[] = []
  let lastPath: Path | undefined
  const addMatch = (path: Path) => {
    if (!matches.some((match) => PathApi.equals(match, path))) {
      matches.push(path)
    }
    lastPath = path
  }
  const maybeAddFullySelectedInline = (path: Path) => {
    if (!EditorApi.hasPath(editor, path)) {
      return
    }

    const node = getCurrentNode(editor, path)

    if (!NodeApi.isElement(node) || !getEditorSchema(editor).isInline(node)) {
      return
    }

    const inlineStart = EditorApi.point(editor, path, { edge: 'start' })
    const inlineEnd = EditorApi.point(editor, path, { edge: 'end' })
    const [rangeStart, rangeEnd] = RangeApi.edges(plan.effectiveRange)

    if (
      PointApi.compare(rangeStart, inlineStart) <= 0 &&
      PointApi.compare(rangeEnd, inlineEnd) >= 0 &&
      (PointApi.compare(rangeStart, inlineStart) < 0 ||
        PointApi.compare(rangeEnd, inlineEnd) > 0)
    ) {
      addMatch(path)
    }
  }

  for (const [node, path] of getNodes(editor, {
    at: plan.effectiveRange,
    voids: plan.voids,
  })) {
    if (lastPath && PathApi.compare(path, lastPath) === 0) {
      continue
    }

    if (
      plan.preserveEndBlock &&
      plan.effectiveEndBlockPath &&
      PathApi.isAncestor(plan.effectiveEndBlockPath, path)
    ) {
      lastPath = path
      continue
    }

    if (NodeApi.isElement(node) && getEditorSchema(editor).isInline(node)) {
      const inlineStart = EditorApi.point(editor, path, { edge: 'start' })
      const inlineEnd = EditorApi.point(editor, path, { edge: 'end' })
      const [rangeStart, rangeEnd] = RangeApi.edges(plan.effectiveRange)

      if (
        PointApi.compare(rangeStart, inlineStart) <= 0 &&
        PointApi.compare(rangeEnd, inlineEnd) >= 0 &&
        (PointApi.compare(rangeStart, inlineStart) < 0 ||
          PointApi.compare(rangeEnd, inlineEnd) > 0)
      ) {
        addMatch(path)
        continue
      }
    }

    if (
      !PathApi.isCommon(path, plan.start.path) &&
      !PathApi.isCommon(path, plan.end.path)
    ) {
      addMatch(path)
      continue
    }

    if (
      !plan.voids &&
      NodeApi.isElement(node) &&
      (getEditorSchema(editor).isVoid(node) ||
        getEditorSchema(editor).isReadOnly(node))
    ) {
      addMatch(path)
    }
  }

  for (const point of [plan.start, plan.end]) {
    for (let depth = point.path.length - 1; depth > 0; depth -= 1) {
      maybeAddFullySelectedInline(point.path.slice(0, depth) as Path)
    }
  }

  return matches
}

const removeDeleteContents = (
  editor: Editor,
  plan: DeleteRangePlan,
  tx: TransactionWriter
) => {
  const deleteMatchPaths = collectDeleteMatchPaths(editor, plan)
  const skipStartText = deleteMatchPaths.some((path) =>
    PathApi.isCommon(path, plan.start.path)
  )
  const skipEndText = deleteMatchPaths.some((path) =>
    PathApi.isCommon(path, plan.end.path)
  )
  const pathRefs = deleteMatchPaths.map((path) =>
    EditorApi.pathRef(editor, path)
  )
  const startRef = EditorApi.pointRef(editor, plan.start)
  const endRef = EditorApi.pointRef(editor, plan.end)
  let removedText = ''

  if (!plan.isSingleText && !plan.startNonEditable && !skipStartText) {
    const point = startRef.current!
    const [node] = EditorApi.leaf(editor, point)
    const text = node.text.slice(plan.start.offset)

    if (text.length > 0) {
      tx.apply({
        type: 'remove_text',
        path: point.path,
        offset: plan.start.offset,
        text,
      })
      removedText = text
    }
  }

  pathRefs
    .slice()
    .reverse()
    .map((ref) => ref.unref())
    .filter((path): path is Path => path !== null)
    .forEach((path) => {
      tx.apply({
        type: 'remove_node',
        path,
        node: getCurrentNode(editor, path) as Descendant,
      })
    })

  if (!plan.endNonEditable && !plan.preserveEndBlock && !skipEndText) {
    const point =
      resolveRemovalEndPoint(editor, plan, startRef.current, endRef.current) ??
      getLivePoint(editor, startRef.current)

    if (!point) {
      throw new Error('deleteAt could not resolve a surviving end point')
    }

    const [node] = EditorApi.leaf(editor, point)
    const offset = plan.isSingleText ? plan.start.offset : 0
    const text = node.text.slice(offset, plan.end.offset)

    if (text.length > 0) {
      tx.apply({
        type: 'remove_text',
        path: point.path,
        offset,
        text,
      })
      removedText = text
    }
  }

  return {
    startRef,
    endRef,
    removedText,
  }
}

const reconcileDeleteStructure = (
  editor: Editor,
  plan: DeleteRangePlan,
  removal: ReturnType<typeof removeDeleteContents>
) => {
  if (!plan.isSingleText && plan.isAcrossBlocks) {
    const mergePoint = shouldMergeAcrossBlocks(plan)
      ? resolveMergePoint(
          editor,
          plan,
          removal.startRef.current,
          removal.endRef.current
        )
      : null

    if (plan.preserveEmptyStartBlockPath) {
      removeEmptyStructuralArtifacts(editor, plan.preserveEmptyStartBlockPath)
      mergeAdjacentTextRuns(editor)
    } else if (plan.preserveEndBlock && mergePoint) {
      mergeBlocksAtPoint(editor, mergePoint, plan.voids)
      removeEmptyStructuralArtifacts(editor, plan.preserveEmptyStartBlockPath)
      mergeAdjacentTextRuns(editor)
    } else if (plan.voids && mergePoint && plan.effectiveEndBlockPath) {
      mergeNodes(editor, {
        at: plan.effectiveEndBlockPath,
      })
      removeEmptyStructuralArtifacts(editor, plan.preserveEmptyStartBlockPath)
      mergeAdjacentTextRuns(editor)
    } else if (mergePoint) {
      mergeBlocksAtPoint(editor, mergePoint, plan.voids)
      removeEmptyStructuralArtifacts(editor, plan.preserveEmptyStartBlockPath)
      mergeAdjacentTextRuns(editor)
    } else {
      removeEmptyStructuralArtifacts(editor, plan.preserveEmptyStartBlockPath)

      if (!plan.startNonEditable && !plan.endNonEditable) {
        mergeAdjacentTextRuns(editor)
      }
    }
  } else if (!plan.isSingleText) {
    removeEmptyStructuralArtifacts(
      editor,
      plan.startMergeBlockPath,
      plan.effectiveStartBlockPath
    )

    if (!plan.removedInteriorElementSiblingStructure) {
      mergeAdjacentTextRuns(editor)
    }
  }

  restorePreservedEmptyStartBlock(
    editor,
    plan.preserveEmptyStartBlockPath,
    plan.preservedEmptyStartBlock
  )

  if (plan.initialAt == null) {
    maybeMergeAdjacentTextAt(editor, removal.endRef.current?.path)
  }
}

const resolveDeleteSelection = (
  editor: Editor,
  plan: DeleteRangePlan,
  removal: ReturnType<typeof removeDeleteContents>,
  tx: TransactionWriter
) => {
  const startPoint = removal.startRef.unref()
  const endPoint = removal.endRef.unref()
  const currentSelection = getCurrentSelection(editor)
  const collapseTarget =
    !plan.isCollapsed &&
    currentSelection &&
    (plan.startNonEditable != null || plan.endNonEditable != null)
      ? currentSelection.anchor
      : !plan.isCollapsed && EditorApi.hasPath(editor, plan.start.path)
        ? { path: [...plan.start.path], offset: plan.start.offset }
        : (startPoint ?? endPoint)
  let point = normalizeFinalDeletePoint(editor, collapseTarget, {
    reverse: plan.reverse,
    allowForwardBoundaryJump:
      (plan.initialAt != null && Location.isPoint(plan.initialAt)) ||
      (plan.initialAt != null &&
        Location.isRange(plan.initialAt) &&
        RangeApi.isCollapsed(plan.initialAt)),
  })

  if (!plan.reverse && !plan.isCollapsed) {
    point = moveLeadingSpacerPointIntoFollowingInline(editor, point)
  }

  if (!plan.reverse && plan.isCollapsed) {
    point = moveTrailingTextPointIntoFollowingInline(editor, point)
  }

  if (!plan.reverse && !plan.isCollapsed && plan.isAcrossBlocks) {
    point = movePointToFollowingInline(editor, point)
  }

  if (
    plan.reverse &&
    plan.unit === 'character' &&
    point &&
    point.path.length >= 2
  ) {
    const parentPath = point.path.slice(0, -1) as Path

    if (EditorApi.hasPath(editor, parentPath)) {
      const parent = getCurrentNode(editor, parentPath)

      if (
        NodeApi.isElement(parent) &&
        getEditorSchema(editor).isInline(parent) &&
        PointApi.equals(
          point,
          EditorApi.point(editor, parentPath, { edge: 'start' })
        )
      ) {
        const previousSiblingPath =
          parentPath.at(-1) === 0 ? null : PathApi.previous(parentPath)

        if (
          previousSiblingPath &&
          EditorApi.hasPath(editor, previousSiblingPath)
        ) {
          const previousSibling = getCurrentNode(editor, previousSiblingPath)

          if (isTextNode(previousSibling) && previousSibling.text === '') {
            const nextSiblingPath =
              parentPath.at(-1) == null ? null : PathApi.next(parentPath)

            if (nextSiblingPath && EditorApi.hasPath(editor, nextSiblingPath)) {
              const nextSibling = getCurrentNode(editor, nextSiblingPath)

              if (isTextNode(nextSibling) && nextSibling.text === '') {
                point = { path: [...point.path], offset: point.offset }
              } else {
                point = { path: previousSiblingPath, offset: 0 }
              }
            } else {
              point = { path: previousSiblingPath, offset: 0 }
            }
          }
        }
      }
    }
  }

  if ((!plan.initialAt || !Location.isPath(plan.initialAt)) && point) {
    tx.setSelection({
      anchor: point,
      focus: point,
    })
  }

  const finalSelection = getCurrentSelection(editor)

  if (finalSelection && RangeApi.isCollapsed(finalSelection)) {
    let normalizedSelectionPoint = normalizeFinalDeletePoint(
      editor,
      finalSelection.anchor,
      {
        reverse: plan.reverse,
        allowForwardBoundaryJump:
          (plan.initialAt != null && Location.isPoint(plan.initialAt)) ||
          (plan.initialAt != null &&
            Location.isRange(plan.initialAt) &&
            RangeApi.isCollapsed(plan.initialAt)),
      }
    )

    if (!plan.reverse && !plan.isCollapsed) {
      normalizedSelectionPoint = moveLeadingSpacerPointIntoFollowingInline(
        editor,
        normalizedSelectionPoint
      )
    }

    if (!plan.reverse && plan.isCollapsed) {
      normalizedSelectionPoint = moveTrailingTextPointIntoFollowingInline(
        editor,
        normalizedSelectionPoint
      )
    }

    if (!plan.reverse && !plan.isCollapsed && plan.isAcrossBlocks) {
      normalizedSelectionPoint = movePointToFollowingInline(
        editor,
        normalizedSelectionPoint
      )
    }

    if (
      normalizedSelectionPoint &&
      !PointApi.equals(normalizedSelectionPoint, finalSelection.anchor)
    ) {
      tx.setSelection({
        anchor: normalizedSelectionPoint,
        focus: normalizedSelectionPoint,
      })
    }
  }
}

const cleanupDeleteLeafLifecycle = (editor: Editor, plan: DeleteRangePlan) => {
  cleanupTextLeafLifecycle(editor, {
    affinity: plan.reverse ? 'backward' : 'forward',
  })
}

const normalizeFinalDeletePoint = (
  editor: Editor,
  point: import('../interfaces').Point | null | undefined,
  options: { reverse: boolean; allowForwardBoundaryJump: boolean }
) => {
  if (!point) {
    return point
  }

  if (!EditorApi.hasPath(editor, point.path as Path)) {
    return EditorApi.getChildren(editor).length > 0
      ? EditorApi.point(editor, [], { edge: 'start' })
      : point
  }

  if (point.offset === 0 && point.path.length > 0) {
    const previousSiblingPath =
      point.path.at(-1) === 0 ? null : PathApi.previous(point.path as Path)

    if (previousSiblingPath && EditorApi.hasPath(editor, previousSiblingPath)) {
      const previousSibling = getCurrentNode(editor, previousSiblingPath)

      if (
        NodeApi.isElement(previousSibling) &&
        getEditorSchema(editor).isInline(previousSibling) &&
        !getEditorSchema(editor).isVoid(previousSibling) &&
        NodeApi.string(previousSibling) === ''
      ) {
        return EditorApi.point(editor, previousSiblingPath, { edge: 'start' })
      }
    }

    const nextSiblingPath =
      point.path.at(-1) == null ? null : PathApi.next(point.path as Path)

    if (nextSiblingPath && EditorApi.hasPath(editor, nextSiblingPath)) {
      const nextSibling = getCurrentNode(editor, nextSiblingPath)

      if (
        NodeApi.isElement(nextSibling) &&
        getEditorSchema(editor).isInline(nextSibling) &&
        !getEditorSchema(editor).isVoid(nextSibling) &&
        NodeApi.string(nextSibling) === ''
      ) {
        return EditorApi.point(editor, nextSiblingPath, { edge: 'start' })
      }
    }
  }

  if (!options.reverse) {
    if (
      !options.allowForwardBoundaryJump &&
      point.path.length >= 2 &&
      EditorApi.hasPath(editor, point.path as Path) &&
      isTextNode(getCurrentNode(editor, point.path as Path))
    ) {
      const currentTextNode = getCurrentNode(editor, point.path as Path)
      const parentPath = point.path.slice(0, -1) as Path

      if (EditorApi.hasPath(editor, parentPath)) {
        const parent = getCurrentNode(editor, parentPath)

        if (
          NodeApi.isElement(parent) &&
          getEditorSchema(editor).isInline(parent) &&
          isTextNode(currentTextNode) &&
          point.offset === currentTextNode.text.length
        ) {
          const spacerPath =
            parentPath.at(-1) == null ? null : PathApi.next(parentPath)

          if (spacerPath && EditorApi.hasPath(editor, spacerPath)) {
            const spacer = getCurrentNode(editor, spacerPath)

            if (isTextNode(spacer) && spacer.text === '') {
              const nextSiblingPath =
                spacerPath.at(-1) == null ? null : PathApi.next(spacerPath)

              if (
                nextSiblingPath &&
                EditorApi.hasPath(editor, nextSiblingPath)
              ) {
                const nextSibling = getCurrentNode(editor, nextSiblingPath)

                if (
                  NodeApi.isElement(nextSibling) &&
                  getEditorSchema(editor).isInline(nextSibling)
                ) {
                  return EditorApi.point(editor, nextSiblingPath, {
                    edge: 'start',
                  })
                }
              }
            }
          }
        }
      }
    }

    if (
      point.path.length > 0 &&
      EditorApi.hasPath(editor, point.path as Path) &&
      isTextNode(getCurrentNode(editor, point.path as Path))
    ) {
      const parentPath = point.path.slice(0, -1) as Path

      if (EditorApi.hasPath(editor, parentPath)) {
        const parent = getCurrentNode(editor, parentPath)

        if (
          NodeApi.isElement(parent) &&
          getEditorSchema(editor).isInline(parent) &&
          getEditorSchema(editor).isVoid(parent) &&
          PointApi.equals(
            point,
            EditorApi.point(editor, parentPath, { edge: 'start' })
          )
        ) {
          const previousSiblingPath =
            parentPath.at(-1) === 0 ? null : PathApi.previous(parentPath)

          if (
            previousSiblingPath &&
            EditorApi.hasPath(editor, previousSiblingPath)
          ) {
            return EditorApi.point(editor, previousSiblingPath, { edge: 'end' })
          }
        }
      }
    }

    if (!options.allowForwardBoundaryJump) {
      return point
    }

    if (point.path.length > 0) {
      const currentNode = getCurrentNode(editor, point.path as Path)
      const nextSiblingPath =
        point.path.at(-1) == null ? null : PathApi.next(point.path as Path)

      if (
        isTextNode(currentNode) &&
        point.offset === currentNode.text.length &&
        nextSiblingPath &&
        EditorApi.hasPath(editor, nextSiblingPath)
      ) {
        const nextSibling = getCurrentNode(editor, nextSiblingPath)

        if (
          NodeApi.isElement(nextSibling) &&
          (!getEditorSchema(editor).isInline(nextSibling) ||
            getEditorSchema(editor).isVoid(nextSibling))
        ) {
          return EditorApi.point(editor, nextSiblingPath, { edge: 'start' })
        }
      }

      if (point.path.length >= 2) {
        const parentPath = point.path.slice(0, -1) as Path

        if (EditorApi.hasPath(editor, parentPath)) {
          const parent = getCurrentNode(editor, parentPath)

          if (
            NodeApi.isElement(parent) &&
            parentPath.length > 1 &&
            PointApi.equals(
              point,
              EditorApi.point(editor, parentPath, { edge: 'end' })
            )
          ) {
            if (
              getEditorSchema(editor).isInline(parent) &&
              !getEditorSchema(editor).isVoid(parent) &&
              NodeApi.string(parent) === ''
            ) {
              return point
            }

            const afterParentPath =
              parentPath.at(-1) == null ? null : PathApi.next(parentPath)

            if (afterParentPath && EditorApi.hasPath(editor, afterParentPath)) {
              return EditorApi.point(editor, afterParentPath, { edge: 'start' })
            }
          }
        }
      }
    }

    return point
  }

  if (
    EditorApi.hasPath(editor, point.path as Path) &&
    point.path.length >= 2 &&
    isTextNode(getCurrentNode(editor, point.path as Path)) &&
    (() => {
      const parentPath = point.path.slice(0, -1) as Path

      if (!EditorApi.hasPath(editor, parentPath) || parentPath.at(-1) === 0) {
        return false
      }

      const parent = getCurrentNode(editor, parentPath)

      return (
        NodeApi.isElement(parent) &&
        !(
          getEditorSchema(editor).isInline(parent) &&
          !getEditorSchema(editor).isVoid(parent) &&
          NodeApi.string(parent) === ''
        ) &&
        parentPath.length > 1 &&
        PointApi.equals(
          point,
          EditorApi.point(editor, parentPath, { edge: 'end' })
        )
      )
    })()
  ) {
    const parentPath = point.path.slice(0, -1) as Path
    const nextSiblingPath =
      parentPath.at(-1) == null ? null : PathApi.next(parentPath)

    if (nextSiblingPath && EditorApi.hasPath(editor, nextSiblingPath)) {
      const nextSibling = getCurrentNode(editor, nextSiblingPath)

      if (isTextNode(nextSibling) && nextSibling.text.length > 0) {
        return EditorApi.point(editor, nextSiblingPath, { edge: 'start' })
      }
    }
  }

  if (point.offset !== 0 || point.path.length < 2) {
    if (point.offset !== 0 || point.path.length === 0) {
      return point
    }

    const currentNode = EditorApi.hasPath(editor, point.path as Path)
      ? getCurrentNode(editor, point.path as Path)
      : null

    if (currentNode && isTextNode(currentNode) && currentNode.text === '') {
      return point
    }

    const nextSiblingPath =
      point.path.at(-1) == null ? null : PathApi.next(point.path)

    if (!nextSiblingPath || !EditorApi.hasPath(editor, nextSiblingPath)) {
      return point
    }

    const nextSibling = getCurrentNode(editor, nextSiblingPath)

    return NodeApi.isElement(nextSibling) &&
      getEditorSchema(editor).isInline(nextSibling) &&
      nextSibling.children.length > 0
      ? EditorApi.point(editor, nextSiblingPath, { edge: 'start' })
      : point
  }

  const parentPath = point.path.slice(0, -1) as Path

  if (!EditorApi.hasPath(editor, parentPath) || parentPath.at(-1) === 0) {
    return point
  }

  const parent = getCurrentNode(editor, parentPath)

  if (!NodeApi.isElement(parent) || !getEditorSchema(editor).isInline(parent)) {
    return point
  }

  if (
    !getEditorSchema(editor).isVoid(parent) &&
    NodeApi.string(parent) === ''
  ) {
    return point
  }

  if (
    point.offset === 0 &&
    isTextNode(getCurrentNode(editor, point.path as Path))
  ) {
    const previousSiblingPath =
      parentPath.at(-1) === 0 ? null : PathApi.previous(parentPath)

    if (previousSiblingPath && EditorApi.hasPath(editor, previousSiblingPath)) {
      const previousSibling = getCurrentNode(editor, previousSiblingPath)

      if (isTextNode(previousSibling) && previousSibling.text === '') {
        const nextSiblingPath =
          parentPath.at(-1) == null ? null : PathApi.next(parentPath)

        if (nextSiblingPath && EditorApi.hasPath(editor, nextSiblingPath)) {
          const nextSibling = getCurrentNode(editor, nextSiblingPath)

          if (isTextNode(nextSibling) && nextSibling.text === '') {
            return point
          }
        }

        return { path: previousSiblingPath, offset: 0 }
      }
    }
  }

  if (
    isTextNode(getCurrentNode(editor, point.path as Path)) &&
    PointApi.equals(point, EditorApi.point(editor, point.path, { edge: 'end' }))
  ) {
    const nextSiblingPath =
      parentPath.at(-1) == null ? null : PathApi.next(parentPath)

    if (nextSiblingPath && EditorApi.hasPath(editor, nextSiblingPath)) {
      const nextSibling = getCurrentNode(editor, nextSiblingPath)

      if (isTextNode(nextSibling) && nextSibling.text.length > 0) {
        return EditorApi.point(editor, nextSiblingPath, { edge: 'start' })
      }
    }
  }

  const previousSiblingPath = PathApi.previous(parentPath)

  if (!EditorApi.hasPath(editor, previousSiblingPath)) {
    return point
  }

  const previousSibling = getCurrentNode(editor, previousSiblingPath)

  return isTextNode(previousSibling) && previousSibling.text === ''
    ? { path: previousSiblingPath, offset: 0 }
    : point
}

const getCollapsedDeleteTarget = (
  editor: Editor,
  at: import('../interfaces').Point,
  options: {
    reverse: boolean
    distance: number
    unit: NonNullable<
      TextMutationMethods['delete'] extends (
        editor: Editor,
        options?: infer T
      ) => unknown
        ? T extends { unit?: infer U }
          ? U
          : never
        : never
    >
    voids: boolean
  }
) => {
  const { reverse, distance, unit, voids } = options
  const pointTarget = reverse
    ? (EditorApi.before(editor, at, { distance, unit, voids }) ??
      EditorApi.point(editor, [], { edge: 'start' }))
    : (EditorApi.after(editor, at, { distance, unit, voids }) ??
      EditorApi.point(editor, [], { edge: 'end' }))

  if (unit !== 'character' || distance !== 1) {
    return pointTarget
  }

  const [leaf] = EditorApi.leaf(editor, at)
  const atBoundary = reverse ? at.offset === 0 : at.offset === leaf.text.length

  if (!atBoundary) {
    return pointTarget
  }

  const offsetTarget = reverse
    ? EditorApi.before(editor, at, { distance, unit: 'offset', voids })
    : EditorApi.after(editor, at, { distance, unit: 'offset', voids })

  if (!offsetTarget) {
    return pointTarget
  }

  if (crossesIsolatingBoundary(editor, at, pointTarget, voids)) {
    return at
  }

  const currentBlock = EditorApi.above(editor, {
    at,
    match: (node) => NodeApi.isElement(node) && EditorApi.isBlock(editor, node),
    mode: 'lowest',
    voids,
  })
  const targetBlock = EditorApi.above(editor, {
    at: pointTarget,
    match: (node) => NodeApi.isElement(node) && EditorApi.isBlock(editor, node),
    mode: 'lowest',
    voids,
  })

  if (
    currentBlock &&
    targetBlock &&
    ((reverse &&
      PointApi.equals(
        at,
        EditorApi.point(editor, currentBlock[1], { edge: 'start' })
      )) ||
      (!reverse &&
        PointApi.equals(
          at,
          EditorApi.point(editor, currentBlock[1], { edge: 'end' })
        ))) &&
    !PathApi.equals(currentBlock[1], targetBlock[1])
  ) {
    return offsetTarget
  }

  return pointTarget
}

const mergeBlocksAtPoint = (
  editor: Editor,
  point: import('../interfaces').Point,
  voids: boolean
) => {
  mergeNodes(editor, {
    at: point,
    hanging: true,
    voids,
  })
}

const getWholeTopLevelBlockRange = (editor: Editor, plan: DeleteRangePlan) => {
  if (
    plan.isCollapsed ||
    plan.startNonEditable ||
    plan.endNonEditable ||
    plan.preserveEmptyStartBlockPath ||
    !plan.isAcrossBlocks
  ) {
    return null
  }

  const startIndex = plan.start.path[0]
  const endIndex = plan.end.path[0]
  const editorChildren = EditorApi.getChildren(editor)

  if (
    startIndex == null ||
    endIndex == null ||
    (startIndex === 0 && endIndex === editorChildren.length - 1)
  ) {
    return null
  }

  if (
    !PointApi.equals(
      plan.start,
      EditorApi.point(editor, [startIndex], { edge: 'start' })
    ) ||
    !PointApi.equals(
      plan.end,
      EditorApi.point(editor, [endIndex], { edge: 'end' })
    )
  ) {
    return null
  }

  for (let index = startIndex; index <= endIndex; index += 1) {
    const node = editorChildren[index]

    if (!NodeApi.isElement(node) || !EditorApi.isBlock(editor, node)) {
      return null
    }
  }

  return { endIndex, startIndex }
}

const deleteWholeTopLevelBlockRange = (
  editor: Editor,
  range: NonNullable<ReturnType<typeof getWholeTopLevelBlockRange>>,
  tx: TransactionWriter
) => {
  const children = EditorApi.getChildren(editor)
  const preferNext = range.endIndex + 1 < children.length
  const selectionPath = preferNext
    ? [range.endIndex + 1]
    : [range.startIndex - 1]
  const selectionPoint = EditorApi.point(editor, selectionPath, {
    edge: preferNext ? 'start' : 'end',
  })
  const newSelectionPoint = {
    ...selectionPoint,
    path: preferNext
      ? [range.startIndex, ...selectionPoint.path.slice(1)]
      : selectionPoint.path,
  }

  tx.apply({
    children: children.slice(range.startIndex, range.endIndex + 1),
    index: range.startIndex,
    newChildren: [],
    newSelection: {
      anchor: newSelectionPoint,
      focus: newSelectionPoint,
    },
    path: [],
    selection: getCurrentSelection(editor),
    type: 'replace_children',
  })
}

export const deleteText: TextMutationMethods['delete'] = (
  editor,
  options = {}
) => {
  runEditorTransaction(editor, (tx) => {
    const at = tx.resolveTarget({ at: options.at })

    if (!at) {
      return
    }

    const target = resolveDeleteTarget(editor, options, at)

    if (!target) {
      return
    }

    if (target.kind === 'path') {
      deletePathTarget(editor, target, tx)
      return
    }

    const wholeTopLevelBlockRange = getWholeTopLevelBlockRange(editor, target)

    if (wholeTopLevelBlockRange) {
      deleteWholeTopLevelBlockRange(editor, wholeTopLevelBlockRange, tx)
      return
    }

    const removal = removeDeleteContents(editor, target, tx)

    reconcileDeleteStructure(editor, target, removal)
    cleanupDeleteLeafLifecycle(editor, target)
    resolveDeleteSelection(editor, target, removal, tx)
  })
}
