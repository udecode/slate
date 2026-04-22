import type { Range } from './range'

export type BookmarkAffinity = 'backward' | 'forward' | 'inward'

export type Bookmark = {
  affinity: BookmarkAffinity
  resolve(): Range | null
  unref(): Range | null
}

export type BookmarkOptions = {
  affinity?: BookmarkAffinity
}
