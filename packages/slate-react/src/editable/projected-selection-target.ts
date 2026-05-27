import {
  type Descendant,
  NodeApi,
  type Path,
  type Point,
  type Range,
  type RootKey,
} from 'slate'

import type {
  SlateProjectedPoint,
  SlateProjectionGraphRangeEndpoint,
  SlateProjectionGraphRangeSegment,
} from '../projection-graph'
import {
  collapseSlateViewSelection,
  type SlateViewSelection,
} from '../view-selection'
import type { Editor as RuntimeEditor } from './runtime-editor-api'

const MAIN_ROOT_KEY: RootKey = 'main'

const cloneRootedPoint = (point: Point, root: RootKey): Point => ({
  ...(root === MAIN_ROOT_KEY ? {} : { root }),
  offset: point.offset,
  path: [...point.path],
})

const getProjectedPointRoot = (point: SlateProjectedPoint): RootKey =>
  (point.point.root ?? point.owner?.childRoot ?? MAIN_ROOT_KEY) as RootKey

const toRootedProjectedPoint = (point: SlateProjectedPoint): Point =>
  cloneRootedPoint(point.point, getProjectedPointRoot(point))

const hasAmbiguousRepeatedRootSegments = (
  segments: SlateViewSelection['segments']
) => {
  const ownerKeysByRoot = new Map<RootKey, Set<string | null>>()

  for (const segment of segments.parts) {
    const ownerKeys = ownerKeysByRoot.get(segment.root) ?? new Set()

    ownerKeys.add(segment.ownerKey)
    ownerKeysByRoot.set(segment.root, ownerKeys)

    if (ownerKeys.size > 1) {
      return true
    }
  }

  return false
}

const getChild = (
  children: readonly Descendant[],
  path: Path
): Descendant | null => {
  let currentChildren = children

  for (let depth = 0; depth < path.length; depth++) {
    const node = currentChildren[path[depth]!]

    if (!node) {
      return null
    }

    if (depth === path.length - 1) {
      return node
    }

    if (NodeApi.isText(node)) {
      return null
    }

    currentChildren = node.children
  }

  return null
}

const getBoundaryPoint = (
  node: Descendant,
  path: Path,
  edge: 'end' | 'start'
): Point | null => {
  if (NodeApi.isText(node)) {
    return {
      offset: edge === 'start' ? 0 : node.text.length,
      path: [...path],
    }
  }

  const indexes =
    edge === 'start'
      ? node.children.keys()
      : [...node.children.keys()].reverse()

  for (const index of indexes) {
    const child = node.children[index]
    const point = child && getBoundaryPoint(child, path.concat(index), edge)

    if (point) {
      return point
    }
  }

  return null
}

const resolveProjectedSelectionEndpoint = (
  roots: Readonly<Record<string, readonly Descendant[]>>,
  segment: SlateProjectionGraphRangeSegment,
  endpoint: SlateProjectionGraphRangeEndpoint
): Point | null => {
  if (endpoint.kind === 'point') {
    return cloneRootedPoint(endpoint.point, segment.root)
  }

  const children = roots[endpoint.node.root]
  const node = children && getChild(children, endpoint.node.path)
  const point =
    node && getBoundaryPoint(node, [...endpoint.node.path], endpoint.edge)

  return point ? cloneRootedPoint(point, endpoint.node.root) : null
}

export const createProjectedSelectionTarget = (
  editor: RuntimeEditor,
  viewSelection: SlateViewSelection
): { ranges: Range[]; start: Point } | null => {
  const roots = editor.read((state) => state.value.get().roots)
  const ranges: Range[] = []

  if (hasAmbiguousRepeatedRootSegments(viewSelection.segments)) {
    return null
  }

  for (const segment of viewSelection.segments.parts) {
    const anchor = resolveProjectedSelectionEndpoint(
      roots,
      segment,
      segment.start
    )
    const focus = resolveProjectedSelectionEndpoint(roots, segment, segment.end)

    if (!anchor || !focus) {
      return null
    }

    ranges.push({ anchor, focus })
  }

  return {
    ranges,
    start: toRootedProjectedPoint(
      collapseSlateViewSelection(viewSelection, 'start')
    ),
  }
}
