import { useContext, useSyncExternalStore } from 'react'
import { ProjectionContext } from '../projection-context'

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
  subscribe: (listener: () => void) => () => void
}

const EMPTY_PROJECTIONS: readonly SlateProjectionEntry[] = Object.freeze([])
const EMPTY_SNAPSHOT = Object.freeze({}) as Readonly<
  Record<string, readonly SlateProjectionEntry[]>
>
const subscribeEmpty = () => () => {}
const getEmptySnapshot = () => EMPTY_SNAPSHOT

export function useSlateProjections<T = unknown>(
  runtimeId: string
): readonly SlateProjectionEntry<T>[] {
  const store = useContext(ProjectionContext)

  const snapshot = useSyncExternalStore(
    store?.subscribe ?? subscribeEmpty,
    store?.getSnapshot ?? getEmptySnapshot,
    store?.getSnapshot ?? getEmptySnapshot
  )

  return (
    (snapshot[runtimeId] as readonly SlateProjectionEntry<T>[]) ??
    EMPTY_PROJECTIONS
  )
}
