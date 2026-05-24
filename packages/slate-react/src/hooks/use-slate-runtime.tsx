import type { DependencyList, ReactNode } from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'
import ReactDOM from 'react-dom'
import {
  type BaseSelection,
  createEditorView,
  type EditorStateView,
  type EditorView,
  type EditorViewOptions,
  type Operation,
  type RootKey,
  type SnapshotChange,
  type Value,
  type ValueOf,
} from 'slate'
import {
  createDOMEditorCapability,
  EDITOR_TO_ROOT_VIEW_EDITORS,
} from 'slate-dom/internal'

import { SlateEditableRootContext } from '../context'
import {
  Editor,
  getEditorRuntime,
  inheritEditorExtensionRegistry,
  inheritEditorTransformRegistry,
  setEditorRuntime,
} from '../editable/runtime-editor-api'
import { ReactEditor, type ReactRuntimeEditor } from '../plugin/react-editor'
import {
  type CreateReactEditorOptions,
  createReactEditor,
  type ReactEditor as ReactEditorType,
} from '../plugin/with-react'
import { REACT_MAJOR_VERSION } from '../utils/environment'
import { focusSlateEditable } from './focus-slate-editable'
import {
  createRootSelectionCache,
  getSelectionRoot,
} from './root-selection-cache'
import {
  type EditorSelectorContextValue,
  type EditorStateSelectorOptions,
  useEditorSelectorContext,
} from './use-editor-selector'
import { useGenericSelector } from './use-generic-selector'
import { useIsomorphicLayoutEffect } from './use-isomorphic-layout-effect'
import { syncTextOperationsToDOM } from './use-slate-node-ref'

const MAIN_ROOT_KEY: RootKey = 'main'

const refEquality = <T,>(a: T | null, b: T) => a === b
const rootKeyEquality = (a: RootKey | null, b: RootKey) => a === b
const selectionChanged = (change?: SnapshotChange) =>
  Boolean(change?.selectionChanged)

const selectActiveRoot = (state: EditorStateView): RootKey => {
  const selection = state.selection.get()

  return getSelectionRoot(selection) ?? MAIN_ROOT_KEY
}

type ExtensionLike = {
  api?: Record<string, unknown>
  name: string
}

const getExtensionCapabilityName = (extension: ExtensionLike) => {
  const apiNames = Object.keys(extension.api ?? {})

  return apiNames.includes(extension.name)
    ? extension.name
    : (apiNames[0] ?? extension.name)
}

const createReactApi = (domApi: ReactRuntimeEditor['api']['dom']) =>
  Object.freeze({
    isComposing: () => domApi.isComposing(),
    isFocused: () => domApi.isFocused(),
    isReadOnly: () => domApi.isReadOnly(),
  })

export const createSlateViewEffectQueue = () => {
  const effects = new Set<() => void>()

  return {
    flush: () => {
      const pendingEffects = Array.from(effects)

      pendingEffects.forEach((effect) => {
        if (effects.has(effect)) {
          effect()
        }
      })
    },
    hasEffects: () => effects.size > 0,
    register: (effect: () => void) => {
      effects.add(effect)

      return () => {
        effects.delete(effect)
      }
    },
  }
}

export type SlateRuntimeValue<
  V extends Value = Value,
  TExtensions extends readonly unknown[] = readonly [],
> = Pick<
  ReactEditorType<V, TExtensions>,
  'api' | 'extend' | 'getApi' | 'read' | 'subscribe' | 'update'
> & {
  editor: ReactEditorType<V, TExtensions>
}

export type UseSlateRuntimeOptions<
  V extends Value = Value,
  TExtensions extends readonly unknown[] = readonly [],
> = CreateReactEditorOptions<V, TExtensions>

type SlateRuntimeContextValue<
  V extends Value = Value,
  TExtensions extends readonly unknown[] = readonly [],
> = {
  focusVersion: number
  focused: boolean
  getLastSelectionForRoot: (root: RootKey) => BaseSelection
  getMountedViewEditor: (root: RootKey) => ReactRuntimeEditor<V> | null
  getView: (options?: EditorViewOptions) => EditorView<V, TExtensions>
  registerViewEffect: (effect: () => void) => () => void
  registerViewEditor: (
    editor: ReactRuntimeEditor<V>,
    root: RootKey
  ) => () => void
  runtime: SlateRuntimeValue<V, TExtensions>
  selectorContext: EditorSelectorContextValue
}

export type SlateRuntimeProps<
  V extends Value = Value,
  TExtensions extends readonly unknown[] = readonly [],
> = {
  children: ReactNode
  runtime: SlateRuntimeValue<V, TExtensions>
}

export type SlateRuntimeStateSelectorOptions<
  T,
  TRuntime extends SlateRuntimeValue<any> = SlateRuntimeValue<any>,
> = Pick<
  EditorStateSelectorOptions<T, TRuntime['editor']>,
  'deferred' | 'deps' | 'equalityFn' | 'shouldUpdate'
>

export const SlateRuntimeContext = createContext<SlateRuntimeContextValue<
  any,
  any
> | null>(null)

const createReactRuntime = <
  V extends Value,
  TExtensions extends readonly unknown[] = readonly [],
>(
  options: UseSlateRuntimeOptions<V, TExtensions> = {}
): SlateRuntimeValue<V, TExtensions> => {
  const editor = createReactEditor(options)

  return Object.freeze({
    api: editor.api,
    editor,
    extend: editor.extend,
    getApi: editor.getApi,
    read: editor.read,
    subscribe: editor.subscribe,
    update: editor.update,
  })
}

export const createReactRuntimeViewEditor = <
  V extends Value = Value,
  const TExtensions extends readonly unknown[] = readonly unknown[],
>(
  view: EditorView<V, TExtensions>
): EditorView<V, TExtensions> => {
  const runtime = getEditorRuntime(view as any)
  const {
    api: _api,
    getApi: _getApi,
    ...descriptors
  } = Object.getOwnPropertyDescriptors(view)
  const editor = Object.create(Object.getPrototypeOf(view)) as EditorView<
    V,
    TExtensions
  >

  Object.defineProperties(editor, descriptors)
  setEditorRuntime(editor as any, runtime)
  inheritEditorExtensionRegistry(editor as any, view as any)
  inheritEditorTransformRegistry(editor as any, view as any)

  const { clipboard, ...domApi } = createDOMEditorCapability(
    editor as unknown as ReactRuntimeEditor<V>
  )
  const reactApi = createReactApi(domApi)
  const baseApi = view.api as ReactRuntimeEditor<V>['api']
  const viewApi = new Proxy(baseApi as Record<PropertyKey, unknown>, {
    get(target, property, receiver) {
      if (property === 'clipboard') {
        return clipboard
      }
      if (property === 'dom') {
        return domApi
      }
      if (property === 'react') {
        return reactApi
      }

      return Reflect.get(target, property, receiver)
    },
  }) as ReactRuntimeEditor<V>['api']

  Object.defineProperties(editor, {
    api: {
      enumerable: true,
      value: viewApi,
    },
    getApi: {
      enumerable: true,
      value: ((extension: ExtensionLike) => {
        const capability = view.getApi(extension as any)
        const rebound = Reflect.get(
          viewApi,
          getExtensionCapabilityName(extension)
        )

        return rebound ?? capability
      }) as typeof view.getApi,
    },
  })

  return Object.freeze(editor)
}

const operationRoot = (operation: Operation): RootKey =>
  ((operation as { root?: RootKey }).root ?? MAIN_ROOT_KEY) as RootKey

const isTextOperation = (operation: Operation) =>
  operation.type === 'insert_text' || operation.type === 'remove_text'

const isRootAffected = (
  root: RootKey,
  operations?: readonly Operation[],
  change?: SnapshotChange
) => {
  if (!change) {
    return true
  }

  if (
    change.fullDocumentChanged ||
    change.rootRuntimeIdsChanged ||
    change.topLevelOrderChanged ||
    change.dirtyStateKeys.length > 0
  ) {
    return true
  }

  const changedOperations = operations ?? change.operations

  if (
    change.selectionChanged &&
    (getSelectionRoot(change.selectionBefore) === root ||
      getSelectionRoot(change.selectionAfter) === root)
  ) {
    return true
  }

  if (
    change.marksChanged &&
    (getSelectionRoot(change.selectionBefore) === root ||
      getSelectionRoot(change.selectionAfter) === root)
  ) {
    return true
  }

  if (changedOperations.length === 0) {
    return change.selectionChanged
  }

  return changedOperations.some(
    (operation) => operationRoot(operation) === root
  )
}

export function useSlateRuntime<
  V extends Value = Value,
  const TExtensions extends readonly unknown[] = readonly [],
>(
  options?: UseSlateRuntimeOptions<V, TExtensions>
): SlateRuntimeValue<V, TExtensions> {
  const context = useContext(SlateRuntimeContext)
  const shouldUseContext = context && !options
  const [runtime] = useState(() =>
    shouldUseContext ? null : createReactRuntime(options ?? {})
  )

  return (shouldUseContext ? context.runtime : runtime) as SlateRuntimeValue<
    V,
    TExtensions
  >
}

export function useOptionalSlateRuntimeContext() {
  return useContext(SlateRuntimeContext)
}

export function useRequiredSlateRuntimeContext() {
  const context = useContext(SlateRuntimeContext)

  if (!context) {
    throw new Error('Slate root views must be rendered inside <SlateRuntime>.')
  }

  return context
}

export function SlateRuntime<
  V extends Value = Value,
  const TExtensions extends readonly unknown[] = readonly [],
>({ children, runtime }: SlateRuntimeProps<V, TExtensions>) {
  const { selectorContext, onChange: handleSelectorChange } =
    useEditorSelectorContext()
  const lastOperationCountRef = useRef(
    runtime.read((state) => state.value.operations().length)
  )
  const lastCommitVersionRef = useRef(
    Editor.getLastCommit(runtime.editor)?.version ?? 0
  )
  const reactEditor = runtime.editor as unknown as ReactRuntimeEditor<V>
  const mountedViewEditorsRef = useRef(
    new Map<RootKey, Set<ReactRuntimeEditor<V>>>()
  )
  const [viewEffectQueue] = useState(createSlateViewEffectQueue)
  const [viewEffectVersion, setViewEffectVersion] = useState(0)
  const lastSelectionCacheRef = useRef(createRootSelectionCache())
  const [focused, setFocused] = useState(ReactEditor.isFocused(reactEditor))
  const [focusVersion, setFocusVersion] = useState(0)

  const getView = useCallback(
    (options: EditorViewOptions = {}) => createEditorView(runtime, options),
    [runtime]
  )
  const registerViewEditor = useCallback(
    (editor: ReactRuntimeEditor<V>, root: RootKey) => {
      const viewEditors = mountedViewEditorsRef.current.get(root) ?? new Set()
      const rootViewEditors =
        EDITOR_TO_ROOT_VIEW_EDITORS.get(runtime.editor) ?? new Set()

      viewEditors.add(editor)
      mountedViewEditorsRef.current.set(root, viewEditors)
      rootViewEditors.add(editor)
      EDITOR_TO_ROOT_VIEW_EDITORS.set(runtime.editor, rootViewEditors)

      return () => {
        viewEditors.delete(editor)
        rootViewEditors.delete(editor)

        if (viewEditors.size === 0) {
          mountedViewEditorsRef.current.delete(root)
        }
        if (rootViewEditors.size === 0) {
          EDITOR_TO_ROOT_VIEW_EDITORS.delete(runtime.editor)
        }
      }
    },
    [runtime.editor]
  )
  const getMountedViewEditor = useCallback(
    (root: RootKey) => {
      const viewEditor = mountedViewEditorsRef.current
        .get(root)
        ?.values()
        .next().value

      return (viewEditor ??
        (root === MAIN_ROOT_KEY
          ? reactEditor
          : null)) as ReactRuntimeEditor<V> | null
    },
    [reactEditor]
  )
  const getLastSelectionForRoot = useCallback(
    (root: RootKey) => lastSelectionCacheRef.current.get(root),
    []
  )
  const registerViewEffect = useCallback(
    (effect: () => void) => {
      const unregister = viewEffectQueue.register(effect)

      setViewEffectVersion((version) => version + 1)

      return unregister
    },
    [viewEffectQueue]
  )
  const syncRuntimeTextOperationsToDOM = useCallback(
    (operations: readonly Operation[]) => {
      const textOperations = operations.filter(isTextOperation)

      if (textOperations.length === 0) {
        return { syncedTextOperationCount: 0, textOperationCount: 0 }
      }

      const operationsByRoot = new Map<RootKey, Operation[]>()

      for (const operation of textOperations) {
        const root = operationRoot(operation)
        const rootOperations = operationsByRoot.get(root) ?? []

        rootOperations.push(operation)
        operationsByRoot.set(root, rootOperations)
      }

      for (const [root, rootOperations] of operationsByRoot) {
        const viewEditors = mountedViewEditorsRef.current.get(root)

        if (!viewEditors) {
          continue
        }

        for (const viewEditor of viewEditors) {
          const textSync = syncTextOperationsToDOM(viewEditor, rootOperations)

          if (textSync.syncedTextOperationCount < textSync.textOperationCount) {
            return {
              syncedTextOperationCount: 0,
              textOperationCount: textOperations.length,
            }
          }
        }
      }

      return {
        syncedTextOperationCount: textOperations.length,
        textOperationCount: textOperations.length,
      }
    },
    []
  )

  useIsomorphicLayoutEffect(() => {
    const maybeBatchUpdates =
      REACT_MAJOR_VERSION < 18
        ? ReactDOM.unstable_batchedUpdates
        : (callback: () => void) => callback()

    const onContextChange: Parameters<typeof runtime.subscribe>[0] = (
      snapshot,
      commit
    ) => {
      lastSelectionCacheRef.current.record(snapshot.selection)

      let currentOperations: readonly Operation[] = []
      const nextOperations = commit
        ? [...commit.operations]
        : runtime.read((state) => {
            currentOperations = state.value.operations()
            return currentOperations.slice(lastOperationCountRef.current)
          })

      lastSelectionCacheRef.current.recordOperations(nextOperations)

      lastOperationCountRef.current = commit
        ? runtime.read((state) => state.value.operations().length)
        : currentOperations.length
      lastCommitVersionRef.current = commit
        ? commit.version
        : lastCommitVersionRef.current

      maybeBatchUpdates(() => {
        setFocused(ReactEditor.isFocused(reactEditor))

        const textSync = syncRuntimeTextOperationsToDOM(nextOperations)
        const hasUnsyncedTextOperation =
          textSync.textOperationCount > textSync.syncedTextOperationCount

        handleSelectorChange(
          hasUnsyncedTextOperation ? undefined : nextOperations,
          commit
        )

        if (viewEffectQueue.hasEffects()) {
          setViewEffectVersion((version) => version + 1)
        }
      })
    }

    const unsubscribe = runtime.subscribe(onContextChange)
    const latestCommit = Editor.getLastCommit(runtime.editor)

    if (latestCommit && latestCommit.version > lastCommitVersionRef.current) {
      onContextChange(Editor.getSnapshot(runtime.editor), latestCommit)
    }

    return unsubscribe
  }, [
    handleSelectorChange,
    reactEditor,
    runtime,
    syncRuntimeTextOperationsToDOM,
    viewEffectQueue,
  ])

  useIsomorphicLayoutEffect(() => {
    const updateFocusState = () => {
      setFocused(ReactEditor.isFocused(reactEditor))
      setFocusVersion((version) => version + 1)
    }
    const fn = () => {
      updateFocusState()
      queueMicrotask(() => {
        updateFocusState()
      })
    }

    if (REACT_MAJOR_VERSION >= 17) {
      document.addEventListener('focusin', fn)
      document.addEventListener('focusout', fn)

      return () => {
        document.removeEventListener('focusin', fn)
        document.removeEventListener('focusout', fn)
      }
    }

    document.addEventListener('focus', fn, true)
    document.addEventListener('blur', fn, true)

    return () => {
      document.removeEventListener('focus', fn, true)
      document.removeEventListener('blur', fn, true)
    }
  }, [reactEditor])

  useIsomorphicLayoutEffect(() => {
    if (viewEffectVersion === 0) {
      return
    }

    viewEffectQueue.flush()
  }, [viewEffectQueue, viewEffectVersion])

  const value = useMemo(
    () => ({
      focusVersion,
      focused,
      getLastSelectionForRoot,
      getMountedViewEditor,
      getView,
      registerViewEffect,
      registerViewEditor,
      runtime,
      selectorContext,
    }),
    [
      focusVersion,
      focused,
      getLastSelectionForRoot,
      getMountedViewEditor,
      getView,
      registerViewEffect,
      registerViewEditor,
      runtime,
      selectorContext,
    ]
  )

  return (
    <SlateRuntimeContext.Provider
      value={value as SlateRuntimeContextValue<any, any>}
    >
      {children}
    </SlateRuntimeContext.Provider>
  )
}

export function useSlateRuntimeState<
  T,
  TRuntime extends SlateRuntimeValue<any> = SlateRuntimeValue<any>,
>(
  selector: (state: EditorStateView<ValueOf<TRuntime['editor']>>) => T,
  {
    deferred,
    deps,
    equalityFn = refEquality,
    shouldUpdate,
  }: SlateRuntimeStateSelectorOptions<T, TRuntime> = {}
): T {
  const { runtime, selectorContext } = useRequiredSlateRuntimeContext()
  const selectorDeps = deps ?? [selector]
  const stateSelector = useCallback(
    () => runtime.read((state) => selector(state)),
    // `deps` intentionally owns inline selector closure freshness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runtime, ...selectorDeps]
  )
  const [selectedState, update] = useGenericSelector(stateSelector, equalityFn)

  useIsomorphicLayoutEffect(() => {
    const unsubscribe = selectorContext.addEventListener(update, {
      deferred,
      shouldUpdate: shouldUpdate
        ? (operations, change) =>
            shouldUpdate(
              change as SnapshotChange<ValueOf<TRuntime['editor']>>,
              operations as
                | readonly Operation<ValueOf<TRuntime['editor']>>[]
                | undefined
            )
        : undefined,
    })

    update()

    return unsubscribe
  }, [deferred, selectorContext, shouldUpdate, update])

  return selectedState
}

export function useSlateViewState<
  T,
  TRuntime extends SlateRuntimeValue<any> = SlateRuntimeValue<any>,
>(
  root: RootKey,
  selector: (state: EditorStateView<ValueOf<TRuntime['editor']>>) => T,
  {
    deferred,
    deps,
    equalityFn = refEquality,
    shouldUpdate,
  }: SlateRuntimeStateSelectorOptions<T, TRuntime> = {}
): T {
  const { getView, selectorContext } = useRequiredSlateRuntimeContext()
  const selectorDeps = deps ?? [selector]
  const stateSelector = useCallback(
    () => getView({ root }).read((state) => selector(state)),
    // `deps` owns inline selector closure freshness; `root` is a hook input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getView, root, ...selectorDeps]
  )
  const [selectedState, update] = useGenericSelector(stateSelector, equalityFn)
  const shouldUpdateView = useCallback(
    (operations?: readonly Operation[], change?: SnapshotChange) => {
      if (!isRootAffected(root, operations, change)) {
        return false
      }

      return shouldUpdate
        ? shouldUpdate(
            change as SnapshotChange<ValueOf<TRuntime['editor']>> | undefined,
            operations as
              | readonly Operation<ValueOf<TRuntime['editor']>>[]
              | undefined
          )
        : true
    },
    [root, shouldUpdate]
  )

  useIsomorphicLayoutEffect(() => {
    const unsubscribe = selectorContext.addEventListener(update, {
      deferred,
      shouldUpdate: shouldUpdateView,
    })

    update()

    return unsubscribe
  }, [deferred, selectorContext, shouldUpdateView, update])

  return selectedState
}

export const useSlateRootState = useSlateViewState

export function useSlateActiveRoot(): RootKey {
  return useSlateRuntimeState(selectActiveRoot, {
    deps: [],
    equalityFn: rootKeyEquality,
    shouldUpdate: selectionChanged,
  })
}

export type UseSlateRootEditorOptions = Pick<EditorViewOptions, 'readOnly'>

export type SlateRootEditor<
  V extends Value = Value,
  TExtensions extends readonly unknown[] = readonly [],
> = ReactEditorType<V, TExtensions> &
  ReactRuntimeEditor<V> &
  Omit<EditorView<V, TExtensions>, 'api' | 'getApi' | 'read' | 'update'>

export function useSlateRootEditor<
  V extends Value = Value,
  const TExtensions extends readonly unknown[] = readonly [],
>(
  root: RootKey = MAIN_ROOT_KEY,
  options: UseSlateRootEditorOptions = {}
): SlateRootEditor<V, TExtensions> {
  const { getView } = useRequiredSlateRuntimeContext()

  return useMemo(
    () =>
      createReactRuntimeViewEditor(
        getView({ readOnly: options.readOnly, root }) as EditorView<
          V,
          TExtensions
        >
      ) as SlateRootEditor<V, TExtensions>,
    [getView, options.readOnly, root]
  )
}

export function useSlateActiveEditor<
  V extends Value = Value,
  const TExtensions extends readonly unknown[] = readonly [],
>(): SlateRootEditor<V, TExtensions> {
  return useSlateRootEditor<V, TExtensions>(useSlateActiveRoot())
}

export type UseSlateViewEffectOptions = {
  deps?: DependencyList
  root?: RootKey
}

export type SlateCommandFocusPolicy = 'none' | 'preserve' | 'restore-root'

export type UseSlateCommandCallbackOptions = {
  focus?: SlateCommandFocusPolicy
  root?: RootKey
}

const useSlateResolvedRoot = (root: RootKey | undefined): RootKey => {
  const editableRoot = useContext(SlateEditableRootContext)
  const activeRoot = useSlateActiveRoot()

  return root ?? editableRoot ?? activeRoot
}

const useLatestCallbackCell = <T extends (...args: any[]) => any>(
  callback: T
) => {
  const [cell] = useState(() => ({ current: callback }))

  useIsomorphicLayoutEffect(() => {
    cell.current = callback
  }, [callback, cell])

  return cell
}

export function useSlateViewEffect<
  V extends Value = Value,
  const TExtensions extends readonly unknown[] = readonly [],
>(
  effect: (editor: SlateRootEditor<V, TExtensions>) => void | (() => void),
  options: UseSlateViewEffectOptions = {}
) {
  const { deps, root } = options
  const resolvedRoot = useSlateResolvedRoot(root)
  const { getMountedViewEditor, registerViewEffect } =
    useRequiredSlateRuntimeContext()
  const fallbackEditor = useSlateRootEditor<V, TExtensions>(resolvedRoot)
  const effectCell = useLatestCallbackCell(effect)
  const [cleanupCell] = useState<{
    current: void | (() => void)
  }>(() => ({ current: undefined }))
  const effectDeps =
    deps === undefined
      ? undefined
      : [
          cleanupCell,
          effectCell,
          fallbackEditor,
          getMountedViewEditor,
          registerViewEffect,
          resolvedRoot,
          ...deps,
        ]

  useIsomorphicLayoutEffect(
    () => {
      const unregister = registerViewEffect(() => {
        cleanupCell.current?.()
        cleanupCell.current = undefined

        const mountedEditor =
          getMountedViewEditor(resolvedRoot) ?? fallbackEditor
        const cleanup = effectCell.current(
          mountedEditor as SlateRootEditor<V, TExtensions>
        )

        cleanupCell.current = cleanup
      })

      return () => {
        unregister()
        cleanupCell.current?.()
        cleanupCell.current = undefined
      }
    },
    // Omitted `deps` keeps normal effect semantics: rerun after every React
    // render. Explicit `deps` keeps hook-owned cells stable while letting
    // callers opt into precise React-only reruns.
    effectDeps
  )
}

export function useSlateCommandCallback<
  TArgs extends unknown[],
  TResult,
  V extends Value = Value,
  const TExtensions extends readonly unknown[] = readonly [],
>(
  callback: (
    editor: SlateRootEditor<V, TExtensions>,
    ...args: TArgs
  ) => TResult,
  options: UseSlateCommandCallbackOptions = {}
): (...args: TArgs) => TResult {
  const { focus = 'preserve', root } = options
  const resolvedRoot = useSlateResolvedRoot(root)
  const context = useRequiredSlateRuntimeContext()
  const fallbackEditor = useSlateRootEditor<V, TExtensions>(resolvedRoot)
  const callbackCell = useLatestCallbackCell(callback)

  return useCallback(
    (...args: TArgs) => {
      const mountedEditor =
        context.getMountedViewEditor(resolvedRoot) ?? fallbackEditor
      const commandEditor = mountedEditor as SlateRootEditor<V, TExtensions>

      if (focus === 'restore-root') {
        focusSlateEditable(commandEditor)
      }

      return callbackCell.current(commandEditor, ...args)
    },
    [callbackCell, context, fallbackEditor, focus, resolvedRoot]
  )
}
