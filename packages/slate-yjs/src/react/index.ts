import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { Editor, Range } from 'slate'
import {
  createRangeDecorationSource,
  type SlateDecorationSource,
} from 'slate-react'

import type {
  YjsProviderStatus,
  YjsRemoteCursor,
  YjsRemoteCursorData,
  YjsState,
} from '../core'
import { getEditorYjsState } from '../core/editor-yjs'
import { pathsEqual } from '../core/path'
import { isRecord } from '../core/record'

type YjsDOMApi = {
  readonly isFocused?: () => boolean
  readonly resolveRangeRect?: (range: Range) => unknown
}

export type YjsRemoteCursorDecorationData<
  TCursorData extends YjsRemoteCursorData = YjsRemoteCursorData,
> = {
  readonly clientId: number
  readonly cursor: YjsRemoteCursor<TCursorData>
  readonly data?: TCursorData
}

export type UseYjsRemoteCursorDecorationSourceOptions<
  TCursorData extends YjsRemoteCursorData = YjsRemoteCursorData,
  TDecorationData = YjsRemoteCursorDecorationData<TCursorData>,
> = {
  readonly decorate?: (cursor: YjsRemoteCursor<TCursorData>) => TDecorationData
  /** Values that should recompute decoration data when decorate closes over React state. */
  readonly deps?: readonly unknown[]
  readonly id?: string
}

export type YjsRemoteCursorOverlayPosition<
  TCursorData extends YjsRemoteCursorData = YjsRemoteCursorData,
  TPositionData = YjsRemoteCursorDecorationData<TCursorData>,
> = {
  readonly clientId: number
  readonly cursor: YjsRemoteCursor<TCursorData>
  readonly data: TPositionData
  readonly range: Range
  readonly rect: DOMRect | null
}

export type UseYjsRemoteCursorOverlayPositionsOptions<
  TCursorData extends YjsRemoteCursorData = YjsRemoteCursorData,
  TPositionData = YjsRemoteCursorDecorationData<TCursorData>,
> = {
  readonly data?: (cursor: YjsRemoteCursor<TCursorData>) => TPositionData
  /** Values that should recompute overlay data when data closes over React state. */
  readonly deps?: readonly unknown[]
}

type YjsRemoteCursorRange<
  TCursorData extends YjsRemoteCursorData = YjsRemoteCursorData,
> = {
  readonly cursor: YjsRemoteCursor<TCursorData>
  readonly range: Range
}

const DEFAULT_CURSOR_DECORATION_SOURCE_ID = 'yjs-remote-cursors'
const DOM_RECT_FIELDS = [
  'bottom',
  'height',
  'left',
  'right',
  'top',
  'width',
  'x',
  'y',
] as const
const EMPTY_DEPS: readonly unknown[] = []

const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect

const readYjsState = <T>(editor: Editor, selector: (state: YjsState) => T): T =>
  editor.read((state) => selector(getEditorYjsState(state)))

const useYjsRevision = (
  editor: Editor,
  subscribe: (state: YjsState, listener: () => void) => () => void,
  getSnapshot: (editor: Editor) => number
): number =>
  useSyncExternalStore(
    (listener) => readYjsState(editor, (state) => subscribe(state, listener)),
    () => getSnapshot(editor),
    () => getSnapshot(editor)
  )

const useYjsAwarenessValue = <T>(
  editor: Editor,
  selector: (state: YjsState) => T
): T => {
  useYjsAwarenessRevision(editor)

  return readYjsState(editor, selector)
}

const useYjsProviderValue = <T>(
  editor: Editor,
  selector: (state: YjsState) => T
): T => {
  useYjsProviderRevision(editor)

  return readYjsState(editor, selector)
}

const createCursorData = <
  TCursorData extends YjsRemoteCursorData = YjsRemoteCursorData,
>(
  cursor: YjsRemoteCursor<TCursorData>
): YjsRemoteCursorDecorationData<TCursorData> => ({
  clientId: cursor.clientId,
  cursor,
  ...(cursor.data === undefined ? {} : { data: cursor.data }),
})

const createDefaultCursorData = <
  TCursorData extends YjsRemoteCursorData,
  TData,
>(
  cursor: YjsRemoteCursor<TCursorData>
): TData => createCursorData(cursor) as TData

const isYjsDOMApi = (value: unknown): value is YjsDOMApi =>
  isRecord(value) &&
  (value.isFocused === undefined || typeof value.isFocused === 'function') &&
  (value.resolveRangeRect === undefined ||
    typeof value.resolveRangeRect === 'function')

const isDOMRectLike = (value: unknown): value is DOMRect =>
  isRecord(value) &&
  DOM_RECT_FIELDS.every((field) => typeof value[field] === 'number')

const getYjsDOMApi = (editor: Editor): YjsDOMApi | undefined => {
  const api = isRecord(editor) ? editor.api : undefined

  if (!isRecord(api)) {
    return undefined
  }

  return isYjsDOMApi(api.dom) ? api.dom : undefined
}

const resolveCursorRect = (editor: Editor, range: Range): DOMRect | null => {
  const resolveRangeRect = getYjsDOMApi(editor)?.resolveRangeRect

  if (resolveRangeRect === undefined) {
    return null
  }

  try {
    const rect = resolveRangeRect(range)

    return isDOMRectLike(rect) ? rect : null
  } catch {
    return null
  }
}

const isEditorFocused = (editor: Editor): boolean =>
  getYjsDOMApi(editor)?.isFocused?.() === true

const pointsEqual = (a: Range['anchor'], b: Range['anchor']): boolean =>
  a.offset === b.offset && pathsEqual(a.path, b.path)

const rangesEqual = (a: Range, b: Range): boolean =>
  pointsEqual(a.anchor, b.anchor) && pointsEqual(a.focus, b.focus)

const rectsEqual = (a: DOMRect | null, b: DOMRect | null): boolean => {
  if (a === b) {
    return true
  }
  if (a === null || b === null) {
    return false
  }

  return DOM_RECT_FIELDS.every((field) => a[field] === b[field])
}

const shallowEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) {
    return true
  }
  if (!isRecord(a) || !isRecord(b)) {
    return false
  }

  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)

  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key) => Object.is(a[key], b[key]))
  )
}

const overlayPositionsEqual = <
  TCursorData extends YjsRemoteCursorData,
  TPositionData,
>(
  a: readonly YjsRemoteCursorOverlayPosition<TCursorData, TPositionData>[],
  b: readonly YjsRemoteCursorOverlayPosition<TCursorData, TPositionData>[]
): boolean =>
  a.length === b.length &&
  a.every((position, index) => {
    const next = b[index]

    return (
      next !== undefined &&
      position.clientId === next.clientId &&
      rangesEqual(position.range, next.range) &&
      rectsEqual(position.rect, next.rect) &&
      shallowEqual(position.data, next.data)
    )
  })

const getRemoteCursorRange = <
  TCursorData extends YjsRemoteCursorData = YjsRemoteCursorData,
>(
  cursor: YjsRemoteCursor<TCursorData>
): YjsRemoteCursorRange<TCursorData> | null => {
  const range = cursor.selection

  return range === null ? null : { cursor, range }
}

const readYjsRemoteCursorRanges = <
  TCursorData extends YjsRemoteCursorData = YjsRemoteCursorData,
>(
  editor: Editor
): readonly YjsRemoteCursorRange<TCursorData>[] =>
  readYjsState(editor, (state) =>
    state.remoteCursors<TCursorData>().flatMap((cursor) => {
      const range = getRemoteCursorRange(cursor)

      return range === null ? [] : [range]
    })
  )

const readYjsRemoteCursorOverlayPositions = <
  TCursorData extends YjsRemoteCursorData = YjsRemoteCursorData,
  TPositionData = YjsRemoteCursorDecorationData<TCursorData>,
>(
  editor: Editor,
  options: UseYjsRemoteCursorOverlayPositionsOptions<TCursorData, TPositionData>
): readonly YjsRemoteCursorOverlayPosition<TCursorData, TPositionData>[] =>
  readYjsRemoteCursorRanges<TCursorData>(editor).map(({ cursor, range }) => {
    const data =
      options.data === undefined
        ? createDefaultCursorData<TCursorData, TPositionData>(cursor)
        : options.data(cursor)

    return {
      clientId: cursor.clientId,
      cursor,
      data,
      range,
      rect: resolveCursorRect(editor, range),
    }
  })

export const getYjsAwarenessRevision = (editor: Editor): number =>
  readYjsState(editor, (state) => state.awarenessRevision())

export const getYjsProviderRevision = (editor: Editor): number =>
  readYjsState(editor, (state) => state.providerRevision())

export const getYjsProviderStatus = (
  editor: Editor
): YjsProviderStatus | null =>
  readYjsState(editor, (state) => state.providerStatus())

export const getYjsProviderSynced = (editor: Editor): boolean | null =>
  readYjsState(editor, (state) => state.providerSynced())

export function useYjsAwarenessRevision(editor: Editor): number {
  return useYjsRevision(
    editor,
    (state, listener) => state.subscribeAwareness(listener),
    getYjsAwarenessRevision
  )
}

export function useYjsProviderRevision(editor: Editor): number {
  return useYjsRevision(
    editor,
    (state, listener) => state.subscribeProvider(listener),
    getYjsProviderRevision
  )
}

export function useYjsProviderStatus(editor: Editor): YjsProviderStatus | null {
  return useYjsProviderValue(editor, (state) => state.providerStatus())
}

export function useYjsProviderSynced(editor: Editor): boolean | null {
  return useYjsProviderValue(editor, (state) => state.providerSynced())
}

export function useYjsRemoteCursor<
  TCursorData extends YjsRemoteCursorData = YjsRemoteCursorData,
>(editor: Editor, clientId: number): YjsRemoteCursor<TCursorData> | null {
  return useYjsAwarenessValue(editor, (state) =>
    state.remoteCursor<TCursorData>(clientId)
  )
}

export function useYjsRemoteCursors<
  TCursorData extends YjsRemoteCursorData = YjsRemoteCursorData,
>(editor: Editor): readonly YjsRemoteCursor<TCursorData>[] {
  return useYjsAwarenessValue(editor, (state) =>
    state.remoteCursors<TCursorData>()
  )
}

export function useYjsRemoteCursorDecorationSource<
  TCursorData extends YjsRemoteCursorData = YjsRemoteCursorData,
  TDecorationData = YjsRemoteCursorDecorationData<TCursorData>,
>(
  editor: Editor,
  options: UseYjsRemoteCursorDecorationSourceOptions<
    TCursorData,
    TDecorationData
  > = {}
): SlateDecorationSource<TDecorationData> {
  const awarenessRevision = useYjsAwarenessRevision(editor)
  const decorateRefreshDeps = options.deps ?? EMPTY_DEPS
  const optionsRef = useRef(options)
  const id = options.id ?? DEFAULT_CURSOR_DECORATION_SOURCE_ID
  optionsRef.current = options

  const source = useMemo(
    () =>
      createRangeDecorationSource<TDecorationData>(editor, {
        id,
        read: () =>
          readYjsRemoteCursorRanges<TCursorData>(editor).map(
            ({ cursor, range }) => {
              const decorate = optionsRef.current.decorate
              const data =
                decorate === undefined
                  ? createDefaultCursorData<TCursorData, TDecorationData>(
                      cursor
                    )
                  : decorate(cursor)

              return {
                data,
                key: `${id}:${cursor.clientId}`,
                range,
              }
            }
          ),
      }),
    [editor, id]
  )

  useEffect(() => () => source.destroy(), [source])

  useEffect(() => {
    source.refresh({
      forceInvalidate: true,
      reason: 'external',
      requiresDOMSelectionExport: isEditorFocused(editor),
    })
  }, [awarenessRevision, source, ...decorateRefreshDeps])

  return source
}

export function useYjsRemoteCursorOverlayPositions<
  TCursorData extends YjsRemoteCursorData = YjsRemoteCursorData,
  TPositionData = YjsRemoteCursorDecorationData<TCursorData>,
>(
  editor: Editor,
  options: UseYjsRemoteCursorOverlayPositionsOptions<
    TCursorData,
    TPositionData
  > = {}
): readonly [
  readonly YjsRemoteCursorOverlayPosition<TCursorData, TPositionData>[],
  () => void,
] {
  const awarenessRevision = useYjsAwarenessRevision(editor)
  const dataRefreshDeps = options.deps ?? EMPTY_DEPS
  const animationFrameRef = useRef<number | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const readPositions = useCallback(
    () =>
      readYjsRemoteCursorOverlayPositions<TCursorData, TPositionData>(
        editor,
        optionsRef.current
      ),
    [editor]
  )
  const [positions, setPositions] = useState(readPositions)
  const refresh = useCallback(() => {
    const next = readPositions()

    setPositions((current) =>
      overlayPositionsEqual(current, next) ? current : next
    )
  }, [readPositions])
  const cancelScheduledRefresh = useCallback(() => {
    if (typeof window === 'undefined' || animationFrameRef.current === null) {
      return
    }

    window.cancelAnimationFrame(animationFrameRef.current)
    animationFrameRef.current = null
  }, [])
  const refreshAfterEditorLayout = useCallback(() => {
    refresh()

    if (
      typeof window === 'undefined' ||
      typeof window.requestAnimationFrame !== 'function'
    ) {
      return
    }

    cancelScheduledRefresh()
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null
      refresh()
    })
  }, [cancelScheduledRefresh, refresh])

  useIsomorphicLayoutEffect(() => {
    refresh()
  }, [awarenessRevision, refresh, ...dataRefreshDeps])

  useIsomorphicLayoutEffect(() => {
    const unsubscribe = editor.subscribe(() => {
      refreshAfterEditorLayout()
    })

    return () => {
      unsubscribe()
      cancelScheduledRefresh()
    }
  }, [cancelScheduledRefresh, editor, refreshAfterEditorLayout])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.addEventListener('resize', refresh)
    window.addEventListener('scroll', refresh, true)

    return () => {
      window.removeEventListener('resize', refresh)
      window.removeEventListener('scroll', refresh, true)
    }
  }, [refresh])

  return [positions, refresh]
}
