import { createContext, useCallback, useContext, useMemo, useRef } from 'react'
import type { Operation, SnapshotChange, ValueOf } from 'slate'
import type { ReactEditor } from '../plugin/react-editor'
import { useGenericSelector } from './use-generic-selector'
import { useIsomorphicLayoutEffect } from './use-isomorphic-layout-effect'
import { useSlateStatic } from './use-slate-static'

type Callback = (
  operations?: readonly Operation[],
  change?: SnapshotChange
) => void

export interface SlateSelectorOptions {
  deferred?: boolean
  shouldUpdate?: (
    operations?: readonly Operation[],
    change?: SnapshotChange
  ) => boolean
}

export const SlateSelectorContext = createContext<{
  addEventListener: (
    callback: Callback,
    options?: SlateSelectorOptions
  ) => () => void
  flushDeferred: () => void
}>({} as any)

const refEquality = (a: any, b: any) => a === b

const scheduleMicrotask =
  typeof queueMicrotask === 'function'
    ? queueMicrotask
    : (callback: () => void) => {
        Promise.resolve().then(callback)
      }

export function useSlateSelector<
  T,
  TEditor extends ReactEditor<any> = ReactEditor<any>,
>(
  selector: (
    editor: TEditor,
    operations?: readonly Operation<ValueOf<TEditor>>[]
  ) => T,
  equalityFn: (a: T | null, b: T) => boolean = refEquality,
  { deferred, shouldUpdate }: SlateSelectorOptions = {}
): T {
  const context = useContext(SlateSelectorContext)
  if (!context) {
    throw new Error(
      `The \`useSlateSelector\` hook must be used inside the <Slate> component's context.`
    )
  }
  const { addEventListener } = context

  const editor = useSlateStatic<TEditor>()
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
      shouldUpdate,
    })
    update()
    return unsubscribe
  }, [addEventListener, update, updateWithOperations, deferred, shouldUpdate])

  return selectedState
}

export function useSelectorContext() {
  const eventListeners = useRef(new Set<Callback>())
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
      if (deferredEventListeners.current.size > 0) {
        scheduleDeferredFlush()
      }
    },
    [scheduleDeferredFlush]
  )

  const addEventListener = useCallback(
    (
      callbackProp: Callback,
      { deferred = false, shouldUpdate }: SlateSelectorOptions = {}
    ) => {
      const shouldNotify = (
        operations?: readonly Operation[],
        change?: SnapshotChange
      ) => (shouldUpdate ? shouldUpdate(operations, change) : true)
      const callback = deferred
        ? (operations?: readonly Operation[], change?: SnapshotChange) => {
            if (shouldNotify(operations, change)) {
              deferredEventListeners.current.add(callbackProp)
            }
          }
        : (operations?: readonly Operation[], change?: SnapshotChange) => {
            if (shouldNotify(operations, change)) {
              callbackProp(operations, change)
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
  const { flushDeferred } = useContext(SlateSelectorContext)
  useIsomorphicLayoutEffect(flushDeferred)
}
