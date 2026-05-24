import { type KeyboardEvent, useCallback, useMemo } from 'react'
import type { RootKey } from 'slate'

import {
  getHistoryDirectionFromNativeEvent,
  type HistoryDirection,
} from '../editable/history-keyboard'
import { scheduleSlateReactFocus } from './focus-scheduler'
import { focusSlateEditable } from './focus-slate-editable'
import {
  useRequiredSlateRuntimeContext,
  useSlateRootEditor,
  useSlateRuntimeState,
} from './use-slate-runtime'

const MAIN_ROOT_KEY: RootKey = 'main'

export type SlateHistoryFocusPolicy = 'none' | 'preserve-dom' | 'restore-root'

export type UseSlateHistoryOptions = {
  focusPolicy?: SlateHistoryFocusPolicy
  root?: RootKey
}

export type SlateHistoryController = {
  canRedo: boolean
  canUndo: boolean
  onKeyDown: (event: KeyboardEvent) => void
  redo: () => void
  root: RootKey
  undo: () => void
}

type HistoryAvailability = {
  canRedo: boolean
  canUndo: boolean
}

const historyAvailabilityEquality = (
  a: HistoryAvailability | null,
  b: HistoryAvailability
) => a?.canRedo === b.canRedo && a.canUndo === b.canUndo

const nullableRootKeyEquality = (a: RootKey | null, b: RootKey | null) =>
  a === b

const selectSelectionRoot = (state: unknown): RootKey | null => {
  const selection = (
    state as {
      selection?: {
        get?: () => {
          anchor: { root?: RootKey }
          focus: { root?: RootKey }
        } | null
      }
    }
  ).selection?.get?.()

  if (!selection) {
    return null
  }

  return (selection.anchor.root ??
    selection.focus.root ??
    MAIN_ROOT_KEY) as RootKey
}

const createHistoryRootSelector = () => {
  let lastRoot: RootKey = MAIN_ROOT_KEY

  return (state: unknown): RootKey => {
    const selectionRoot = selectSelectionRoot(state)

    if (selectionRoot) {
      lastRoot = selectionRoot
    }

    return selectionRoot ?? lastRoot
  }
}

const hasHistoryCommands = (
  tx: unknown
): tx is {
  history: {
    redo: () => void
    undo: () => void
  }
} =>
  typeof (tx as { history?: { redo?: unknown } }).history?.redo ===
    'function' &&
  typeof (tx as { history?: { undo?: unknown } }).history?.undo === 'function'

const getHistoryStacks = (
  state: unknown
): {
  redos: () => readonly unknown[]
  undos: () => readonly unknown[]
} | null => {
  const history = (
    state as {
      history?: {
        redos?: () => readonly unknown[]
        undos?: () => readonly unknown[]
      }
    }
  ).history
  const redos = history?.redos
  const undos = history?.undos

  return typeof redos === 'function' && typeof undos === 'function'
    ? { redos, undos }
    : null
}

const selectHistoryAvailability = (state: unknown): HistoryAvailability => {
  const history = getHistoryStacks(state)

  return {
    canRedo: (history?.redos().length ?? 0) > 0,
    canUndo: (history?.undos().length ?? 0) > 0,
  }
}

const getHistoryUpdateOptions = (focus: SlateHistoryFocusPolicy) =>
  focus === 'preserve-dom'
    ? ({
        metadata: {
          selection: {
            dom: 'preserve',
            focus: false,
            scroll: false,
          },
        },
      } as const)
    : undefined

export function useSlateHistory({
  focusPolicy = 'restore-root',
  root: fixedRoot,
}: UseSlateHistoryOptions = {}): SlateHistoryController {
  const historyRootSelector = useMemo(() => createHistoryRootSelector(), [])
  const historyRoot = useSlateRuntimeState(historyRootSelector, {
    deps: [historyRootSelector],
    equalityFn: nullableRootKeyEquality,
    shouldUpdate: (change) => Boolean(change?.selectionChanged),
  })
  const root = fixedRoot ?? historyRoot
  const editor = useSlateRootEditor(root)
  const { getMountedViewEditor } = useRequiredSlateRuntimeContext()
  const availability = useSlateRuntimeState(selectHistoryAvailability, {
    deps: [],
    equalityFn: historyAvailabilityEquality,
  })

  const applyHistory = useCallback(
    (direction: HistoryDirection) => {
      if (direction === 'undo' && !availability.canUndo) {
        return
      }
      if (direction === 'redo' && !availability.canRedo) {
        return
      }

      editor.update((tx) => {
        if (!hasHistoryCommands(tx)) {
          return
        }

        tx.history[direction]()
      }, getHistoryUpdateOptions(focusPolicy))

      if (focusPolicy === 'restore-root') {
        scheduleSlateReactFocus(() => {
          const focusEditor = getMountedViewEditor(root) ?? editor

          if (!focusEditor.read((state) => state.selection.get())) {
            focusEditor.update((tx) => {
              const point = tx.points.start([])
              tx.selection.set({ anchor: point, focus: point })
            })
          }

          focusSlateEditable(focusEditor)
        })
      }
    },
    [
      availability.canRedo,
      availability.canUndo,
      editor,
      focusPolicy,
      getMountedViewEditor,
      root,
    ]
  )

  const undo = useCallback(() => {
    applyHistory('undo')
  }, [applyHistory])

  const redo = useCallback(() => {
    applyHistory('redo')
  }, [applyHistory])

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const direction = getHistoryDirectionFromNativeEvent(event.nativeEvent)

      if (!direction) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      applyHistory(direction)
    },
    [applyHistory]
  )

  return useMemo(
    () => ({
      canRedo: availability.canRedo,
      canUndo: availability.canUndo,
      onKeyDown,
      redo,
      root,
      undo,
    }),
    [availability.canRedo, availability.canUndo, onKeyDown, redo, root, undo]
  )
}
