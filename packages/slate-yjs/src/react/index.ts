import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { Editor, EditorCoreStateView, Range } from 'slate'
import {
  createRangeDecorationSource,
  type SlateDecorationSource,
} from 'slate-react'

import type { YjsProviderStatus, YjsRemoteCursor, YjsState } from '../core'

type YjsStateView = EditorCoreStateView & {
  yjs: YjsState
}

type YjsDOMRangeResolver = Editor & {
  api?: {
    dom?: {
      isFocused?: () => boolean
      resolveRangeRect?: (range: Range) => DOMRect | null
    }
  }
}

export type YjsRemoteCursorDecorationData<
  TCursorData extends Record<string, unknown> = Record<string, unknown>,
> = {
  clientId: number
  cursor: YjsRemoteCursor<TCursorData>
  data?: TCursorData
}

export type UseYjsRemoteCursorDecorationSourceOptions<
  TCursorData extends Record<string, unknown> = Record<string, unknown>,
  TDecorationData = YjsRemoteCursorDecorationData<TCursorData>,
> = {
  decorate?: (cursor: YjsRemoteCursor<TCursorData>) => TDecorationData
  /** Values that should recompute decoration data when decorate closes over React state. */
  deps?: readonly unknown[]
  id?: string
}

export type YjsRemoteCursorOverlayPosition<
  TCursorData extends Record<string, unknown> = Record<string, unknown>,
  TPositionData = YjsRemoteCursorDecorationData<TCursorData>,
> = {
  clientId: number
  cursor: YjsRemoteCursor<TCursorData>
  data: TPositionData
  range: Range
  rect: DOMRect | null
}

export type UseYjsRemoteCursorOverlayPositionsOptions<
  TCursorData extends Record<string, unknown> = Record<string, unknown>,
  TPositionData = YjsRemoteCursorDecorationData<TCursorData>,
> = {
  data?: (cursor: YjsRemoteCursor<TCursorData>) => TPositionData
  /** Values that should recompute overlay data when data closes over React state. */
  deps?: readonly unknown[]
}

const DEFAULT_CURSOR_DECORATION_SOURCE_ID = 'yjs-remote-cursors'

const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect

const readYjsState = <T>(editor: Editor, selector: (state: YjsState) => T) =>
  editor.read((state) => selector((state as YjsStateView).yjs))

const createCursorData = <
  TCursorData extends Record<string, unknown> = Record<string, unknown>,
>(
  cursor: YjsRemoteCursor<TCursorData>
): YjsRemoteCursorDecorationData<TCursorData> => {
  const data: YjsRemoteCursorDecorationData<TCursorData> = {
    clientId: cursor.clientId,
    cursor,
  }

  if (cursor.data !== undefined) {
    data.data = cursor.data
  }

  return data
}

const resolveCursorRect = (editor: Editor, range: Range) => {
  const resolveRangeRect = (editor as YjsDOMRangeResolver).api?.dom
    ?.resolveRangeRect

  if (!resolveRangeRect) {
    return null
  }

  try {
    return resolveRangeRect(range)
  } catch {
    return null
  }
}

const isEditorFocused = (editor: Editor) =>
  Boolean((editor as YjsDOMRangeResolver).api?.dom?.isFocused?.())

const pointsEqual = (a: Range['anchor'], b: Range['anchor']) =>
  a.offset === b.offset &&
  a.path.length === b.path.length &&
  a.path.every((part, index) => part === b.path[index])

const rangesEqual = (a: Range, b: Range) =>
  pointsEqual(a.anchor, b.anchor) && pointsEqual(a.focus, b.focus)

const rectsEqual = (a: DOMRect | null, b: DOMRect | null) => {
  if (a === b) {
    return true
  }
  if (!a || !b) {
    return false
  }

  return (
    a.bottom === b.bottom &&
    a.height === b.height &&
    a.left === b.left &&
    a.right === b.right &&
    a.top === b.top &&
    a.width === b.width &&
    a.x === b.x &&
    a.y === b.y
  )
}

const shallowEqual = (a: unknown, b: unknown) => {
  if (Object.is(a, b)) {
    return true
  }
  if (
    typeof a !== 'object' ||
    a === null ||
    typeof b !== 'object' ||
    b === null
  ) {
    return false
  }

  const aRecord = a as Record<string, unknown>
  const bRecord = b as Record<string, unknown>
  const aKeys = Object.keys(aRecord)

  return (
    aKeys.length === Object.keys(bRecord).length &&
    aKeys.every((key) => Object.is(aRecord[key], bRecord[key]))
  )
}

const overlayPositionsEqual = <
  TCursorData extends Record<string, unknown>,
  TPositionData,
>(
  a: readonly YjsRemoteCursorOverlayPosition<TCursorData, TPositionData>[],
  b: readonly YjsRemoteCursorOverlayPosition<TCursorData, TPositionData>[]
) =>
  a.length === b.length &&
  a.every((position, index) => {
    const next = b[index]

    return (
      !!next &&
      position.clientId === next.clientId &&
      rangesEqual(position.range, next.range) &&
      rectsEqual(position.rect, next.rect) &&
      shallowEqual(position.data, next.data)
    )
  })

const readYjsRemoteCursorOverlayPositions = <
  TCursorData extends Record<string, unknown> = Record<string, unknown>,
  TPositionData = YjsRemoteCursorDecorationData<TCursorData>,
>(
  editor: Editor,
  options: UseYjsRemoteCursorOverlayPositionsOptions<TCursorData, TPositionData>
): YjsRemoteCursorOverlayPosition<TCursorData, TPositionData>[] =>
  readYjsState(editor, (state) =>
    state.remoteCursors<TCursorData>().flatMap((cursor) => {
      const range = cursor.selection

      if (!range) {
        return []
      }

      const data = options.data
        ? options.data(cursor)
        : (createCursorData(cursor) as TPositionData)

      return [
        {
          clientId: cursor.clientId,
          cursor,
          data,
          range,
          rect: resolveCursorRect(editor, range),
        },
      ]
    })
  )

export const getYjsAwarenessRevision = (editor: Editor) =>
  readYjsState(editor, (state) => state.awarenessRevision())

export const getYjsProviderRevision = (editor: Editor) =>
  readYjsState(editor, (state) => state.providerRevision())

export const getYjsProviderStatus = (
  editor: Editor
): YjsProviderStatus | null =>
  readYjsState(editor, (state) => state.providerStatus())

export const getYjsProviderSynced = (editor: Editor): boolean | null =>
  readYjsState(editor, (state) => state.providerSynced())

export function useYjsAwarenessRevision(editor: Editor) {
  return useSyncExternalStore(
    (listener) =>
      readYjsState(editor, (state) => state.subscribeAwareness(listener)),
    () => getYjsAwarenessRevision(editor),
    () => getYjsAwarenessRevision(editor)
  )
}

export function useYjsProviderRevision(editor: Editor) {
  return useSyncExternalStore(
    (listener) =>
      readYjsState(editor, (state) => state.subscribeProvider(listener)),
    () => getYjsProviderRevision(editor),
    () => getYjsProviderRevision(editor)
  )
}

export function useYjsProviderStatus(editor: Editor): YjsProviderStatus | null {
  useYjsProviderRevision(editor)

  return getYjsProviderStatus(editor)
}

export function useYjsProviderSynced(editor: Editor): boolean | null {
  useYjsProviderRevision(editor)

  return getYjsProviderSynced(editor)
}

export function useYjsRemoteCursor<
  TCursorData extends Record<string, unknown> = Record<string, unknown>,
>(editor: Editor, clientId: number): YjsRemoteCursor<TCursorData> | null {
  useYjsAwarenessRevision(editor)

  return readYjsState(editor, (state) =>
    state.remoteCursor<TCursorData>(clientId)
  )
}

export function useYjsRemoteCursors<
  TCursorData extends Record<string, unknown> = Record<string, unknown>,
>(editor: Editor): YjsRemoteCursor<TCursorData>[] {
  useYjsAwarenessRevision(editor)

  return readYjsState(editor, (state) => state.remoteCursors<TCursorData>())
}

export function useYjsRemoteCursorDecorationSource<
  TCursorData extends Record<string, unknown> = Record<string, unknown>,
  TDecorationData = YjsRemoteCursorDecorationData<TCursorData>,
>(
  editor: Editor,
  options: UseYjsRemoteCursorDecorationSourceOptions<
    TCursorData,
    TDecorationData
  > = {}
): SlateDecorationSource<TDecorationData> {
  const awarenessRevision = useYjsAwarenessRevision(editor)
  const decorateRefreshDeps = options.deps ?? []
  const optionsRef = useRef(options)
  const id = options.id ?? DEFAULT_CURSOR_DECORATION_SOURCE_ID
  optionsRef.current = options

  const source = useMemo(
    () =>
      createRangeDecorationSource<TDecorationData>(editor, {
        id,
        read: () =>
          readYjsState(editor, (state) =>
            state.remoteCursors<TCursorData>().flatMap((cursor) => {
              const range = cursor.selection

              if (!range) {
                return []
              }

              const decorate = optionsRef.current.decorate
              const data = decorate
                ? decorate(cursor)
                : (createCursorData(cursor) as TDecorationData)

              return [
                {
                  data,
                  key: `${id}:${cursor.clientId}`,
                  range,
                },
              ]
            })
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
  TCursorData extends Record<string, unknown> = Record<string, unknown>,
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
  const dataRefreshDeps = options.deps ?? []
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

    if (typeof window === 'undefined' || !window.requestAnimationFrame) {
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

  return [positions, refresh] as const
}
