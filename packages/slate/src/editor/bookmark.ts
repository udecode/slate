import type {
  Bookmark,
  BookmarkAffinity,
  BookmarkOptions,
} from '../interfaces/bookmark'
import type { Editor } from '../interfaces/editor'
import type { Operation } from '../interfaces/operation'
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

    const next = RangeApi.transform(bookmarkState.current, op, {
      affinity: bookmarkState.affinity,
    })

    bookmarkState.current = next

    if (next == null) {
      bookmarks.delete(bookmarkState)
    }
  }
}
