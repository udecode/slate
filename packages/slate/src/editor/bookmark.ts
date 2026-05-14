import type {
  Bookmark,
  BookmarkAffinity,
  BookmarkOptions,
} from '../interfaces/bookmark'
import type { Editor } from '../interfaces/editor'
import type { Descendant } from '../interfaces/node'
import { NodeApi } from '../interfaces/node'
import type { Operation } from '../interfaces/operation'
import type { Path } from '../interfaces/path'
import { PathApi } from '../interfaces/path'
import { type Point, PointApi } from '../interfaces/point'
import { type Range, RangeApi } from '../interfaces/range'

type InternalBookmark = {
  affinity: BookmarkAffinity
  current: Range | null
}

const BOOKMARKS = new WeakMap<Editor, Set<InternalBookmark>>()

const getBookmarks = (editor: Editor) => {
  let bookmarks = BOOKMARKS.get(editor)

  if (!bookmarks) {
    bookmarks = new Set()
    BOOKMARKS.set(editor, bookmarks)
  }

  return bookmarks
}

const cloneRange = (range: Range | null) =>
  range
    ? {
        anchor: {
          path: [...range.anchor.path],
          offset: range.anchor.offset,
        },
        focus: {
          path: [...range.focus.path],
          offset: range.focus.offset,
        },
      }
    : null

type TextLeafEntry = {
  path: Path
  text: string
}

const collectTextLeaves = (
  children: readonly Descendant[],
  pathPrefix: Path = []
): TextLeafEntry[] =>
  Array.from(NodeApi.texts({ children } as never), ([node, path]) => ({
    path: pathPrefix.concat(path),
    text: node.text,
  }))

const getReplaceChildrenPointRelativePath = (
  op: Extract<Operation, { type: 'replace_children' }>,
  point: Point
) => {
  if (!PathApi.isAncestor(op.path, point.path)) {
    return null
  }

  const childIndex = point.path[op.path.length]

  if (
    childIndex == null ||
    childIndex < op.index ||
    childIndex >= op.index + op.children.length
  ) {
    return null
  }

  return [childIndex - op.index, ...point.path.slice(op.path.length + 1)]
}

const mapPointBySurvivingText = (
  op: Extract<Operation, { type: 'replace_children' }>,
  relativePath: Path,
  offset: number
): Point | null => {
  const oldNode = NodeApi.getIf(
    { children: op.children } as never,
    relativePath
  )

  if (!oldNode || !NodeApi.isText(oldNode) || oldNode.text.length === 0) {
    return null
  }

  const matches: Point[] = []

  collectTextLeaves(op.newChildren).forEach((leaf) => {
    const [relativeChildIndex = 0, ...childPath] = leaf.path
    const path = op.path.concat(op.index + relativeChildIndex, childPath)

    let searchFrom = 0

    while (searchFrom <= leaf.text.length) {
      const index = leaf.text.indexOf(oldNode.text, searchFrom)

      if (index === -1) {
        break
      }

      matches.push({
        path,
        offset: index + offset,
      })
      searchFrom = index + Math.max(oldNode.text.length, 1)
    }
  })

  return matches.length === 1 ? matches[0]! : null
}

const mapPointBySameRelativePosition = (
  op: Extract<Operation, { type: 'replace_children' }>,
  relativePath: Path,
  offset: number
): Point | null => {
  const newNode = NodeApi.getIf(
    { children: op.newChildren } as never,
    relativePath
  )

  if (!newNode || !NodeApi.isText(newNode) || offset > newNode.text.length) {
    return null
  }

  const [relativeChildIndex = 0, ...childPath] = relativePath

  return {
    path: op.path.concat(op.index + relativeChildIndex, childPath),
    offset,
  }
}

const transformPointThroughReplaceChildren = (
  point: Point,
  op: Extract<Operation, { type: 'replace_children' }>,
  affinity: 'forward' | 'backward' | null
): Point | null => {
  const relativePath = getReplaceChildrenPointRelativePath(op, point)

  if (!relativePath) {
    return PointApi.transform(point, op, { affinity })
  }

  return (
    mapPointBySurvivingText(op, relativePath, point.offset) ??
    mapPointBySameRelativePosition(op, relativePath, point.offset)
  )
}

const transformBookmarkRange = (
  range: Range,
  op: Operation,
  affinity: BookmarkAffinity
): Range | null => {
  if (op.type !== 'replace_children') {
    return RangeApi.transform(range, op, { affinity })
  }

  let affinityAnchor: 'forward' | 'backward' | null
  let affinityFocus: 'forward' | 'backward' | null

  if (affinity === 'inward') {
    const isCollapsed = RangeApi.isCollapsed(range)

    if (RangeApi.isForward(range)) {
      affinityAnchor = 'forward'
      affinityFocus = isCollapsed ? affinityAnchor : 'backward'
    } else {
      affinityAnchor = 'backward'
      affinityFocus = isCollapsed ? affinityAnchor : 'forward'
    }
  } else {
    affinityAnchor = affinity
    affinityFocus = affinity
  }

  const anchor = transformPointThroughReplaceChildren(
    range.anchor,
    op,
    affinityAnchor
  )
  const focus = transformPointThroughReplaceChildren(
    range.focus,
    op,
    affinityFocus
  )

  return anchor && focus ? { anchor, focus } : null
}

export const bookmark = (
  editor: Editor,
  range: Range,
  options: BookmarkOptions = {}
): Bookmark => {
  const affinity = options.affinity ?? 'inward'
  const state: InternalBookmark = {
    affinity,
    current: cloneRange(range),
  }

  const bookmarkValue: Bookmark = {
    affinity,
    resolve() {
      const latest = cloneRange(state.current)

      if (latest == null) {
        getBookmarks(editor).delete(state)
      }

      return latest
    },
    unref() {
      getBookmarks(editor).delete(state)
      const latest = cloneRange(state.current)
      state.current = null
      return latest
    },
  }

  getBookmarks(editor).add(state)

  return bookmarkValue
}

export const transformBookmarks = (editor: Editor, op: Operation) => {
  const bookmarks = BOOKMARKS.get(editor)

  if (!bookmarks) {
    return
  }

  for (const bookmarkState of bookmarks) {
    if (bookmarkState.current == null) {
      bookmarks.delete(bookmarkState)
      continue
    }

    const next = transformBookmarkRange(
      bookmarkState.current,
      op,
      bookmarkState.affinity
    )

    bookmarkState.current = next

    if (next == null) {
      bookmarks.delete(bookmarkState)
    }
  }
}
