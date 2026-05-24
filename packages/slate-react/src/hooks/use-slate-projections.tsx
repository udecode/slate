import { useCallback, useContext, useSyncExternalStore } from 'react'
import { ProjectionContext } from '../projection-context'
import type { SlateProjectionRefreshResult } from '../projection-store'

export interface SlateProjectionEntry<T = unknown> {
  data?: T
  end: number
  key: string
  start: number
}

export interface SlateProjectionStore<T = unknown> {
  getSnapshot: () => Readonly<
    Record<string, readonly SlateProjectionEntry<T>[]>
  >
  getRuntimeSnapshot?: (runtimeId: string) => readonly SlateProjectionEntry<T>[]
  subscribeProjectionRefresh?: (
    listener: (result: SlateProjectionRefreshResult) => void
  ) => () => void
  subscribe: (listener: () => void) => () => void
  subscribeRuntimeId?: (runtimeId: string, listener: () => void) => () => void
  subscribeSourceId?: (sourceId: string, listener: () => void) => () => void
}

const EMPTY_PROJECTIONS = Object.freeze(
  []
) as readonly SlateProjectionEntry<never>[]
const subscribeEmpty = () => () => {}
const getEmptyRuntimeSnapshot = () => EMPTY_PROJECTIONS

export function useSlateProjections<T = unknown>(
  runtimeId: string
): readonly SlateProjectionEntry<T>[] {
  const store = useContext(ProjectionContext)
  const subscribe = useCallback(
    (listener: () => void) => {
      if (store?.subscribeRuntimeId) {
        return store.subscribeRuntimeId(runtimeId, listener)
      }

      return store?.subscribe(listener) ?? subscribeEmpty()
    },
    [runtimeId, store]
  )
  const getSnapshot = useCallback(
    () =>
      (store?.getRuntimeSnapshot?.(runtimeId) as
        | readonly SlateProjectionEntry<T>[]
        | undefined) ??
      ((store?.getSnapshot()[runtimeId] as
        | readonly SlateProjectionEntry<T>[]
        | undefined) ||
        EMPTY_PROJECTIONS),
    [runtimeId, store]
  )

  return useSyncExternalStore(
    store ? subscribe : subscribeEmpty,
    store ? getSnapshot : getEmptyRuntimeSnapshot,
    store ? getSnapshot : getEmptyRuntimeSnapshot
  )
}
