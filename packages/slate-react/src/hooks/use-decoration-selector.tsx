import { useCallback, useContext } from 'react'
import type { RuntimeId } from 'slate'
import { NodeRuntimeIdContext } from '../context'
import { ProjectionContext } from '../projection-context'
import { useGenericSelector } from './use-generic-selector'
import { useIsomorphicLayoutEffect } from './use-isomorphic-layout-effect'
import type {
  SlateProjectionEntry,
  SlateProjectionStore,
} from './use-slate-projections'

const refEquality = (a: unknown, b: unknown) => a === b
const EMPTY_PROJECTIONS = Object.freeze(
  []
) as readonly SlateProjectionEntry<never>[]

export type EditorDecorationSelectorContext<TData = unknown> = {
  projections: readonly SlateProjectionEntry<TData>[]
  runtimeId: RuntimeId | null
  store: SlateProjectionStore<TData> | null
}

export type EditorDecorationSelectorOptions = {
  runtimeId?: RuntimeId | null
}

const getRuntimeProjections = <TData,>(
  store: SlateProjectionStore<TData> | null,
  runtimeId: RuntimeId | null
) => {
  if (!store || !runtimeId) {
    return EMPTY_PROJECTIONS as readonly SlateProjectionEntry<TData>[]
  }

  return (
    store.getRuntimeSnapshot?.(runtimeId) ??
    store.getSnapshot()[runtimeId] ??
    (EMPTY_PROJECTIONS as readonly SlateProjectionEntry<TData>[])
  )
}

export function useDecorationSelector<TSelected, TData = unknown>(
  selector: (context: EditorDecorationSelectorContext<TData>) => TSelected,
  equalityFn: (a: TSelected | null, b: TSelected) => boolean = refEquality,
  { runtimeId: runtimeIdProp }: EditorDecorationSelectorOptions = {}
): TSelected {
  const store = useContext(
    ProjectionContext
  ) as SlateProjectionStore<TData> | null
  const contextRuntimeId = useContext(NodeRuntimeIdContext)
  const runtimeId = runtimeIdProp ?? contextRuntimeId
  const genericSelector = useCallback(
    () =>
      selector({
        projections: getRuntimeProjections(store, runtimeId),
        runtimeId,
        store,
      }),
    [runtimeId, selector, store]
  )
  const [selectedState, update] = useGenericSelector(
    genericSelector,
    equalityFn
  )

  useIsomorphicLayoutEffect(() => {
    if (!store || !runtimeId) {
      update()
      return
    }

    const unsubscribe = store.subscribeRuntimeId
      ? store.subscribeRuntimeId(runtimeId, update)
      : store.subscribe(update)

    update()

    return unsubscribe
  }, [runtimeId, store, update])

  return selectedState
}
