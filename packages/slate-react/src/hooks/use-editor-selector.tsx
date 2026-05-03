import { createContext, useCallback, useContext, useMemo, useRef } from 'react'
import type {
  EditorStateView,
  Operation,
  RuntimeId,
  SnapshotChange,
  ValueOf,
} from 'slate'
import type { ReactEditor } from '../plugin/react-editor'
import { recordSlateReactRender } from '../render-profiler'
import { useEditor } from './use-editor'
import { useGenericSelector } from './use-generic-selector'
import { useIsomorphicLayoutEffect } from './use-isomorphic-layout-effect'

type Callback = (
  operations?: readonly Operation[],
  change?: SnapshotChange
) => void

export interface EditorSelectorOptions {
  deferred?: boolean
  profileId?: string
  runtimeId?: RuntimeId | null
  shouldUpdate?: (
    operations?: readonly Operation[],
    change?: SnapshotChange
  ) => boolean
}

export interface EditorStateSelectorOptions<
  T,
  TEditor extends ReactEditor<any> = ReactEditor<any>,
> {
  deferred?: boolean
  deps?: readonly unknown[]
  equalityFn?: (a: T | null, b: T) => boolean
  shouldUpdate?: (
    change?: SnapshotChange<ValueOf<TEditor>>,
    operations?: readonly Operation<ValueOf<TEditor>>[]
  ) => boolean
}

export const EditorSelectorContext = createContext<{
  addEventListener: (
    callback: Callback,
    options?: EditorSelectorOptions
  ) => () => void
  flushDeferred: () => void
}>({} as any)

const refEquality = (a: any, b: any) => a === b

const getSelectorProfileId = (
  profileId: string | undefined,
  runtimeId: RuntimeId | null | undefined,
  phase: 'check' | 'notify'
) => `selector-${profileId ?? (runtimeId ? 'runtime' : 'global')}-${phase}`

const scheduleMicrotask =
  typeof queueMicrotask === 'function'
    ? queueMicrotask
    : (callback: () => void) => {
        Promise.resolve().then(callback)
      }

export function useEditorSelector<
  T,
  TEditor extends ReactEditor<any> = ReactEditor<any>,
>(
  selector: (
    editor: TEditor,
    operations?: readonly Operation<ValueOf<TEditor>>[]
  ) => T,
  equalityFn: (a: T | null, b: T) => boolean = refEquality,
  { deferred, profileId, runtimeId, shouldUpdate }: EditorSelectorOptions = {}
): T {
  const context = useContext(EditorSelectorContext)
  if (!context) {
    throw new Error(
      `The \`useEditorSelector\` hook must be used inside the <Slate> component's context.`
    )
  }
  const { addEventListener } = context

  const editor = useEditor<TEditor>()
  const latestOperations = useRef<readonly Operation[] | undefined>(undefined)
  const genericSelector = useCallback(
    () =>
      selector(
        editor,
        latestOperations.current as
          | readonly Operation<ValueOf<TEditor>>[]
          | undefined
      ),
    [editor, selector]
  )
  const [selectedState, update] = useGenericSelector(
    genericSelector,
    equalityFn
  )
  const updateWithOperations = useCallback(
    (operations?: readonly Operation[]) => {
      latestOperations.current = operations
      try {
        update()
      } finally {
        latestOperations.current = undefined
      }
    },
    [update]
  )

  useIsomorphicLayoutEffect(() => {
    const unsubscribe = addEventListener(updateWithOperations, {
      deferred,
      profileId,
      runtimeId,
      shouldUpdate,
    })
    update()
    return unsubscribe
  }, [
    addEventListener,
    update,
    updateWithOperations,
    deferred,
    profileId,
    runtimeId,
    shouldUpdate,
  ])

  return selectedState
}

export function useEditorState<
  T,
  TEditor extends ReactEditor<any> = ReactEditor<any>,
>(
  selector: (state: EditorStateView<ValueOf<TEditor>>) => T,
  {
    deferred,
    deps,
    equalityFn = refEquality,
    shouldUpdate,
  }: EditorStateSelectorOptions<T, TEditor> = {}
): T {
  const selectorDeps = deps ?? [selector]
  const stateSelector = useCallback(
    (editor: TEditor) => editor.read((state) => selector(state)),
    // `deps` intentionally owns inline selector closure freshness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    selectorDeps
  )
  const shouldUpdateWithChange = useCallback(
    (operations?: readonly Operation[], change?: SnapshotChange) =>
      shouldUpdate
        ? shouldUpdate(
            change as SnapshotChange<ValueOf<TEditor>> | undefined,
            operations as readonly Operation<ValueOf<TEditor>>[] | undefined
          )
        : true,
    [shouldUpdate]
  )

  return useEditorSelector<T, TEditor>(stateSelector, equalityFn, {
    deferred,
    shouldUpdate: shouldUpdate ? shouldUpdateWithChange : undefined,
  })
}

export function useEditorSelectorContext() {
  const eventListeners = useRef(new Set<Callback>())
  const runtimeEventListeners = useRef(new Map<RuntimeId, Set<Callback>>())
  const deferredEventListeners = useRef(new Set<Callback>())
  const deferredFlushScheduled = useRef(false)

  const flushDeferred = useCallback(() => {
    deferredFlushScheduled.current = false
    deferredEventListeners.current.forEach((listener) => {
      listener()
    })
    deferredEventListeners.current.clear()
  }, [])

  const scheduleDeferredFlush = useCallback(() => {
    if (deferredFlushScheduled.current) {
      return
    }

    deferredFlushScheduled.current = true
    scheduleMicrotask(flushDeferred)
  }, [flushDeferred])

  const onChange = useCallback(
    (operations?: readonly Operation[], change?: SnapshotChange) => {
      eventListeners.current.forEach((listener) => {
        listener(operations, change)
      })

      const affectedRuntimeIds =
        change?.affectedNodeRuntimeIds ?? change?.nodeImpactRuntimeIds
      const shouldSkipRuntimeFanout = Boolean(
        change &&
          affectedRuntimeIds == null &&
          !change.selectionChanged &&
          !change.fullDocumentChanged &&
          (change.rootRuntimeIdsChanged || change.topLevelOrderChanged)
      )
      const runtimeCallbacks = new Set<Callback>()

      if (shouldSkipRuntimeFanout) {
        // Root-level selectors rebuild the mounted runtime-id list for these
        // commits. Notifying every stale mounted node would only add fanout.
      } else if (!change || affectedRuntimeIds == null) {
        runtimeEventListeners.current.forEach((listeners) => {
          listeners.forEach((listener) => {
            runtimeCallbacks.add(listener)
          })
        })
      } else {
        for (const runtimeId of affectedRuntimeIds) {
          runtimeEventListeners.current.get(runtimeId)?.forEach((listener) => {
            runtimeCallbacks.add(listener)
          })
        }
      }

      runtimeCallbacks.forEach((listener) => {
        listener(operations, change)
      })

      if (deferredEventListeners.current.size > 0) {
        scheduleDeferredFlush()
      }
    },
    [scheduleDeferredFlush]
  )

  const addEventListener = useCallback(
    (
      callbackProp: Callback,
      {
        deferred = false,
        profileId,
        runtimeId = null,
        shouldUpdate,
      }: EditorSelectorOptions = {}
    ) => {
      const shouldNotify = (
        operations?: readonly Operation[],
        change?: SnapshotChange
      ) => {
        recordSlateReactRender({
          id: getSelectorProfileId(profileId, runtimeId, 'check'),
          kind: 'selector',
          runtimeId,
        })

        return shouldUpdate ? shouldUpdate(operations, change) : true
      }
      const callback = deferred
        ? (operations?: readonly Operation[], change?: SnapshotChange) => {
            if (shouldNotify(operations, change)) {
              recordSlateReactRender({
                id: getSelectorProfileId(profileId, runtimeId, 'notify'),
                kind: 'selector',
                runtimeId,
              })
              deferredEventListeners.current.add(callbackProp)
            }
          }
        : (operations?: readonly Operation[], change?: SnapshotChange) => {
            if (shouldNotify(operations, change)) {
              recordSlateReactRender({
                id: getSelectorProfileId(profileId, runtimeId, 'notify'),
                kind: 'selector',
                runtimeId,
              })
              callbackProp(operations, change)
            }
          }

      recordSlateReactRender({
        id: runtimeId
          ? 'selector-subscription-runtime'
          : deferred
            ? 'selector-subscription-deferred'
            : 'selector-subscription-global',
        kind: 'selector',
        runtimeId,
      })

      if (runtimeId) {
        const listeners =
          runtimeEventListeners.current.get(runtimeId) ?? new Set<Callback>()
        listeners.add(callback)
        runtimeEventListeners.current.set(runtimeId, listeners)

        return () => {
          listeners.delete(callback)

          if (listeners.size === 0) {
            runtimeEventListeners.current.delete(runtimeId)
          }
        }
      }

      eventListeners.current.add(callback)

      return () => {
        eventListeners.current.delete(callback)
      }
    },
    []
  )

  const selectorContext = useMemo(
    () => ({
      addEventListener,
      flushDeferred,
    }),
    [addEventListener, flushDeferred]
  )

  return { selectorContext, onChange }
}

export function useFlushDeferredSelectorsOnRender() {
  const { flushDeferred } = useContext(EditorSelectorContext)
  useIsomorphicLayoutEffect(flushDeferred)
}
