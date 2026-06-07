import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { Descendant, Path, Range, RootKey } from 'slate'
import { RangeApi } from 'slate'

import {
  createDecorationSource,
  type SlateDecoration,
  type SlateDecorationSource,
} from './decoration-source'
import { useIsomorphicLayoutEffect } from './hooks/use-isomorphic-layout-effect'
import type { ReactRuntimeEditor } from './plugin/react-editor'
import type { SlateSourceDirtiness } from './projection-store'
import {
  resolveSlateViewBoundarySegmentEndpoint,
  type SlateViewBoundaryOwner,
  type SlateViewBoundaryRangeEndpoint,
  type SlateViewBoundaryRangeSegment,
} from './view-boundary-graph'
import {
  isSlateViewSelectionCollapsed,
  readSlateViewSelection,
  subscribeSlateViewSelection,
} from './view-selection'

export const SLATE_VIEW_SELECTION_DECORATION_SOURCE_ID = 'slate-view-selection'
export const SLATE_VIEW_SELECTION_DECORATION_DIRTINESS = [
  'node',
  'text',
  'external',
] as const satisfies SlateSourceDirtiness

export type SlateViewSelectionDecorationOwner = Readonly<{
  childRoot: RootKey
  ownerPath: Path
  ownerRoot: RootKey
}>

export type SlateViewSelectionDecorationData = Readonly<{
  slateViewSelection: true
  owner: SlateViewSelectionDecorationOwner | null
  root: RootKey
}>

const MAIN_ROOT_KEY: RootKey = 'main'

const EMPTY_DECORATIONS = Object.freeze(
  []
) as readonly SlateDecoration<SlateViewSelectionDecorationData>[]

const cloneOwner = (
  owner: SlateViewBoundaryOwner | null
): SlateViewSelectionDecorationOwner | null =>
  owner
    ? {
        childRoot: owner.childRoot,
        ownerPath: [...owner.ownerPath] as Path,
        ownerRoot: owner.ownerRoot,
      }
    : null

const isSamePath = (left: Path, right: Path) =>
  left.length === right.length &&
  left.every((part, index) => part === right[index])

const isSameOwner = (
  left: SlateViewSelectionDecorationOwner | null,
  right: SlateViewSelectionDecorationOwner | null
) =>
  (!left && !right) ||
  Boolean(
    left &&
      right &&
      left.childRoot === right.childRoot &&
      left.ownerRoot === right.ownerRoot &&
      isSamePath(left.ownerPath, right.ownerPath)
  )

const isSlateViewSelectionDecorationData = (
  value: unknown
): value is SlateViewSelectionDecorationData =>
  typeof value === 'object' &&
  value !== null &&
  (value as { slateViewSelection?: unknown }).slateViewSelection === true

export const hasVisibleSlateViewSelectionDecoration = (
  slices: readonly { data?: unknown }[],
  {
    owner,
    root,
  }: {
    owner: SlateViewSelectionDecorationOwner | null
    root: RootKey | null
  }
) => {
  const viewRoot = root ?? MAIN_ROOT_KEY

  return slices.some((slice) => {
    const data = slice.data

    if (!isSlateViewSelectionDecorationData(data)) {
      return false
    }

    if (data.owner) {
      return isSameOwner(data.owner, owner)
    }

    return !owner && data.root === viewRoot
  })
}

const getRangeKey = (range: Range, index: number) =>
  `${SLATE_VIEW_SELECTION_DECORATION_SOURCE_ID}:${range.anchor.root ?? MAIN_ROOT_KEY}:${range.anchor.path.join('.')}:${range.anchor.offset}:${range.focus.root ?? MAIN_ROOT_KEY}:${range.focus.path.join('.')}:${range.focus.offset}:${index}`

const rootPointForSegment = (
  point: Range['anchor'],
  root: RootKey
): Range['anchor'] => ({
  ...(root === MAIN_ROOT_KEY ? {} : { root }),
  offset: point.offset,
  path: [...point.path] as Path,
})

const resolveSlateViewSelectionDecorationEndpoint = (
  roots: () => Readonly<Record<string, readonly Descendant[]>>,
  segment: SlateViewBoundaryRangeSegment,
  endpoint: SlateViewBoundaryRangeEndpoint
) => {
  if (endpoint.kind === 'point') {
    return rootPointForSegment(endpoint.point, segment.root)
  }

  return resolveSlateViewBoundarySegmentEndpoint(roots(), segment, endpoint)
}

const readSlateViewSelectionDecorations = (
  editor: ReactRuntimeEditor<any>
): readonly SlateDecoration<SlateViewSelectionDecorationData>[] => {
  const viewSelection = readSlateViewSelection(editor)

  if (!viewSelection || isSlateViewSelectionCollapsed(viewSelection)) {
    return EMPTY_DECORATIONS
  }

  let roots: Readonly<Record<string, readonly Descendant[]>> | null = null
  const getRoots = () => {
    roots ??= editor.read((state) => state.value.get().roots)

    return roots
  }
  const decorations: SlateDecoration<SlateViewSelectionDecorationData>[] = []

  viewSelection.segments.parts.forEach((segment, index) => {
    const anchor = resolveSlateViewSelectionDecorationEndpoint(
      getRoots,
      segment,
      segment.start
    )
    const focus = resolveSlateViewSelectionDecorationEndpoint(
      getRoots,
      segment,
      segment.end
    )

    if (!anchor || !focus) {
      return
    }

    const range = { anchor, focus }

    if (RangeApi.isCollapsed(range)) {
      return
    }

    decorations.push({
      data: {
        slateViewSelection: true,
        owner: cloneOwner(segment.owner),
        root: segment.root,
      },
      key: getRangeKey(range, index),
      range,
    })
  })

  return decorations.length === 0 ? EMPTY_DECORATIONS : decorations
}

export const createSlateViewSelectionDecorationSource = (
  editor: ReactRuntimeEditor<any>
): SlateDecorationSource<SlateViewSelectionDecorationData> =>
  createDecorationSource<SlateViewSelectionDecorationData>(editor, {
    dirtiness: SLATE_VIEW_SELECTION_DECORATION_DIRTINESS,
    id: SLATE_VIEW_SELECTION_DECORATION_SOURCE_ID,
    read: () => readSlateViewSelectionDecorations(editor),
  })

export const useSlateViewSelectionPresence = (editor: object) =>
  useSyncExternalStore(
    (listener) => subscribeSlateViewSelection(editor, listener),
    () => readSlateViewSelection(editor) !== null,
    () => false
  )

export const useSlateViewSelectionDecorationSource = (
  editor: ReactRuntimeEditor<any>,
  enabled: boolean
): SlateDecorationSource<SlateViewSelectionDecorationData> | null => {
  const source = useMemo(() => {
    if (!enabled) {
      return null
    }

    return createSlateViewSelectionDecorationSource(editor)
  }, [editor, enabled])

  useEffect(() => () => source?.destroy(), [source])
  useIsomorphicLayoutEffect(() => {
    if (!source) {
      return
    }

    return subscribeSlateViewSelection(editor, () => {
      source.refresh({
        reason: 'external',
      })
    })
  }, [editor, source])

  return source
}
