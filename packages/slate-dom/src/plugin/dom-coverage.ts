import {
  PathApi,
  type Point,
  RangeApi,
  type RuntimeId,
  type Editor as SlateEditor,
  type Path as SlatePath,
  type Range as SlateRange,
} from 'slate'
import { Editor, getSnapshotVersion } from 'slate/internal'

import {
  type DOMElement,
  type DOMPoint,
  type DOMRange,
  isDOMElement,
} from '../utils/dom'
import { IS_COMPOSING } from '../utils/weak-maps'
import type { DOMEditor as DOMEditorType } from './dom-editor'

export const DOM_COVERAGE_BOUNDARY_ATTRIBUTE =
  'data-slate-dom-coverage-boundary'
export const DOM_COVERAGE_BOUNDARY_EDGE_ATTRIBUTE =
  'data-slate-dom-coverage-edge'

export type DOMCoverageBoundaryState =
  | 'mounted'
  | 'intentionally-hidden'
  | 'pending-mount'
  | 'virtualized'
  | 'atom-boundary'

export type DOMCoverageReason =
  | 'app-collapse'
  | 'app-hidden'
  | 'rendering-staged'
  | 'viewport-virtualization'
  | 'shell-aggressive'
  | 'runtime-atom'

export type DOMCoverageSelectionPolicy =
  | 'materialize'
  | 'boundary'
  | 'model-backed'

export type DOMCoverageCopyPolicy =
  | 'include-model'
  | 'summary-only'
  | 'exclude'
  | 'materialize'

export type DOMCoverageFindPolicy =
  | 'native'
  | 'not-native-until-mounted'
  | 'custom'

export interface DOMCoveragePathRange {
  anchor: SlatePath
  focus: SlatePath
}

export interface DOMCoverageRuntimeRange {
  anchor: RuntimeId
  focus: RuntimeId
}

export type DOMCoverageBoundaryAnchor =
  | { type: 'owner' }
  | { runtimeId: RuntimeId; type: 'summary-slot' }
  | { runtimeId?: RuntimeId; type: 'placeholder' }

export interface DOMCoverageBoundary {
  boundaryId: string
  ownerRuntimeId: RuntimeId | null
  ownerPath: SlatePath
  coveredPathRanges: readonly DOMCoveragePathRange[]
  coveredRuntimeRanges: readonly DOMCoverageRuntimeRange[]
  state: DOMCoverageBoundaryState
  reason: DOMCoverageReason
  anchor: DOMCoverageBoundaryAnchor
  selectionPolicy: DOMCoverageSelectionPolicy
  copyPolicy: DOMCoverageCopyPolicy
  findPolicy: DOMCoverageFindPolicy
  version: number
}

export type DOMCoverageDOMPointResult =
  | { domPoint: DOMPoint; type: 'dom-point' }
  | { boundary: DOMCoverageBoundary; point: Point; type: 'boundary' }

export type DOMCoverageBoundaryEdge = 'anchor' | 'focus' | 'owner'

export type DOMCoverageDOMRangeResult =
  | { domRange: DOMRange; type: 'dom-range' }
  | {
      boundaries: readonly DOMCoverageBoundary[]
      range: SlateRange
      type: 'boundary-range'
    }

export type DOMCoverageSlatePointResult =
  | { point: Point; type: 'slate-point' }
  | {
      boundary: DOMCoverageBoundary
      domPoint: DOMPoint
      edge: DOMCoverageBoundaryEdge
      type: 'boundary-point'
    }

export type DOMCoverageMaterializeReason =
  | 'selection'
  | 'copy'
  | 'paste'
  | 'focus'
  | 'programmatic'
  | 'background'

export type DOMCoverageMaterializeResult =
  | {
      boundaryId: string
      reason: DOMCoverageMaterializeReason
      status: 'handled'
    }
  | {
      boundaryId: string
      reason: DOMCoverageMaterializeReason
      status: 'missing-boundary'
    }
  | {
      boundaryId: string
      reason: DOMCoverageMaterializeReason
      status: 'unhandled'
    }

export type DOMCoverageMaterializeOptions = {
  range?: SlateRange
}

export type DOMCoverageMaterializeHandler = (
  boundary: DOMCoverageBoundary,
  reason: DOMCoverageMaterializeReason,
  options: DOMCoverageMaterializeOptions
) => boolean | void

interface DOMCoverageRegistry {
  boundaries: Map<string, DOMCoverageBoundary>
  boundaryRootKeys: Map<string, Set<string>>
  boundariesByRootKey: Map<string, Set<string>>
  indexedVersion: number
  materializeHandler: DOMCoverageMaterializeHandler | null
}

const EDITOR_TO_DOM_COVERAGE_REGISTRY = new WeakMap<
  SlateEditor,
  DOMCoverageRegistry
>()

const getRegistry = (editor: SlateEditor): DOMCoverageRegistry => {
  let registry = EDITOR_TO_DOM_COVERAGE_REGISTRY.get(editor)

  if (!registry) {
    registry = {
      boundaries: new Map(),
      boundaryRootKeys: new Map(),
      boundariesByRootKey: new Map(),
      indexedVersion: getSnapshotVersion(editor),
      materializeHandler: null,
    }
    EDITOR_TO_DOM_COVERAGE_REGISTRY.set(editor, registry)
  }

  return registry
}

const rebasePathFromOwner = (
  path: SlatePath,
  previousOwnerPath: SlatePath,
  nextOwnerPath: SlatePath
) => {
  if (PathApi.equals(path, previousOwnerPath)) {
    return [...nextOwnerPath]
  }

  if (PathApi.isDescendant(path, previousOwnerPath)) {
    return [...nextOwnerPath, ...PathApi.relative(path, previousOwnerPath)]
  }

  return path
}

const resolveBoundary = (
  editor: SlateEditor,
  boundary: DOMCoverageBoundary
): DOMCoverageBoundary | null => {
  const nextOwnerPath =
    boundary.ownerRuntimeId == null
      ? boundary.ownerPath.length === 0
        ? []
        : null
      : Editor.getPathByRuntimeId(editor, boundary.ownerRuntimeId)

  if (
    !nextOwnerPath ||
    (nextOwnerPath.length > 0 && !Editor.hasPath(editor, nextOwnerPath))
  ) {
    return null
  }

  const coveredPathRanges = resolveCoveredPathRanges(
    editor,
    boundary,
    nextOwnerPath
  )

  if (!coveredPathRanges) {
    return null
  }

  return {
    ...boundary,
    coveredPathRanges,
    ownerPath: nextOwnerPath,
    version: PathApi.equals(nextOwnerPath, boundary.ownerPath)
      ? boundary.version
      : boundary.version + 1,
  }
}

const pathIsInsideOwner = (path: SlatePath, ownerPath: SlatePath) => {
  if (ownerPath.length === 0) {
    return true
  }

  return (
    PathApi.equals(path, ownerPath) || PathApi.isDescendant(path, ownerPath)
  )
}

const resolveRuntimePath = (editor: SlateEditor, runtimeId: RuntimeId) => {
  const path = Editor.getPathByRuntimeId(editor, runtimeId)

  if (!path || !Editor.hasPath(editor, path)) {
    return null
  }

  return path
}

const resolveCoveredPathRanges = (
  editor: SlateEditor,
  boundary: DOMCoverageBoundary,
  nextOwnerPath: SlatePath
): readonly DOMCoveragePathRange[] | null => {
  if (boundary.coveredRuntimeRanges.length > 0) {
    const ranges: DOMCoveragePathRange[] = []

    for (const range of boundary.coveredRuntimeRanges) {
      const anchor = resolveRuntimePath(editor, range.anchor)
      const focus = resolveRuntimePath(editor, range.focus)

      if (!anchor || !focus) {
        return null
      }

      if (
        !pathIsInsideOwner(anchor, nextOwnerPath) ||
        !pathIsInsideOwner(focus, nextOwnerPath)
      ) {
        return null
      }

      ranges.push({ anchor, focus })
    }

    return ranges
  }

  return boundary.coveredPathRanges.map((range) => ({
    anchor: rebasePathFromOwner(
      range.anchor,
      boundary.ownerPath,
      nextOwnerPath
    ),
    focus: rebasePathFromOwner(range.focus, boundary.ownerPath, nextOwnerPath),
  }))
}

const comparePathBounds = (path: SlatePath, another: SlatePath) => {
  const comparison = PathApi.compare(path, another)

  if (comparison !== 0) {
    return comparison
  }

  if (PathApi.equals(path, another)) {
    return 0
  }

  return path.length < another.length ? -1 : 1
}

const getOrderedPathRange = (
  range: DOMCoveragePathRange
): DOMCoveragePathRange => {
  if (comparePathBounds(range.anchor, range.focus) <= 0) {
    return range
  }

  return {
    anchor: range.focus,
    focus: range.anchor,
  }
}

const ROOT_KEY_PREFIX = 'root:'
const ALL_ROOTS_KEY = 'root:*'
const ROOT_SPAN_INDEX_LIMIT = 128

const getRootKey = (path: SlatePath) => `${ROOT_KEY_PREFIX}${path[0] ?? ''}`

const getRootKeysForPathRange = (range: DOMCoveragePathRange) => {
  const orderedRange = getOrderedPathRange(range)
  const start = orderedRange.anchor[0]
  const end = orderedRange.focus[0]

  if (typeof start !== 'number' || typeof end !== 'number') {
    return new Set([ALL_ROOTS_KEY])
  }

  const min = Math.min(start, end)
  const max = Math.max(start, end)

  if (max - min > ROOT_SPAN_INDEX_LIMIT) {
    return new Set([ALL_ROOTS_KEY])
  }

  return new Set(
    Array.from(
      { length: max - min + 1 },
      (_, index) => `${ROOT_KEY_PREFIX}${min + index}`
    )
  )
}

const getRootKeysForBoundary = (boundary: DOMCoverageBoundary) => {
  const rootKeys = new Set<string>()

  if (boundary.coveredPathRanges.length === 0) {
    rootKeys.add(getRootKey(boundary.ownerPath))
  }

  for (const range of boundary.coveredPathRanges) {
    for (const rootKey of getRootKeysForPathRange(range)) {
      rootKeys.add(rootKey)
    }
  }

  return rootKeys
}

const addBoundaryToIndex = (
  registry: DOMCoverageRegistry,
  boundary: DOMCoverageBoundary
) => {
  const rootKeys = getRootKeysForBoundary(boundary)

  registry.boundaryRootKeys.set(boundary.boundaryId, rootKeys)

  for (const rootKey of rootKeys) {
    let boundaryIds = registry.boundariesByRootKey.get(rootKey)

    if (!boundaryIds) {
      boundaryIds = new Set()
      registry.boundariesByRootKey.set(rootKey, boundaryIds)
    }

    boundaryIds.add(boundary.boundaryId)
  }
}

const removeBoundaryFromIndex = (
  registry: DOMCoverageRegistry,
  boundaryId: string
) => {
  const rootKeys = registry.boundaryRootKeys.get(boundaryId)

  if (!rootKeys) {
    return
  }

  for (const rootKey of rootKeys) {
    const boundaryIds = registry.boundariesByRootKey.get(rootKey)

    boundaryIds?.delete(boundaryId)

    if (boundaryIds?.size === 0) {
      registry.boundariesByRootKey.delete(rootKey)
    }
  }
  registry.boundaryRootKeys.delete(boundaryId)
}

const setRegistryBoundary = (
  registry: DOMCoverageRegistry,
  boundary: DOMCoverageBoundary
) => {
  removeBoundaryFromIndex(registry, boundary.boundaryId)
  registry.boundaries.set(boundary.boundaryId, boundary)
  addBoundaryToIndex(registry, boundary)
}

const getIndexedBoundaries = (
  registry: DOMCoverageRegistry,
  rootKeys: readonly string[]
) => {
  if (rootKeys.includes(ALL_ROOTS_KEY)) {
    return [...registry.boundaries.values()]
  }

  const boundaryIds = new Set<string>()
  const boundaries: DOMCoverageBoundary[] = []

  for (const rootKey of rootKeys) {
    registry.boundariesByRootKey.get(rootKey)?.forEach((boundaryId) => {
      boundaryIds.add(boundaryId)
    })
  }
  registry.boundariesByRootKey.get(ALL_ROOTS_KEY)?.forEach((boundaryId) => {
    boundaryIds.add(boundaryId)
  })

  boundaryIds.forEach((boundaryId) => {
    const boundary = registry.boundaries.get(boundaryId)

    if (boundary) {
      boundaries.push(boundary)
    }
  })

  return boundaries
}

const syncRegistryToEditor = (
  editor: SlateEditor,
  registry = getRegistry(editor)
) => {
  const version = getSnapshotVersion(editor)

  if (registry.indexedVersion === version) {
    return registry
  }

  const currentBoundaries = [...registry.boundaries.values()]

  registry.boundaries.clear()
  registry.boundaryRootKeys.clear()
  registry.boundariesByRootKey.clear()

  currentBoundaries.forEach((boundary) => {
    const resolved = resolveBoundary(editor, boundary)

    if (resolved) {
      setRegistryBoundary(registry, resolved)
    }
  })
  registry.indexedVersion = version

  return registry
}

const getResolvedBoundaries = (editor: SlateEditor) => {
  return [...syncRegistryToEditor(editor).boundaries.values()]
}

const pathIsCoveredByRange = (path: SlatePath, range: DOMCoveragePathRange) => {
  const orderedRange = getOrderedPathRange(range)
  const afterStart = PathApi.compare(path, orderedRange.anchor) >= 0
  const beforeEnd = PathApi.compare(path, orderedRange.focus) <= 0

  return afterStart && beforeEnd
}

const boundaryContainsPoint = (boundary: DOMCoverageBoundary, point: Point) => {
  return boundary.coveredPathRanges.some((range) =>
    pathIsCoveredByRange(point.path, range)
  )
}

const rangeIntersectsBoundary = (
  range: SlateRange,
  boundary: DOMCoverageBoundary
) => {
  if (
    boundaryContainsPoint(boundary, range.anchor) ||
    boundaryContainsPoint(boundary, range.focus)
  ) {
    return true
  }

  return boundary.coveredPathRanges.some((coveredRange) => {
    const orderedRange = getOrderedPathRange(coveredRange)

    return (
      RangeApi.includes(range, orderedRange.anchor) ||
      RangeApi.includes(range, orderedRange.focus)
    )
  })
}

const getBoundaryDepth = (boundary: DOMCoverageBoundary) => {
  const rangeDepths = boundary.coveredPathRanges.flatMap((range) => [
    range.anchor.length,
    range.focus.length,
  ])

  return Math.min(boundary.ownerPath.length, ...rangeDepths)
}

const compareBoundaries = (
  boundary: DOMCoverageBoundary,
  another: DOMCoverageBoundary
) => {
  const depth = getBoundaryDepth(boundary)
  const anotherDepth = getBoundaryDepth(another)

  if (depth !== anotherDepth) {
    return depth - anotherDepth
  }

  return boundary.boundaryId.localeCompare(another.boundaryId)
}

export const DOMCoverage = {
  boundaryEdgeAttribute: DOM_COVERAGE_BOUNDARY_EDGE_ATTRIBUTE,
  boundaryElementAttribute: DOM_COVERAGE_BOUNDARY_ATTRIBUTE,

  clear(editor: SlateEditor) {
    EDITOR_TO_DOM_COVERAGE_REGISTRY.delete(editor)
  },

  clearMaterializeHandler(editor: SlateEditor) {
    getRegistry(editor).materializeHandler = null
  },

  getBoundaries(editor: SlateEditor): readonly DOMCoverageBoundary[] {
    return getResolvedBoundaries(editor)
  },

  getBoundariesForRange(
    editor: SlateEditor,
    range: SlateRange
  ): readonly DOMCoverageBoundary[] {
    const orderedRange = getOrderedPathRange({
      anchor: range.anchor.path,
      focus: range.focus.path,
    })
    const registry = syncRegistryToEditor(editor)

    return getIndexedBoundaries(registry, [
      ...getRootKeysForPathRange(orderedRange),
    ])
      .filter((boundary) => rangeIntersectsBoundary(range, boundary))
      .sort(compareBoundaries)
  },

  getBoundary(editor: SlateEditor, boundaryId: string) {
    const registry = syncRegistryToEditor(editor)
    const boundary = registry.boundaries.get(boundaryId)

    if (!boundary) {
      return null
    }

    const resolved = resolveBoundary(editor, boundary)

    if (!resolved) {
      registry.boundaries.delete(boundaryId)
      removeBoundaryFromIndex(registry, boundaryId)
      return null
    }

    if (resolved !== boundary) {
      setRegistryBoundary(registry, resolved)
    }

    return resolved
  },

  getBoundaryForPoint(editor: SlateEditor, point: Point) {
    const registry = syncRegistryToEditor(editor)
    const [boundary] = getIndexedBoundaries(registry, [getRootKey(point.path)])
      .filter((candidate) => boundaryContainsPoint(candidate, point))
      .sort(compareBoundaries)

    return boundary ?? null
  },

  materializeBoundary(
    editor: SlateEditor,
    boundaryId: string,
    reason: DOMCoverageMaterializeReason,
    options: DOMCoverageMaterializeOptions = {}
  ): DOMCoverageMaterializeResult {
    const boundary = DOMCoverage.getBoundary(editor, boundaryId)

    if (!boundary) {
      return { boundaryId, reason, status: 'missing-boundary' }
    }

    if (IS_COMPOSING.get(editor)) {
      return { boundaryId, reason, status: 'unhandled' }
    }

    const didHandle = getRegistry(editor).materializeHandler?.(
      boundary,
      reason,
      options
    )

    return {
      boundaryId,
      reason,
      status: didHandle ? 'handled' : 'unhandled',
    }
  },

  registerBoundary(editor: SlateEditor, boundary: DOMCoverageBoundary) {
    const registry = syncRegistryToEditor(editor)

    setRegistryBoundary(registry, boundary)
    registry.indexedVersion = getSnapshotVersion(editor)

    return () => {
      DOMCoverage.unregisterBoundary(editor, boundary.boundaryId)
    }
  },

  setMaterializeHandler(
    editor: SlateEditor,
    handler: DOMCoverageMaterializeHandler
  ) {
    getRegistry(editor).materializeHandler = handler
  },

  toDOMPointOrBoundary(
    editor: DOMEditorType<any>,
    point: Point
  ): DOMCoverageDOMPointResult {
    const boundary = DOMCoverage.getBoundaryForPoint(editor, point)

    if (boundary) {
      return {
        boundary,
        point,
        type: 'boundary',
      }
    }

    return {
      domPoint: editor.dom.assertDOMPoint(point),
      type: 'dom-point',
    }
  },

  toDOMRangeOrBoundary(
    editor: DOMEditorType<any>,
    range: SlateRange
  ): DOMCoverageDOMRangeResult {
    const boundaries = DOMCoverage.getBoundariesForRange(editor, range)

    if (boundaries.length > 0) {
      return {
        boundaries,
        range,
        type: 'boundary-range',
      }
    }

    return {
      domRange: editor.dom.assertDOMRange(range),
      type: 'dom-range',
    }
  },

  toSlatePointFromBoundary(
    editor: SlateEditor,
    domPoint: DOMPoint
  ): DOMCoverageSlatePointResult | null {
    const element = getDOMCoverageElementFromPoint(domPoint)

    if (!element) {
      return null
    }

    const boundaryId = element.getAttribute(DOM_COVERAGE_BOUNDARY_ATTRIBUTE)
    const boundary = boundaryId
      ? DOMCoverage.getBoundary(editor, boundaryId)
      : null

    if (!boundary) {
      return null
    }

    return {
      boundary,
      domPoint,
      edge: getBoundaryEdge(element),
      type: 'boundary-point',
    }
  },

  unregisterBoundary(editor: SlateEditor, boundaryId: string) {
    const registry = getRegistry(editor)

    registry.boundaries.delete(boundaryId)
    removeBoundaryFromIndex(registry, boundaryId)
  },
}

const getBoundaryEdge = (element: DOMElement): DOMCoverageBoundaryEdge => {
  const edge = element.getAttribute(DOM_COVERAGE_BOUNDARY_EDGE_ATTRIBUTE)

  if (edge === 'focus' || edge === 'owner') {
    return edge
  }

  return 'anchor'
}

const getClosestDOMCoverageElement = (node: Node): DOMElement | null => {
  const element = isDOMElement(node) ? node : node.parentElement

  return element?.closest(`[${DOM_COVERAGE_BOUNDARY_ATTRIBUTE}]`) ?? null
}

const getDOMCoverageElementFromPoint = (
  domPoint: DOMPoint
): DOMElement | null => {
  const [node, offset] = domPoint
  const closest = getClosestDOMCoverageElement(node)

  if (closest) {
    return closest
  }

  if (!isDOMElement(node)) {
    return null
  }

  const adjacentNodes = [
    node.childNodes.item(offset),
    node.childNodes.item(offset - 1),
  ]

  for (const adjacentNode of adjacentNodes) {
    if (!adjacentNode) {
      continue
    }

    const adjacentElement = getClosestDOMCoverageElement(adjacentNode)

    if (adjacentElement) {
      return adjacentElement
    }
  }

  return null
}
