import { node as getNode } from '../editor/node'
import { nodes as getNodes } from '../editor/nodes'
import { publishRangeRefDrafts, resetRangeRefDrafts } from '../editor/range-ref'
import type {
  CreateEditorOptions,
  DirtyRegion,
  Editor,
  EditorCommit,
  EditorCommitCommand,
  EditorCommitContext,
  EditorCommitHandler,
  EditorCommitSource,
  EditorCoreStateView,
  EditorCoreUpdateTransaction,
  EditorDocumentValue,
  EditorFragmentReadOptions,
  EditorMarks,
  EditorNodesOptions,
  EditorNormalizerTransaction,
  EditorSnapshot,
  EditorStateField,
  EditorStateNodesApi,
  EditorStatePatch,
  EditorStateView,
  EditorTargetRuntime,
  EditorTransaction,
  EditorUpdateContext,
  EditorUpdateMetadata,
  EditorUpdateOptions,
  EditorUpdateTag,
  EditorUpdateTransaction,
  OperationClass,
  RootKey,
  RuntimeId,
  Selection,
  SnapshotChange,
  SnapshotIndex,
  SnapshotInput,
  SnapshotListener,
  StateFieldValueInput,
  TopLevelRuntimeRange,
  Value,
} from '../interfaces/editor'
import type { Location, Span } from '../interfaces/location'
import {
  type Ancestor,
  type Descendant,
  type DescendantIn,
  NodeApi,
  type NodeEntry,
  type Node as SlateNode,
} from '../interfaces/node'
import type { Operation } from '../interfaces/operation'
import { type Path, PathApi } from '../interfaces/path'
import { PointApi } from '../interfaces/point'
import { RangeApi } from '../interfaces/range'
import type { Text } from '../interfaces/text'
import { getCommonLocationRoot } from '../internal/root-location'
import { createSetSelectionOperation } from '../selection-operation'
import {
  getOrCreateRuntimeId,
  seedRuntimeIds,
  seedRuntimeIdsFromIndex,
  setRuntimeId,
} from '../utils/runtime-ids'
import { getEditorRuntime, getEditorSchema } from './editor-runtime'
import { getExtensionRegistry } from './extension-registry'
import {
  executeQueryMiddleware,
  isExecutingQueryMiddleware,
} from './query-middleware'
import { getEditorTransformRegistry } from './transform-registry'

type TransactionSnapshot = {
  afterCommitHandlers: TransactionAfterCommitHandler[]
  children: readonly Descendant[]
  childrenRoot: string
  marks: EditorMarks | null
  metadata: EditorUpdateMetadata
  operations: Operation[]
  documentState: Record<string, unknown> | undefined
  rootIndexes: Record<string, RuntimeIndexLike>
  roots: Record<string, Descendant[]>
  statePatches: EditorStatePatch[]
  tags: Set<EditorUpdateTag>
  implicitTarget: Selection
  implicitTargetResolved: boolean
  previousIndex: RuntimeIndexLike
  previousSnapshot: EditorSnapshot | null
  previousVersion: number
  command: EditorCommitCommand | null
  reason: 'replace' | null
  selection: Selection
  selectionRoot: string
}

type TransactionAfterCommitHandler = {
  handler: EditorCommitHandler
  root: string
}

type MaterializedAfterCommitHandler = {
  context: EditorCommitContext
  handler: EditorCommitHandler
}

type TransactionAuthority = 'explicit' | 'replace' | 'update'

type LiveRuntimeIndex = {
  idToPath: Map<RuntimeId, Path>
  pathToId: Map<string, RuntimeId>
}

type RuntimeIndexLike = SnapshotIndex | LiveRuntimeIndex

type CommitRuntimeDirtiness = Pick<
  EditorCommit,
  | 'affectedNodeRuntimeIds'
  | 'affectedProjectionRuntimeIds'
  | 'affectedSelectionRuntimeIds'
  | 'affectedTextRuntimeIds'
  | 'dirtyElementRuntimeIds'
  | 'dirtyTextRuntimeIds'
  | 'dirtyTopLevelRanges'
  | 'dirtyTopLevelRuntimeIds'
  | 'fullDocumentChanged'
  | 'markDirtyRuntimeIds'
  | 'rootRuntimeIdsChanged'
  | 'structuralDirtyRuntimeIds'
  | 'textDirtyRuntimeIds'
  | 'topLevelOrderChanged'
>

const KNOWN_OPERATION_TYPES = new Set([
  'insert_node',
  'insert_text',
  'merge_node',
  'move_node',
  'remove_node',
  'remove_text',
  'replace_children',
  'replace_fragment',
  'set_node',
  'set_selection',
  'split_node',
])

const assertKnownReplayOperation = (operation: unknown) => {
  const value = operation as { root?: unknown; type?: unknown } | null
  const type = value?.type

  if (typeof type === 'string' && KNOWN_OPERATION_TYPES.has(type)) {
    if (value?.root !== undefined && typeof value.root !== 'string') {
      throw new Error(`Cannot replay an invalid Slate operation: "${type}".`)
    }

    return
  }

  const label = typeof type === 'string' ? `"${type}"` : 'unknown'

  throw new Error(`Cannot replay an unknown Slate operation: ${label}.`)
}

const CHILDREN = new WeakMap<Editor, Descendant[]>()
const ROOTS = new WeakMap<Editor, Record<string, Descendant[]>>()
const DOCUMENT_STATE = new WeakMap<
  Editor,
  Record<string, unknown> | undefined
>()
const STATE_FIELDS = new WeakMap<Editor, Map<string, EditorStateField<any>>>()
const CURRENT_MARKS = new WeakMap<Editor, EditorMarks | null>()
const CURRENT_SELECTION = new WeakMap<Editor, Selection>()
const CURRENT_SELECTION_ROOT = new WeakMap<Editor, string>()
const LISTENERS = new WeakMap<Editor, Set<SnapshotListener>>()
const SOURCE_LISTENERS = new WeakMap<
  Editor,
  Map<EditorCommitSource, Set<SnapshotListener>>
>()
const LAST_COMMIT = new WeakMap<Editor, EditorCommit | null>()
const BASE_APPLY = new WeakMap<Editor, (operation: Operation) => void>()
const OPERATIONS = new WeakMap<Editor, Operation[]>()
const PUBLIC_OPERATIONS = new WeakMap<Editor, readonly Operation[]>()
const TARGET_RUNTIME = new WeakMap<Editor, EditorTargetRuntime>()
const TARGET_RUNTIME_ACTIVE = new WeakSet<Editor>()
const RUNTIME_INDEX_CACHE = new WeakMap<
  Editor,
  { index: LiveRuntimeIndex; version: number }
>()
const RUNTIME_INDEX_VERSION = new WeakMap<Editor, number>()
const SNAPSHOT_CACHE = new WeakMap<Editor, EditorSnapshot>()
const SNAPSHOT_VERSION = new WeakMap<Editor, number>()
const MUTATION_VERSION = new WeakMap<Editor, number>()
const DEFAULT_IS_NORMALIZING = new WeakMap<Editor, unknown>()
const DEFAULT_NORMALIZE_NODE = new WeakMap<Editor, unknown>()
const DEFAULT_SHOULD_NORMALIZE = new WeakMap<Editor, unknown>()
const TRANSACTION_CHANGED = new WeakMap<Editor, boolean>()
const TRANSACTION_APPLY = new WeakMap<Editor, (operation: Operation) => void>()
const COMMAND_CONTEXT = new WeakMap<Editor, EditorCommitCommand[]>()
const READ_DEPTH = new WeakMap<Editor, number>()
const TRANSACTION_DEPTH = new WeakMap<Editor, number>()
const TRANSACTION_SNAPSHOT = new WeakMap<Editor, TransactionSnapshot>()
const TRANSACTION_VIEW = new WeakMap<Editor, EditorTransaction>()
const UPDATE_TAG_CONTEXT = new WeakMap<Editor, EditorUpdateTag[][]>()
const ACTIVE_OPERATION_ROOT = new WeakMap<Editor, string>()
const ACTIVE_CHILDREN_ROOT = new WeakMap<Editor, string>()
const CURRENT_CHILDREN_ROOT = new WeakMap<Editor, string>()

const cloneValue = <T>(value: T): T => structuredClone(value)
const cloneFrozen = <T>(value: T): T => deepFreeze(cloneValue(value))
const MAIN_ROOT_KEY = 'main'

const getReadLocationRoot = (
  ...locations: Array<Location | Span | undefined>
) => {
  const root = getCommonLocationRoot(...locations)

  if (root === null) {
    throw new Error('Cannot read a Slate location across multiple roots.')
  }

  return root
}

const usesImplicitSelectionLocation = (
  options: { at?: Location | Span } | undefined
) => options?.at === undefined

export const getEditorChildrenRoot = (editor: Editor): string | undefined =>
  ACTIVE_CHILDREN_ROOT.get(editor)

const getCurrentChildrenRoot = (editor: Editor): string =>
  CURRENT_CHILDREN_ROOT.get(editor) ?? MAIN_ROOT_KEY

const withLocationRootRead = <T>(
  editor: Editor,
  location: Location | Span | undefined,
  fn: () => T,
  options?: { selectionFallback?: boolean }
): T => {
  const root =
    getReadLocationRoot(location) ??
    getEditorChildrenRoot(editor) ??
    (options?.selectionFallback && getCurrentSelection(editor)
      ? getCurrentSelectionRoot(editor)
      : undefined)

  return root ? withEditorRootChildren(editor, root, fn) : fn()
}

const withOptionsRootRead = <T>(
  editor: Editor,
  options: { at?: Location | Span } | undefined,
  fn: () => T,
  queryOptions?: { selectionFallback?: boolean }
): T => withLocationRootRead(editor, options?.at, fn, queryOptions)

const withOptionsRootGenerator = <T>(
  editor: Editor,
  options: { at?: Location | Span } | undefined,
  create: () => Iterable<T>,
  queryOptions?: { selectionFallback?: boolean }
): Generator<T, void, undefined> =>
  (function* rootedReadGenerator() {
    const root =
      getReadLocationRoot(options?.at) ??
      getEditorChildrenRoot(editor) ??
      (queryOptions?.selectionFallback && getCurrentSelection(editor)
        ? getCurrentSelectionRoot(editor)
        : undefined)

    if (root) {
      yield* withEditorRootChildrenGenerator(editor, root, create)
      return
    }

    yield* create()
  })()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const areSerializableValuesEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true
  }

  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

const cloneDocumentState = (
  state: unknown
): Record<string, unknown> | undefined => {
  if (state === undefined) {
    return undefined
  }

  if (!isRecord(state)) {
    throw new Error(
      '[Slate] initialValue.state is invalid! Expected an object.'
    )
  }

  return cloneValue(state)
}

const resolveStateFieldInitial = <TValue>(
  field: EditorStateField<TValue>
): TValue | undefined =>
  field.initial === undefined
    ? undefined
    : typeof field.initial === 'function'
      ? (field.initial as () => TValue)()
      : field.initial

const getStateFieldMap = (editor: Editor) => {
  let fields = STATE_FIELDS.get(editor)

  if (!fields) {
    fields = new Map()
    STATE_FIELDS.set(editor, fields)
  }

  return fields
}

export const registerStateField = <TValue>(
  editor: Editor,
  field: EditorStateField<TValue>
) => {
  getStateFieldMap(editor).set(field.key, field)

  const existingState = DOCUMENT_STATE.get(editor)

  if (existingState && Object.hasOwn(existingState, field.key)) {
    return
  }

  const initial = resolveStateFieldInitial(field)

  if (initial === undefined) {
    return
  }

  DOCUMENT_STATE.set(editor, {
    ...(existingState ?? {}),
    [field.key]: cloneValue(initial),
  })
}

const getStateFieldValue = <TValue>(
  editor: Editor,
  field: EditorStateField<TValue>
): TValue => {
  if (!getStateFieldMap(editor).has(field.key)) {
    registerStateField(editor, field)
  }

  const state = DOCUMENT_STATE.get(editor)

  if (state && Object.hasOwn(state, field.key)) {
    return cloneFrozen(state[field.key]) as TValue
  }

  return cloneFrozen(resolveStateFieldInitial(field)) as TValue
}

const resolveStateFieldValue = <TValue>(
  previous: TValue,
  value: StateFieldValueInput<TValue>
): TValue =>
  typeof value === 'function'
    ? (value as (previous: TValue) => TValue)(previous)
    : value

const hasStateFieldPatchHooks = <TValue>(field: EditorStateField<TValue>) =>
  typeof field.diff === 'function' &&
  typeof field.applyPatch === 'function' &&
  typeof field.invertPatch === 'function'

const isCompactStatePatch = (
  patch: EditorStatePatch
): patch is EditorStatePatch & { inversePatch: unknown; patch: unknown } =>
  Object.hasOwn(patch, 'patch') && Object.hasOwn(patch, 'inversePatch')

const createStatePatch = (
  editor: Editor,
  key: string,
  previousValue: unknown,
  nextValue: unknown
): EditorStatePatch => {
  const field = getStateFieldMap(editor).get(key)

  if (field && hasStateFieldPatchHooks(field)) {
    const patch = field.diff!(previousValue, nextValue)

    return {
      inversePatch: field.invertPatch!(patch, previousValue, nextValue),
      key,
      patch,
    }
  }

  return {
    key,
    previousValue: cloneValue(previousValue),
    value: cloneValue(nextValue),
  }
}

const assertStateFieldPatchPolicy = <TValue>(
  field: EditorStateField<TValue>,
  previousValue: TValue,
  nextValue: TValue
) => {
  const needsReplayablePatch =
    field.history !== 'skip' || field.collab === 'shared'

  if (!needsReplayablePatch || hasStateFieldPatchHooks(field)) {
    return
  }

  const serializedSize =
    JSON.stringify({
      key: field.key,
      previousValue,
      value: nextValue,
    })?.length ?? 0

  if (serializedSize <= 32_768) {
    return
  }

  throw new Error(
    `State field "${field.key}" stores a large shared/history value without patch hooks. Add diff/applyPatch/invertPatch or mark the field non-shared/history-skip.`
  )
}

const setStateFieldValue = <TValue>(
  editor: Editor,
  field: EditorStateField<TValue>,
  value: StateFieldValueInput<TValue>
) => {
  registerStateField(editor, field)

  const previousValue = getStateFieldValue(editor, field)
  const nextValue = resolveStateFieldValue(previousValue, value)

  if (Object.is(previousValue, nextValue)) {
    return
  }

  assertStateFieldPatchPolicy(field, previousValue, nextValue)

  setStateValueByKey(editor, field.key, nextValue, previousValue)
}

const setStateValueByKey = (
  editor: Editor,
  key: string,
  nextValue: unknown,
  previousValue = DOCUMENT_STATE.get(editor)?.[key]
) => {
  const existingState = DOCUMENT_STATE.get(editor)
  const hadKey = existingState ? Object.hasOwn(existingState, key) : false

  if (
    Object.is(previousValue, nextValue) &&
    (nextValue !== undefined || !hadKey)
  ) {
    return
  }

  const nextState = { ...(existingState ?? {}) }

  if (nextValue === undefined) {
    delete nextState[key]
  } else {
    nextState[key] = cloneValue(nextValue)
  }

  if (Object.keys(nextState).length === 0) {
    DOCUMENT_STATE.delete(editor)
  } else {
    DOCUMENT_STATE.set(editor, nextState)
  }

  const snapshot = TRANSACTION_SNAPSHOT.get(editor)
  if (snapshot) {
    const patchIndex = snapshot.statePatches.findIndex(
      (statePatch) => statePatch.key === key
    )
    const baseline =
      snapshot.documentState && Object.hasOwn(snapshot.documentState, key)
        ? snapshot.documentState[key]
        : undefined

    if (areSerializableValuesEqual(baseline, nextValue)) {
      if (patchIndex >= 0) {
        snapshot.statePatches.splice(patchIndex, 1)
      }
    } else {
      const nextPatch = createStatePatch(editor, key, baseline, nextValue)

      if (patchIndex >= 0) {
        snapshot.statePatches[patchIndex] = nextPatch
      } else {
        snapshot.statePatches.push(nextPatch)
      }
    }
  }

  markTransactionChanged(editor)
}

export const applyStatePatches = (
  editor: Editor,
  patches: readonly EditorStatePatch[],
  direction: 'redo' | 'undo'
) => {
  const orderedPatches = direction === 'undo' ? [...patches].reverse() : patches

  for (const patch of orderedPatches) {
    const field = getStateFieldMap(editor).get(patch.key)

    if (isCompactStatePatch(patch)) {
      if (!field?.applyPatch) {
        throw new Error(
          `State field "${patch.key}" cannot replay a compact patch without applyPatch.`
        )
      }

      const patchValue = direction === 'undo' ? patch.inversePatch : patch.patch
      const previousValue = getStateFieldValue(editor, field)
      const nextValue = field.applyPatch(previousValue, patchValue)

      setStateValueByKey(editor, patch.key, nextValue, previousValue)
      continue
    }

    setStateValueByKey(
      editor,
      patch.key,
      direction === 'undo' ? patch.previousValue : patch.value
    )
  }
}

export const shouldSaveStatePatch = (
  editor: Editor,
  patch: EditorStatePatch
): boolean => getStateFieldMap(editor).get(patch.key)?.history !== 'skip'

export const getCollabStatePatches = (
  editor: Editor,
  commit: EditorCommit
): readonly EditorStatePatch[] =>
  cloneFrozen(
    commit.statePatches.filter(
      (patch) => getStateFieldMap(editor).get(patch.key)?.collab === 'shared'
    )
  )

const normalizeInitialValue = (input: unknown) => {
  if (input === undefined) {
    return {
      children: [] as Descendant[],
      explicit: false,
      roots: { [MAIN_ROOT_KEY]: [] as Descendant[] },
      state: undefined,
    }
  }

  if (Array.isArray(input)) {
    const children = cloneValue([...input]) as Descendant[]

    return {
      children,
      explicit: true,
      roots: { [MAIN_ROOT_KEY]: children },
      state: undefined,
    }
  }

  if (!isRecord(input)) {
    throw new Error(
      '[Slate] initialValue is invalid! Expected a list of elements or a document value.'
    )
  }

  if (Array.isArray(input.children)) {
    const children = cloneValue([...input.children]) as Descendant[]

    return {
      children,
      explicit: true,
      roots: { [MAIN_ROOT_KEY]: children },
      state: cloneDocumentState(input.state),
    }
  }

  if (isRecord(input.roots)) {
    const roots: Record<string, Descendant[]> = {}

    for (const [key, value] of Object.entries(input.roots)) {
      if (!Array.isArray(value)) {
        throw new Error(
          `[Slate] initialValue.roots.${key} is invalid! Expected a list of elements.`
        )
      }

      roots[key] = cloneValue([...value]) as Descendant[]
    }

    const children = roots[MAIN_ROOT_KEY]

    if (!children) {
      throw new Error(
        '[Slate] initialValue.roots is invalid! Expected a "main" root.'
      )
    }

    return {
      children,
      explicit: true,
      roots,
      state: cloneDocumentState(input.state),
    }
  }

  throw new Error(
    '[Slate] initialValue is invalid! Expected a list of elements or a document value.'
  )
}

const now = () => globalThis.performance?.now?.() ?? Date.now()

const getExplicitRangeRoot = (value: unknown): string | undefined => {
  if (!RangeApi.isRange(value)) {
    return undefined
  }

  const anchorRoot = value.anchor.root
  const focusRoot = value.focus.root

  if (anchorRoot && focusRoot && anchorRoot !== focusRoot) {
    return undefined
  }

  return anchorRoot ?? focusRoot
}

const getExplicitLocationRoot = (
  location: Location | undefined
): string | undefined => {
  if (!location || Array.isArray(location)) {
    return undefined
  }

  if ('path' in location && 'offset' in location) {
    return typeof location.root === 'string' ? location.root : undefined
  }

  return getExplicitRangeRoot(location)
}

const getImplicitSelectionRoot = (editor: Editor): string | undefined =>
  getCurrentSelection(editor) ? getCurrentSelectionRoot(editor) : undefined

const getActiveMutationRoot = (editor: Editor): string | undefined =>
  ACTIVE_CHILDREN_ROOT.get(editor) ?? ACTIVE_OPERATION_ROOT.get(editor)

const getMutationRoot = (
  editor: Editor,
  options?: { at?: Location }
): string | undefined => {
  if (options?.at !== undefined) {
    return getExplicitLocationRoot(options.at)
  }

  const activeRoot = getActiveMutationRoot(editor)
  const selectionRoot = getImplicitSelectionRoot(editor)

  if (!selectionRoot) {
    return activeRoot
  }

  if (!activeRoot || activeRoot === selectionRoot) {
    return selectionRoot
  }

  const transactionSnapshot = TRANSACTION_SNAPSHOT.get(editor)

  return transactionSnapshot &&
    transactionSnapshot.selectionRoot !== selectionRoot
    ? selectionRoot
    : activeRoot
}

const getLocationMutationRoot = (
  editor: Editor,
  location: Location
): string | undefined =>
  getExplicitLocationRoot(location) ??
  getActiveMutationRoot(editor) ??
  MAIN_ROOT_KEY

const runWithMutationRoot = <T>(
  editor: Editor,
  root: string | undefined,
  fn: () => T
): T =>
  root
    ? withEditorOperationRoot(editor, root, () =>
        withEditorOperationRootChildren(editor, root, fn)
      )
    : fn()

const getExplicitSelectionOperationRoot = (
  operation: Operation
): string | undefined => {
  if (operation.type !== 'set_selection') {
    return undefined
  }

  return operation.newProperties === null
    ? getExplicitRangeRoot(operation.properties)
    : getExplicitRangeRoot(operation.newProperties)
}

const withDefaultOperationRoot = (
  editor: Editor,
  operation: Operation
): Operation => {
  switch (operation.type) {
    case 'insert_node':
    case 'insert_text':
    case 'merge_node':
    case 'move_node':
    case 'remove_node':
    case 'remove_text':
    case 'replace_children':
    case 'replace_fragment':
    case 'set_node':
    case 'set_selection':
    case 'split_node':
      return operation.root === undefined
        ? {
            ...operation,
            root:
              getExplicitSelectionOperationRoot(operation) ??
              ACTIVE_OPERATION_ROOT.get(editor) ??
              MAIN_ROOT_KEY,
          }
        : operation
    default:
      return operation
  }
}

const getOperationRoot = (operation: Operation): string | null => {
  switch (operation.type) {
    case 'insert_node':
    case 'insert_text':
    case 'merge_node':
    case 'move_node':
    case 'remove_node':
    case 'remove_text':
    case 'replace_children':
    case 'replace_fragment':
    case 'set_node':
    case 'set_selection':
    case 'split_node':
      return operation.root ?? MAIN_ROOT_KEY
    default:
      return null
  }
}

const createRootReplaceChildrenOperation = <V extends Value>(
  root: RootKey,
  children: readonly Descendant[],
  newChildren: readonly Descendant[],
  options: {
    rootIsPresent: boolean
    rootWasPresent: boolean
  }
): Extract<Operation<V>, { type: 'replace_children' }> => ({
  children: cloneValue([...children]) as DescendantIn<V>[],
  index: 0,
  newChildren: cloneValue([...newChildren]) as DescendantIn<V>[],
  newSelection: null,
  path: [],
  root,
  rootIsPresent: options.rootIsPresent,
  rootWasPresent: options.rootWasPresent,
  selection: null,
  type: 'replace_children',
})

const requireMutableRoot = (root: RootKey) => {
  if (root === MAIN_ROOT_KEY) {
    throw new Error('Cannot mutate the main editor root through tx.roots.')
  }
}

const withRootLifecycleDefaults = (
  editor: Editor,
  operation: Operation
): Operation => {
  if (
    operation.type !== 'replace_children' ||
    operation.path.length > 0 ||
    operation.root === undefined ||
    operation.root === MAIN_ROOT_KEY
  ) {
    return operation
  }

  const rootWasPresent =
    operation.rootWasPresent ??
    Object.hasOwn(getEditorDocumentRoots(editor), operation.root)

  return {
    ...operation,
    rootIsPresent: operation.rootIsPresent ?? true,
    rootWasPresent,
  }
}

const profileCoreDuration = <T>(id: string, callback: () => T): T => {
  const profiler = (
    globalThis as typeof globalThis & {
      __SLATE_REACT_RENDER_PROFILER__?: {
        record?: (event: {
          duration: number
          id: string
          kind: 'core-time'
        }) => void
      }
    }
  ).__SLATE_REACT_RENDER_PROFILER__

  if (!profiler) {
    return callback()
  }

  const start = now()

  try {
    return callback()
  } finally {
    profiler.record?.({
      duration: now() - start,
      id,
      kind: 'core-time',
    })
  }
}

const cloneUpdateMetadata = (
  metadata: EditorUpdateMetadata = {}
): EditorUpdateMetadata => cloneFrozen(metadata)

const mergeUpdateMetadata = (
  previous: EditorUpdateMetadata,
  next: EditorUpdateMetadata = {}
): EditorUpdateMetadata =>
  cloneUpdateMetadata({
    ...previous,
    ...next,
    collab: next.collab
      ? { ...previous.collab, ...next.collab }
      : previous.collab,
    history: next.history
      ? { ...previous.history, ...next.history }
      : previous.history,
    origin: next.origin ?? previous.origin,
    selection: next.selection
      ? { ...previous.selection, ...next.selection }
      : previous.selection,
  })

const deepFreeze = <T>(value: T): T => {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }

  Object.freeze(value)

  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }

  return value
}

const pathKey = (path: Path) => path.join('.')

const bumpRuntimeIndexVersion = (editor: Editor) => {
  RUNTIME_INDEX_VERSION.set(
    editor,
    (RUNTIME_INDEX_VERSION.get(editor) ?? 0) + 1
  )
  RUNTIME_INDEX_CACHE.delete(editor)
}

const getRuntimeIndexVersion = (editor: Editor) =>
  RUNTIME_INDEX_VERSION.get(editor) ?? 0

const operationInvalidatesRuntimeIndex = (operation: Operation) => {
  switch (operation.type) {
    case 'insert_node':
    case 'merge_node':
    case 'move_node':
    case 'replace_children':
    case 'remove_node':
    case 'split_node':
      return true
    default:
      return false
  }
}

const buildLiveRuntimeIndex = (editor: Editor): LiveRuntimeIndex => {
  const idToPath = new Map<RuntimeId, Path>()
  const pathToId = new Map<string, RuntimeId>()

  const visit = (nodes: readonly Descendant[], pathPrefix: Path) => {
    nodes.forEach((node, index) => {
      const path = Object.freeze([...pathPrefix, index]) as Path
      const runtimeId = getOrCreateRuntimeId(node, editor)

      idToPath.set(runtimeId, path)
      pathToId.set(pathKey(path), runtimeId)

      if ('children' in node && Array.isArray(node.children)) {
        visit(node.children, path)
      }
    })
  }

  visit(getChildren(editor), [])

  return { idToPath, pathToId }
}

const getLiveRuntimeIndex = (editor: Editor) => {
  const version = getRuntimeIndexVersion(editor)
  const cached = RUNTIME_INDEX_CACHE.get(editor)

  if (cached?.version === version) {
    return cached.index
  }

  const index = buildLiveRuntimeIndex(editor)
  RUNTIME_INDEX_CACHE.set(editor, { index, version })
  return index
}

const getLiveRuntimeIdAtPath = (
  editor: Editor,
  path: Path
): RuntimeId | null => {
  if (path.length === 0) {
    return null
  }

  const node = getLiveNode(editor, path)

  return node && typeof node === 'object'
    ? getOrCreateRuntimeId(node, editor)
    : null
}

const getTopLevelRange = (
  paths: readonly Path[]
): readonly [number, number] | null => {
  const topLevelIndexes = paths
    .filter((path) => path.length > 0)
    .map((path) => path[0]!)

  if (topLevelIndexes.length === 0) {
    return null
  }

  return [Math.min(...topLevelIndexes), Math.max(...topLevelIndexes)]
}

const getTopLevelRanges = (paths: readonly Path[]): TopLevelRuntimeRange[] => {
  const indexes = Array.from(
    new Set(paths.filter((path) => path.length > 0).map((path) => path[0]!))
  ).sort((a, b) => a - b)

  if (indexes.length === 0) {
    return []
  }

  const ranges: TopLevelRuntimeRange[] = []
  let start = indexes[0]!
  let end = start

  for (const index of indexes.slice(1)) {
    if (index === end + 1) {
      end = index
      continue
    }

    ranges.push([start, end])
    start = index
    end = index
  }

  ranges.push([start, end])

  return ranges
}

const buildDirtyRegion = (change: {
  dirtyPaths: readonly Path[]
  dirtyScope: 'none' | 'paths' | 'all'
  touchedRuntimeIds: readonly RuntimeId[] | null
}): DirtyRegion =>
  Object.freeze({
    paths: Object.freeze([...change.dirtyPaths]),
    runtimeIds: Object.freeze([...(change.touchedRuntimeIds ?? [])]),
    topLevelRange:
      change.dirtyScope === 'all' ? null : getTopLevelRange(change.dirtyPaths),
    wholeDocument: change.dirtyScope === 'all',
  })

const freezeRuntimeIds = (
  runtimeIds: readonly RuntimeId[] | null
): readonly RuntimeId[] | null =>
  runtimeIds == null ? null : Object.freeze([...runtimeIds])

const freezeTopLevelRanges = (
  ranges: readonly TopLevelRuntimeRange[] | null
): readonly TopLevelRuntimeRange[] | null =>
  ranges == null
    ? null
    : Object.freeze(
        ranges.map((range) => Object.freeze([...range]) as TopLevelRuntimeRange)
      )

const completeCommit = (
  change: Omit<
    EditorCommit,
    | 'dirty'
    | 'previousVersion'
    | 'snapshotChanged'
    | 'structureChanged'
    | 'textChanged'
    | 'version'
  >,
  {
    previousVersion,
    version,
  }: {
    previousVersion: number
    version: number
  }
): EditorCommit => {
  const textChanged = change.classes.includes('text')
  const structureChanged =
    change.classes.includes('structural') || change.classes.includes('replace')

  return Object.freeze({
    ...change,
    affectedNodeRuntimeIds: freezeRuntimeIds(change.affectedNodeRuntimeIds),
    affectedProjectionRuntimeIds: freezeRuntimeIds(
      change.affectedProjectionRuntimeIds
    ),
    affectedSelectionRuntimeIds: freezeRuntimeIds(
      change.affectedSelectionRuntimeIds
    ),
    affectedTextRuntimeIds: freezeRuntimeIds(change.affectedTextRuntimeIds),
    decorationImpactRuntimeIds:
      change.decorationImpactRuntimeIds == null
        ? null
        : Object.freeze([...change.decorationImpactRuntimeIds]),
    dirty: buildDirtyRegion(change),
    dirtyElementRuntimeIds: freezeRuntimeIds(change.dirtyElementRuntimeIds),
    dirtyTextRuntimeIds: freezeRuntimeIds(change.dirtyTextRuntimeIds),
    dirtyTopLevelRanges: freezeTopLevelRanges(change.dirtyTopLevelRanges),
    dirtyTopLevelRuntimeIds: freezeRuntimeIds(change.dirtyTopLevelRuntimeIds),
    dirtyStateKeys: Object.freeze([...change.dirtyStateKeys]),
    markDirtyRuntimeIds: freezeRuntimeIds(change.markDirtyRuntimeIds),
    metadata: cloneUpdateMetadata(change.metadata),
    nodeImpactRuntimeIds:
      change.nodeImpactRuntimeIds == null
        ? null
        : Object.freeze([...change.nodeImpactRuntimeIds]),
    previousVersion,
    snapshotChanged:
      change.childrenChanged ||
      change.selectionChanged ||
      change.marksChanged ||
      change.statePatches.length > 0,
    statePatches: Object.freeze(cloneValue([...change.statePatches])),
    structureChanged,
    selectionImpactRuntimeIds:
      change.selectionImpactRuntimeIds == null
        ? null
        : Object.freeze([...change.selectionImpactRuntimeIds]),
    structuralDirtyRuntimeIds: freezeRuntimeIds(
      change.structuralDirtyRuntimeIds
    ),
    tags: Object.freeze([...(change.tags ?? [])]),
    textChanged,
    textDirtyRuntimeIds: freezeRuntimeIds(change.textDirtyRuntimeIds),
    version,
  })
}

const buildSnapshotIndex = (
  editor: Editor,
  children: readonly Descendant[],
  parentPath: Path = []
): SnapshotIndex => {
  const idToPath = {} as Record<RuntimeId, Path>
  const pathToId = {} as Record<string, RuntimeId>

  const visit = (nodes: readonly Descendant[], pathPrefix: Path) => {
    nodes.forEach((node, index) => {
      const path = Object.freeze([...pathPrefix, index]) as Path
      const id = getOrCreateRuntimeId(node, editor)

      idToPath[id] = path
      pathToId[pathKey(path)] = id

      if ('children' in node && Array.isArray(node.children)) {
        visit(node.children, path)
      }
    })
  }

  visit(children, parentPath)

  return Object.freeze({
    idToPath: Object.freeze(idToPath),
    pathToId: Object.freeze(pathToId),
  })
}

const getVersion = (editor: Editor) => SNAPSHOT_VERSION.get(editor) ?? 0
export const getMutationVersion = (editor: Editor) =>
  MUTATION_VERSION.get(editor) ?? 0

export const getSnapshotVersion = (editor: Editor) => getVersion(editor)

const setVersion = (editor: Editor, version: number) => {
  SNAPSHOT_VERSION.set(editor, version)
  SNAPSHOT_CACHE.delete(editor)
}

const bumpMutationVersion = (editor: Editor) => {
  MUTATION_VERSION.set(editor, getMutationVersion(editor) + 1)
}

export const isInTransaction = (editor: Editor) =>
  (TRANSACTION_DEPTH.get(editor) ?? 0) > 0

export const assertCanStartEditorWrite = (
  editor: Editor,
  authority?: TransactionAuthority
) => {
  if (isInTransaction(editor)) {
    return
  }

  if ((READ_DEPTH.get(editor) ?? 0) > 0) {
    throw new Error('editor writes cannot be started inside editor.read')
  }

  if (!authority) {
    throw new Error('editor writes must run inside editor.update')
  }
}

const normalizeUpdateTags = (tag?: EditorUpdateOptions['tag']) => {
  if (!tag) {
    return []
  }

  return Array.isArray(tag) ? [...tag] : [tag]
}

const withUpdateTagContext = <T>(
  editor: Editor,
  tags: readonly EditorUpdateTag[],
  fn: () => T
) => {
  if (tags.length === 0) {
    return fn()
  }

  const stack = UPDATE_TAG_CONTEXT.get(editor) ?? []
  const nextTags = [...new Set([...(stack.at(-1) ?? []), ...tags])]
  stack.push(nextTags)
  UPDATE_TAG_CONTEXT.set(editor, stack)

  const snapshot = TRANSACTION_SNAPSHOT.get(editor)

  if (snapshot) {
    for (const tag of tags) {
      snapshot.tags.add(tag)
    }
  }

  try {
    return fn()
  } finally {
    stack.pop()

    if (stack.length === 0) {
      UPDATE_TAG_CONTEXT.delete(editor)
    }
  }
}

const getCurrentUpdateTags = (editor: Editor) =>
  UPDATE_TAG_CONTEXT.get(editor)?.at(-1) ?? []

export const getCommandContext = (editor: Editor): EditorCommitCommand | null =>
  COMMAND_CONTEXT.get(editor)?.at(-1) ?? null

export const withCommandContext = <T>(
  editor: Editor,
  command: EditorCommitCommand,
  fn: () => T
): T => {
  const stack = COMMAND_CONTEXT.get(editor) ?? []
  const transactionSnapshot = TRANSACTION_SNAPSHOT.get(editor)

  if (transactionSnapshot && transactionSnapshot.command === null) {
    transactionSnapshot.command = cloneValue(command)
  }

  stack.push(command)
  COMMAND_CONTEXT.set(editor, stack)

  try {
    return fn()
  } finally {
    stack.pop()
    if (stack.length === 0) {
      COMMAND_CONTEXT.delete(editor)
    }
  }
}

export const markTransactionChanged = (editor: Editor) => {
  if (isInTransaction(editor)) {
    TRANSACTION_CHANGED.set(editor, true)
  }
}

const hasTransactionNetChanges = (
  editor: Editor,
  snapshot: TransactionSnapshot | undefined
): boolean => {
  if (!snapshot) {
    return true
  }

  if (getLiveOperations(editor).length !== snapshot.operations.length) {
    return true
  }

  if (snapshot.statePatches.length > 0) {
    return true
  }

  return (
    !areSerializableValuesEqual(
      getEditorDocumentRoots(editor),
      snapshot.roots
    ) ||
    !areSerializableValuesEqual(
      DOCUMENT_STATE.get(editor),
      snapshot.documentState
    ) ||
    !areSerializableValuesEqual(getCurrentMarks(editor), snapshot.marks) ||
    !areSerializableValuesEqual(
      getCurrentSelection(editor),
      snapshot.selection
    ) ||
    getCurrentSelectionRoot(editor) !== snapshot.selectionRoot
  )
}

export const getChildren = <V extends Value>(editor: Editor<V>): V =>
  (CHILDREN.get(editor) ?? []) as V

const getEditorDocumentRoots = (
  editor: Editor
): Record<string, Descendant[]> => {
  const children = getChildren(editor) as Descendant[]
  const storedRoots = ROOTS.get(editor)

  if (!storedRoots) {
    return {
      [MAIN_ROOT_KEY]: children,
    }
  }

  const currentRoot = getCurrentChildrenRoot(editor)

  if (!Object.hasOwn(storedRoots, currentRoot)) {
    return storedRoots
  }

  return storedRoots[currentRoot] === children
    ? storedRoots
    : {
        ...storedRoots,
        [currentRoot]: children,
      }
}

const getEditorDocumentValue = <V extends Value>(
  editor: Editor<V>
): EditorDocumentValue<V> => {
  const roots = getEditorDocumentRoots(editor) as Record<string, V>
  const state = DOCUMENT_STATE.get(editor)
  const fields = getStateFieldMap(editor)
  const persistentState =
    state === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(state).filter(
            ([key]) => fields.get(key)?.persist !== false
          )
        )
  const value =
    persistentState === undefined || Object.keys(persistentState).length === 0
      ? { roots: cloneFrozen(roots) }
      : {
          roots: cloneFrozen(roots),
          state: cloneFrozen(persistentState),
        }

  return Object.freeze(value) as EditorDocumentValue<V>
}

export const getLiveNode = (
  editor: Editor,
  path: Path
): SlateNode | undefined => {
  if (path.length === 0) {
    return editor
  }

  let node: SlateNode | undefined
  let children: Descendant[] = getChildren(editor)

  for (let index = 0; index < path.length; index += 1) {
    node = children[path[index]!]

    if (!node) {
      return undefined
    }

    if (index === path.length - 1) {
      return node
    }

    if (!('children' in node) || !Array.isArray(node.children)) {
      return undefined
    }

    children = node.children
  }

  return node
}

export const getLiveText = (editor: Editor, path: Path): Text | null => {
  const node = getLiveNode(editor, path)

  return node && 'text' in node && typeof node.text === 'string'
    ? (node as Text)
    : null
}

export const getLiveSelection = (editor: Editor): Selection =>
  getCurrentSelection(editor)

export const getRuntimeId = (editor: Editor, path: Path): RuntimeId | null => {
  if (path.length === 0) {
    return null
  }

  const indexedRuntimeId = getLiveRuntimeIndex(editor).pathToId.get(
    pathKey(path)
  )

  if (indexedRuntimeId) {
    return indexedRuntimeId
  }

  return getLiveRuntimeIdAtPath(editor, path)
}

export const getPathByRuntimeId = (
  editor: Editor,
  runtimeId: RuntimeId
): Path | null => {
  const path = getLiveRuntimeIndex(editor).idToPath.get(runtimeId)

  return path ? ([...path] as Path) : null
}

export const getOperationDirtiness = (
  editor: Editor,
  operations: readonly Operation[],
  {
    command = getCommandContext(editor),
    marksBefore = getCurrentMarks(editor),
    previousIndex,
    previousVersion = getVersion(editor),
    reason = null,
    selectionBefore = getCurrentSelection(editor),
    nextIndex,
    metadata = {},
    statePatches = [],
    tags = getCurrentUpdateTags(editor),
  }: {
    command?: EditorCommitCommand | null
    marksBefore?: EditorMarks | null
    metadata?: EditorUpdateMetadata
    nextIndex?: RuntimeIndexLike
    previousIndex?: RuntimeIndexLike
    previousVersion?: number
    reason?: 'replace' | null
    selectionBefore?: Selection
    statePatches?: readonly EditorStatePatch[]
    tags?: readonly EditorUpdateTag[]
  } = {}
): SnapshotChange => {
  const hasTextOperation = operations.some(
    (op) => op.type === 'insert_text' || op.type === 'remove_text'
  )
  const hasReplaceFragmentOperation = operations.some(
    (op) => op.type === 'replace_fragment'
  )
  const hasStructuralTextOperation = operations.some(
    operationChangesTextContent
  )
  const classes =
    reason === 'replace' || hasReplaceFragmentOperation
      ? (['replace'] as const)
      : operations.length > 0 &&
          operations.every((op) => op.type === 'set_selection')
        ? (['selection'] as const)
        : hasTextOperation &&
            operations.every(
              (op) =>
                op.type === 'insert_text' ||
                op.type === 'remove_text' ||
                op.type === 'set_selection'
            )
          ? (['text'] as const)
          : operations.length > 0
            ? hasStructuralTextOperation
              ? (['structural', 'text'] as const)
              : (['structural'] as const)
            : statePatches.length > 0
              ? (['state'] as const)
              : (['mark'] as const)
  const dirtyPaths =
    classes[0] === 'text'
      ? uniqPaths(
          operations.flatMap((op) =>
            'path' in op && Array.isArray(op.path)
              ? [[], op.path.slice(0, -1), op.path]
              : []
          )
        )
      : []
  const touchedRuntimeIds =
    classes[0] === 'replace'
      ? null
      : classes[0] === 'selection' || classes[0] === 'mark'
        ? []
        : uniqPaths(
            operations.flatMap((op) =>
              'path' in op && Array.isArray(op.path) ? [op.path] : []
            )
          )
            .map((path) => {
              const key = pathKey(path)
              const previousRuntimeId = previousIndex
                ? previousIndex.pathToId instanceof Map
                  ? previousIndex.pathToId.get(key)
                  : previousIndex.pathToId[key]
                : undefined

              return previousRuntimeId ?? getLiveRuntimeIdAtPath(editor, path)
            })
            .filter(Boolean)
  const marksAfter = getCurrentMarks(editor)
  const selectionAfter = getCurrentSelection(editor)
  const marksChanged =
    classes[0] === 'mark' ||
    JSON.stringify(marksBefore ?? null) !== JSON.stringify(marksAfter ?? null)
  const selectionChanged =
    operations.some((op) => op.type === 'set_selection') ||
    JSON.stringify(selectionBefore ?? null) !==
      JSON.stringify(selectionAfter ?? null)
  const previousRuntimeIndex = previousIndex ?? getSnapshot(editor).index
  const topLevelOrderChanged =
    classes[0] === 'structural' &&
    operations.some(operationChangesTopLevelOrder)
  const nextRuntimeIndex =
    nextIndex ??
    (topLevelOrderChanged && classes[0] === 'structural'
      ? previousRuntimeIndex
      : getLiveRuntimeIndex(editor))
  const selectionImpactRuntimeIds =
    classes[0] === 'replace' || topLevelOrderChanged
      ? null
      : getSelectionImpactRuntimeIds({
          nextIndex: nextRuntimeIndex,
          previousIndex: previousRuntimeIndex,
          selectionAfter,
          selectionBefore,
        })
  const decorationImpactRuntimeIds = getDecorationImpactRuntimeIds({
    classes,
    dirtyPaths,
    nextIndex: nextRuntimeIndex,
    previousIndex: previousRuntimeIndex,
    selectionImpactRuntimeIds,
    touchedRuntimeIds:
      touchedRuntimeIds == null ? null : (touchedRuntimeIds as RuntimeId[]),
  })
  const nodeImpactRuntimeIds = getNodeImpactRuntimeIds({
    classes,
    dirtyPaths,
    nextIndex: nextRuntimeIndex,
    previousIndex: previousRuntimeIndex,
    touchedRuntimeIds:
      touchedRuntimeIds == null ? null : (touchedRuntimeIds as RuntimeId[]),
  })
  const dirtyScope =
    classes[0] === 'replace'
      ? 'all'
      : classes[0] === 'selection' ||
          classes[0] === 'mark' ||
          classes[0] === 'state'
        ? 'none'
        : 'paths'

  return completeCommit(
    {
      ...buildCommitRuntimeDirtiness({
        classes,
        decorationImpactRuntimeIds,
        dirtyPaths,
        dirtyScope,
        nextIndex: nextRuntimeIndex,
        nodeImpactRuntimeIds,
        operations,
        previousIndex: previousRuntimeIndex,
        selectionImpactRuntimeIds,
      }),
      childrenChanged:
        classes[0] === 'replace' ||
        classes[0] === 'text' ||
        classes[0] === 'structural',
      classes,
      command: cloneValue(command),
      decorationImpactRuntimeIds,
      dirtyPaths,
      dirtyScope,
      dirtyStateKeys: Object.freeze(statePatches.map((patch) => patch.key)),
      marksAfter: cloneValue(marksAfter),
      marksBefore: cloneValue(marksBefore),
      marksChanged,
      metadata: cloneUpdateMetadata(metadata),
      nodeImpactRuntimeIds,
      operations: Object.freeze([...operations]),
      replaceEpoch: classes[0] === 'replace' ? 1 : 0,
      selectionAfter: cloneValue(selectionAfter),
      selectionBefore: cloneValue(selectionBefore),
      selectionChanged,
      selectionImpactRuntimeIds,
      statePatches: Object.freeze(cloneValue([...statePatches])),
      tags: Object.freeze([...tags]),
      touchedRuntimeIds:
        touchedRuntimeIds == null
          ? null
          : Object.freeze(touchedRuntimeIds as RuntimeId[]),
    },
    { previousVersion, version: getVersion(editor) }
  )
}

export const getLastCommit = (editor: Editor): EditorCommit | null =>
  LAST_COMMIT.get(editor) ?? null

const getSelectionMarks = <V extends Value>(
  editor: Editor<V>
): EditorMarks<V> | null => {
  const marks = getCurrentMarks(editor)
  const selection = getCurrentSelection(editor)

  if (!selection) {
    return null
  }

  if (marks) {
    return marks as EditorMarks<V>
  }

  return withEditorRootChildren(editor, getCurrentSelectionRoot(editor), () => {
    let { anchor, focus } = selection

    if (RangeApi.isExpanded(selection)) {
      if (RangeApi.isBackward(selection)) {
        ;[focus, anchor] = [anchor, focus]
      }

      if (
        PointApi.equals(
          anchor,
          getEditorRuntime(editor).point(anchor.path, { edge: 'end' })
        )
      ) {
        const after = getEditorRuntime(editor).after(anchor)

        if (after) {
          anchor = after
        }
      }

      const [match] = getNodes(editor, {
        at: { anchor, focus },
        match: NodeApi.isText,
      })

      if (match) {
        const [node] = match
        const { text, ...rest } = node

        return rest as EditorMarks<V>
      }

      return {} as EditorMarks<V>
    }

    const { path } = anchor

    if (!getEditorRuntime(editor).hasPath(path)) {
      return null
    }

    let [node] = getEditorRuntime(editor).leaf(path)

    if (anchor.offset === 0) {
      const prev = getEditorRuntime(editor).previous({
        at: path,
        match: NodeApi.isText,
      })
      const markedVoid = getEditorRuntime(editor).above({
        match: (n: SlateNode) =>
          NodeApi.isElement(n) &&
          getEditorSchema(editor).isVoid(n) &&
          getEditorSchema(editor).markableVoid(n),
      })

      if (!markedVoid) {
        const block = getEditorRuntime(editor).above({
          match: (n: SlateNode) =>
            NodeApi.isElement(n) && !getEditorSchema(editor).isInline(n),
        })

        if (prev && block) {
          const [prevNode, prevPath] = prev
          const [, blockPath] = block

          if (PathApi.isAncestor(blockPath, prevPath)) {
            node = prevNode
          }
        }
      }
    }

    const { text, ...rest } = node

    return rest as EditorMarks<V>
  })
}

const createNodesToArray = (editor: Editor): EditorStateNodesApi['toArray'] => {
  function toArray<T extends SlateNode>(
    options?: EditorNodesOptions<T>
  ): NodeEntry<T>[]
  function toArray<T extends SlateNode, R>(
    options: EditorNodesOptions<T> | undefined,
    map: (entry: NodeEntry<T>) => R
  ): R[]
  function toArray<T extends SlateNode, R>(
    options: EditorNodesOptions<T> = {},
    map?: (entry: NodeEntry<T>) => R
  ): NodeEntry<T>[] | R[] {
    return executeQueryMiddleware(
      editor,
      'nodes',
      'toArray',
      {
        map: map as ((entry: NodeEntry<SlateNode>) => unknown) | undefined,
        options: options as EditorNodesOptions<SlateNode>,
      },
      ({ map, options = {} }) => {
        return withOptionsRootRead(
          editor,
          options,
          () => {
            if (map) {
              const mapped: unknown[] = []

              for (const entry of getNodes(editor, options)) {
                mapped.push(map(entry))
              }

              return mapped
            }

            const entries: NodeEntry<SlateNode>[] = []

            for (const entry of getNodes(editor, options)) {
              entries.push(entry)
            }

            return entries
          },
          { selectionFallback: usesImplicitSelectionLocation(options) }
        )
      }
    ) as NodeEntry<T>[] | R[]
  }

  return toArray
}

const getStateView = <
  V extends Value,
  TExtensions extends readonly unknown[] = readonly [],
>(
  editor: Editor<V, TExtensions>
): EditorStateView<V, TExtensions> => {
  const state = {
    fragment: Object.freeze({
      get: (options = {}) =>
        executeQueryMiddleware(
          editor,
          'fragment',
          'get',
          { options },
          ({ options }) =>
            withOptionsRootRead(
              editor,
              options,
              () => getFragment(editor, options) as DescendantIn<V>[],
              { selectionFallback: usesImplicitSelectionLocation(options) }
            )
        ),
    }),
    getField: <TValue>(field: EditorStateField<TValue>) =>
      getStateFieldValue(editor, field),
    marks: Object.freeze({
      get: () =>
        executeQueryMiddleware(editor, 'marks', 'get', {}, () =>
          getSelectionMarks(editor)
        ),
    }),
    nodes: Object.freeze({
      above: <T extends Ancestor>(options = {}) =>
        executeQueryMiddleware(
          editor,
          'nodes',
          'above',
          { options },
          ({ options }) =>
            getEditorRuntime(editor).above(options) as
              | NodeEntry<Ancestor>
              | undefined
        ) as [T, Path] | undefined,
      children(at: Location = []) {
        return executeQueryMiddleware(
          editor,
          'nodes',
          'children',
          { at },
          ({ at = [] }) =>
            withLocationRootRead(editor, at, () => {
              if (Array.isArray(at) && at.length === 0) {
                return getChildren(editor) as readonly SlateNode[]
              }

              const [node] = getNode(editor, at)

              return 'children' in node && Array.isArray(node.children)
                ? node.children
                : []
            })
        )
      },
      elementReadOnly: (options = {}) =>
        executeQueryMiddleware(
          editor,
          'nodes',
          'elementReadOnly',
          { options },
          ({ options }) => getEditorRuntime(editor).elementReadOnly(options)
        ),
      first: (at: Location) =>
        executeQueryMiddleware(editor, 'nodes', 'first', { at }, ({ at }) =>
          getEditorRuntime(editor).first(at)
        ),
      get: <T extends SlateNode>(at: Location) =>
        executeQueryMiddleware(editor, 'nodes', 'get', { at }, ({ at }) =>
          withLocationRootRead(editor, at, () => getNode(editor, at))
        ) as [T, Path],
      hasBlocks: (element: import('../interfaces/element').Element) =>
        executeQueryMiddleware(
          editor,
          'nodes',
          'hasBlocks',
          { element },
          ({ element }) => getEditorRuntime(editor).hasBlocks(element)
        ),
      hasInlines: (element: import('../interfaces/element').Element) =>
        executeQueryMiddleware(
          editor,
          'nodes',
          'hasInlines',
          { element },
          ({ element }) => getEditorRuntime(editor).hasInlines(element)
        ),
      hasPath: (path: Path) =>
        executeQueryMiddleware(
          editor,
          'nodes',
          'hasPath',
          { path },
          ({ path }) => getEditorRuntime(editor).hasPath(path)
        ),
      hasTexts: (element: import('../interfaces/element').Element) =>
        executeQueryMiddleware(
          editor,
          'nodes',
          'hasTexts',
          { element },
          ({ element }) => getEditorRuntime(editor).hasTexts(element)
        ),
      isBlock: (element: import('../interfaces/element').Element) =>
        executeQueryMiddleware(
          editor,
          'nodes',
          'isBlock',
          { element },
          ({ element }) => getEditorRuntime(editor).isBlock(element)
        ),
      isEmpty: (element: import('../interfaces/element').Element) =>
        executeQueryMiddleware(
          editor,
          'nodes',
          'isEmpty',
          { element },
          ({ element }) => getEditorRuntime(editor).isEmpty(element)
        ),
      last: (at: Location) =>
        executeQueryMiddleware(editor, 'nodes', 'last', { at }, ({ at }) =>
          getEditorRuntime(editor).last(at)
        ),
      leaf: (at, options = {}) =>
        executeQueryMiddleware(
          editor,
          'nodes',
          'leaf',
          { at, options },
          ({ at, options }) => getEditorRuntime(editor).leaf(at, options)
        ),
      levels: <T extends SlateNode>(options = {}) =>
        executeQueryMiddleware(
          editor,
          'nodes',
          'levels',
          { options },
          ({ options }) =>
            getEditorRuntime(editor).levels(options) as Generator<
              NodeEntry<SlateNode>,
              void,
              undefined
            >
        ) as Generator<[T, Path], void, undefined>,
      path: (at: Location, options = {}) =>
        executeQueryMiddleware(
          editor,
          'nodes',
          'path',
          { at, options },
          ({ at, options }) => getEditorRuntime(editor).path(at, options)
        ),
      entries: <T extends SlateNode>(options = {}) =>
        executeQueryMiddleware(
          editor,
          'nodes',
          'entries',
          { options },
          ({ options }) =>
            withOptionsRootGenerator(
              editor,
              options,
              () =>
                getNodes(editor, options) as Generator<
                  NodeEntry<SlateNode>,
                  void,
                  undefined
                >,
              { selectionFallback: usesImplicitSelectionLocation(options) }
            )
        ) as Generator<[T, Path], void, undefined>,
      find: <T extends SlateNode>(options = {}) => {
        return executeQueryMiddleware(
          editor,
          'nodes',
          'find',
          { options },
          ({ options }) => {
            return withOptionsRootRead(
              editor,
              options,
              () => {
                for (const entry of getNodes(editor, options)) {
                  return entry
                }
              },
              { selectionFallback: usesImplicitSelectionLocation(options) }
            )
          }
        ) as [T, Path] | undefined
      },
      some: (options = {}) => {
        return executeQueryMiddleware(
          editor,
          'nodes',
          'some',
          { options },
          ({ options }) => {
            return withOptionsRootRead(
              editor,
              options,
              () => {
                for (const _entry of getNodes(editor, options)) {
                  return true
                }

                return false
              },
              { selectionFallback: usesImplicitSelectionLocation(options) }
            )
          }
        )
      },
      toArray: createNodesToArray(editor),
      next: <T extends SlateNode>(options = {}) =>
        executeQueryMiddleware(
          editor,
          'nodes',
          'next',
          { options },
          ({ options }) =>
            getEditorRuntime(editor).next(options) as
              | NodeEntry<Descendant>
              | undefined
        ) as [T, Path] | undefined,
      previous: <T extends SlateNode>(options = {}) =>
        executeQueryMiddleware(
          editor,
          'nodes',
          'previous',
          { options },
          ({ options }) =>
            getEditorRuntime(editor).previous(options) as
              | NodeEntry<SlateNode>
              | undefined
        ) as [T, Path] | undefined,
      shouldMergeNodesRemovePrevNode: (previous, current) =>
        executeQueryMiddleware(
          editor,
          'nodes',
          'shouldMergeNodesRemovePrevNode',
          { current, previous },
          ({ current, previous }) =>
            getEditorRuntime(editor).shouldMergeNodesRemovePrevNode(
              previous,
              current
            )
        ),
      parent: (at: Location) =>
        executeQueryMiddleware(editor, 'nodes', 'parent', { at }, ({ at }) =>
          getEditorRuntime(editor).parent(at)
        ),
      void: (options = {}) =>
        executeQueryMiddleware(
          editor,
          'nodes',
          'void',
          { options },
          ({ options }) => getEditorRuntime(editor).void(options)
        ),
    }),
    points: Object.freeze({
      after: (at: Location, options = {}) =>
        executeQueryMiddleware(
          editor,
          'points',
          'after',
          { at, options },
          ({ at, options }) => getEditorRuntime(editor).after(at, options)
        ),
      before: (at: Location, options = {}) =>
        executeQueryMiddleware(
          editor,
          'points',
          'before',
          { at, options },
          ({ at, options }) => getEditorRuntime(editor).before(at, options)
        ),
      end: (at: Location) =>
        executeQueryMiddleware(editor, 'points', 'end', { at }, ({ at }) =>
          getEditorRuntime(editor).point(at, { edge: 'end' })
        ),
      get: (at: Location, options = {}) =>
        executeQueryMiddleware(
          editor,
          'points',
          'get',
          { at, options },
          ({ at, options }) => getEditorRuntime(editor).point(at, options)
        ),
      isEdge: (point, at) =>
        executeQueryMiddleware(
          editor,
          'points',
          'isEdge',
          { at, point },
          ({ at, point }) => getEditorRuntime(editor).isEdge(point, at)
        ),
      isEnd: (point, at) =>
        executeQueryMiddleware(
          editor,
          'points',
          'isEnd',
          { at, point },
          ({ at, point }) => getEditorRuntime(editor).isEnd(point, at)
        ),
      isStart: (point, at) =>
        executeQueryMiddleware(
          editor,
          'points',
          'isStart',
          { at, point },
          ({ at, point }) => getEditorRuntime(editor).isStart(point, at)
        ),
      positions: (options = {}) =>
        executeQueryMiddleware(
          editor,
          'points',
          'positions',
          { options },
          ({ options }) => getEditorRuntime(editor).positions(options)
        ),
      start: (at: Location) =>
        executeQueryMiddleware(editor, 'points', 'start', { at }, ({ at }) =>
          getEditorRuntime(editor).point(at, { edge: 'start' })
        ),
    }),
    ranges: Object.freeze({
      bookmark: (range, options = {}) =>
        getEditorTransformRegistry(editor).bookmark(range, options),
      edges: (at: Location) =>
        executeQueryMiddleware(editor, 'ranges', 'edges', { at }, ({ at }) =>
          getEditorRuntime(editor).edges(at)
        ),
      get: (at: Location, to?: Location) =>
        executeQueryMiddleware(
          editor,
          'ranges',
          'get',
          { at, to },
          ({ at, to }) => getEditorRuntime(editor).range(at, to)
        ),
      project: (range) =>
        executeQueryMiddleware(
          editor,
          'ranges',
          'project',
          { range },
          ({ range }) => getEditorRuntime(editor).projectRange(range)
        ),
      unhang: (range, options = {}) =>
        executeQueryMiddleware(
          editor,
          'ranges',
          'unhang',
          { options, range },
          ({ options, range }) =>
            getEditorRuntime(editor).unhangRange(range, options)
        ),
    }),
    runtime: Object.freeze({
      idAt: (path: Path) => getRuntimeId(editor, path),
      pathOf: (runtimeId) => getPathByRuntimeId(editor, runtimeId),
      snapshot: () => getSnapshot(editor) as EditorSnapshot<V>,
    }),
    schema: Object.freeze({
      getElementBehavior: (element: import('../interfaces/element').Element) =>
        getEditorSchema(editor).getElementBehavior(element),
      getElementProperty: <T = unknown>(
        element: import('../interfaces/element').Element,
        property: string
      ) => getEditorSchema(editor).getElementProperty<T>(element, property),
      getElementPropertyDescriptor: (type: string, property: string) =>
        getEditorSchema(editor).getElementPropertyDescriptor(type, property),
      getElementSpec: (type: string) =>
        getEditorSchema(editor).getElementSpec(type),
      isAtom: (element: import('../interfaces/element').Element) =>
        getEditorSchema(editor).isAtom(element),
      isBlock: (element: import('../interfaces/element').Element) =>
        getEditorRuntime(editor).isBlock(element),
      isEditableIsland: (element: import('../interfaces/element').Element) =>
        getEditorSchema(editor).isEditableIsland(element),
      isElementPropertyEqual: (
        type: string,
        property: string,
        left: unknown,
        right: unknown
      ) =>
        getEditorSchema(editor).isElementPropertyEqual(
          type,
          property,
          left,
          right
        ),
      isReadOnly: (element: import('../interfaces/element').Element) =>
        getEditorSchema(editor).isReadOnly(element),
      isInline: (element: import('../interfaces/element').Element) =>
        getEditorSchema(editor).isInline(element),
      isIsolating: (element: import('../interfaces/element').Element) =>
        getEditorSchema(editor).isIsolating(element),
      isKeyboardSelectable: (
        element: import('../interfaces/element').Element
      ) => getEditorSchema(editor).isKeyboardSelectable(element),
      isSelectable: (element: import('../interfaces/element').Element) =>
        getEditorSchema(editor).isSelectable(element),
      isVoid: (element: import('../interfaces/element').Element) =>
        getEditorSchema(editor).isVoid(element),
      markableVoid: (element: import('../interfaces/element').Element) =>
        getEditorSchema(editor).markableVoid(element),
    }),
    selection: Object.freeze({
      get: () => getCurrentSelection(editor),
    }),
    text: Object.freeze({
      string: (at: Location, options = {}) =>
        withLocationRootRead(editor, at, () =>
          getEditorRuntime(editor).string(at, options)
        ),
    }),
    value: Object.freeze({
      get: () => getEditorDocumentValue(editor),
      lastCommit: () => getLastCommit(editor) as EditorCommit<V> | null,
      operations: (startIndex?: number) =>
        getOperations(editor, startIndex) as readonly Operation<V>[],
    }),
    view: Object.freeze({
      isFocused: () => false,
      isReadOnly: () => false,
      root: () => MAIN_ROOT_KEY,
    }),
  } satisfies EditorCoreStateView<V>

  const stateRecord = state as unknown as Record<string, unknown>

  for (const [groupName, registration] of getExtensionRegistry(editor)
    .stateGroups) {
    stateRecord[groupName] = registration.factory(
      stateRecord as never,
      editor as never
    )
  }

  return Object.freeze(stateRecord) as EditorStateView<V, TExtensions>
}

export const getEditorStateView = <
  V extends Value,
  TExtensions extends readonly unknown[] = readonly [],
>(
  editor: Editor<V, TExtensions>
): EditorStateView<V, TExtensions> => getStateView(editor)

const getUpdateContext = <
  V extends Value,
  TExtensions extends readonly unknown[] = readonly [],
>(
  editor: Editor<V, TExtensions>
): EditorUpdateContext<Editor<V, TExtensions>> => {
  const transactionSnapshot = TRANSACTION_SNAPSHOT.get(editor)
  const transactionRoot = getCurrentChildrenRoot(editor)

  return Object.freeze({
    afterCommit(handler) {
      const snapshot = TRANSACTION_SNAPSHOT.get(editor)

      if (!snapshot || snapshot !== transactionSnapshot) {
        throw new Error(
          'afterCommit can only be registered during editor.update'
        )
      }

      snapshot.afterCommitHandlers.push({
        handler: handler as EditorCommitHandler,
        root: transactionRoot,
      })
    },
  })
}

const getUpdateView = <
  V extends Value,
  TExtensions extends readonly unknown[] = readonly [],
>(
  editor: Editor<V, TExtensions>
): EditorUpdateTransaction<V, TExtensions> => {
  const state = getStateView(editor)
  const transforms = getEditorTransformRegistry(editor)
  const runMutation = <T>(
    options: { at?: Location } | undefined,
    fn: () => T
  ) => runWithMutationRoot(editor, getMutationRoot(editor, options), fn)
  const runSelectionMutation = <T>(fn: () => T) =>
    runWithMutationRoot(editor, getMutationRoot(editor), fn)
  const runLocationMutation = <T>(location: Location, fn: () => T) =>
    runWithMutationRoot(editor, getLocationMutationRoot(editor, location), fn)
  const tx = {
    ...state,
    break: Object.freeze({
      insert: () => runSelectionMutation(() => transforms.insertBreak()),
      insertSoft: () =>
        runSelectionMutation(() => transforms.insertSoftBreak()),
    }),
    fragment: Object.freeze({
      get: (...args: Parameters<typeof state.fragment.get>) =>
        state.fragment.get(...args),
      delete: (...args: Parameters<typeof transforms.deleteFragment>) =>
        runSelectionMutation(() => transforms.deleteFragment(...args)),
      insert: (fragment, options) =>
        runMutation(options, () =>
          transforms.insertFragment(fragment, options)
        ),
    }),
    marks: Object.freeze({
      ...state.marks,
      add: (key: string, value: unknown) =>
        runSelectionMutation(() => transforms.addMark(key, value)),
      remove: (key: string) =>
        runSelectionMutation(() => transforms.removeMark(key)),
      toggle: (key: string, value = true) =>
        runSelectionMutation(() => transforms.toggleMark(key, value)),
    }),
    nodes: Object.freeze({
      ...state.nodes,
      insert: (nodes, options) =>
        runMutation(options, () => transforms.insertNodes(nodes, options)),
      insertMany: (nodes, options) =>
        runMutation(options, () => transforms.insertNodes(nodes, options)),
      lift: (options) =>
        runMutation(options, () => transforms.liftNodes(options)),
      merge: (options) =>
        runMutation(options, () => transforms.mergeNodes(options)),
      move: (options) =>
        runMutation(options, () => transforms.moveNodes(options)),
      remove: (options) =>
        runMutation(options, () => transforms.removeNodes(options)),
      set: (props, options) =>
        runMutation(options, () => transforms.setNodes(props, options)),
      split: (options) =>
        runMutation(options, () => transforms.splitNodes(options)),
      unset: (props, options) =>
        runMutation(options, () => transforms.unsetNodes(props, options)),
      unwrap: (options) =>
        runMutation(options, () => transforms.unwrapNodes(options)),
      wrap: (element, options) =>
        runMutation(options, () => transforms.wrapNodes(element, options)),
    }),
    normalize: (options = {}) => transforms.normalize(options),
    operations: Object.freeze({
      replay: (operations, options = {}) => {
        if (operations.length === 0) {
          return
        }

        withUpdateTagContext(editor, normalizeUpdateTags(options.tag), () => {
          for (const operation of operations) {
            assertKnownReplayOperation(operation)
            applyOperation(editor, cloneValue(operation))
          }
        })
      },
    }),
    roots: Object.freeze({
      create: (root, children) => {
        requireMutableRoot(root)
        const roots = getEditorDocumentRoots(editor)

        if (Object.hasOwn(roots, root)) {
          throw new Error(`Cannot create existing editor root "${root}".`)
        }

        applyOperation(
          editor,
          createRootReplaceChildrenOperation(root, [], children, {
            rootIsPresent: true,
            rootWasPresent: false,
          })
        )
      },
      delete: (root) => {
        requireMutableRoot(root)
        const roots = getEditorDocumentRoots(editor)
        const children = roots[root]

        if (!Object.hasOwn(roots, root) || children === undefined) {
          throw new Error(`Cannot delete missing editor root "${root}".`)
        }

        applyOperation(
          editor,
          createRootReplaceChildrenOperation(root, children, [], {
            rootIsPresent: false,
            rootWasPresent: true,
          })
        )
      },
      replace: (root, children) => {
        requireMutableRoot(root)
        const roots = getEditorDocumentRoots(editor)
        const previousChildren = roots[root]

        if (!Object.hasOwn(roots, root) || previousChildren === undefined) {
          throw new Error(`Cannot replace missing editor root "${root}".`)
        }

        applyOperation(
          editor,
          createRootReplaceChildrenOperation(root, previousChildren, children, {
            rootIsPresent: true,
            rootWasPresent: true,
          })
        )
      },
    }),
    statePatches: Object.freeze({
      replay: (statePatches) => applyStatePatches(editor, statePatches, 'redo'),
    }),
    selection: Object.freeze({
      ...state.selection,
      clear: () => runSelectionMutation(() => transforms.deselect()),
      collapse: (options = {}) =>
        runSelectionMutation(() => transforms.collapse(options)),
      move: (options = {}) =>
        runSelectionMutation(() => transforms.move(options)),
      set: (target: Location | null) => {
        if (target == null) {
          runSelectionMutation(() => transforms.deselect())
          return
        }

        runLocationMutation(target, () => transforms.select(target))
      },
      setPoint: (...args: Parameters<typeof transforms.setPoint>) =>
        runSelectionMutation(() => transforms.setPoint(...args)),
      setRange: (...args: Parameters<typeof transforms.setSelection>) =>
        runSelectionMutation(() => transforms.setSelection(...args)),
    }),
    setField: <TValue>(
      field: EditorStateField<TValue>,
      value: StateFieldValueInput<TValue>
    ) => setStateFieldValue(editor, field, value),
    text: Object.freeze({
      ...state.text,
      delete: (options = {}) =>
        runMutation(options, () => transforms.delete(options)),
      deleteBackward: (options = {}) =>
        runSelectionMutation(() =>
          transforms.deleteBackward(options.unit ?? 'character')
        ),
      deleteForward: (options = {}) =>
        runSelectionMutation(() =>
          transforms.deleteForward(options.unit ?? 'character')
        ),
      insert: (text: string, options = {}) =>
        runMutation(options, () => transforms.insertText(text, options)),
    }),
    value: Object.freeze({
      ...state.value,
      replace: (input: SnapshotInput<V>) => replaceSnapshot(editor, input),
    }),
    withoutNormalizing: (fn: () => void) => transforms.withoutNormalizing(fn),
  } satisfies EditorCoreUpdateTransaction<V>

  const txRecord = tx as unknown as Record<string, unknown>

  for (const [groupName, registration] of getExtensionRegistry(editor)
    .txGroups) {
    txRecord[groupName] = registration.factory(
      txRecord as never,
      editor as never
    )
  }

  return Object.freeze(txRecord) as EditorUpdateTransaction<V, TExtensions>
}

export const getActiveUpdateView = <
  V extends Value,
  TExtensions extends readonly unknown[] = readonly [],
>(
  editor: Editor<V, TExtensions>
): EditorUpdateTransaction<V, TExtensions> => {
  if (!isInTransaction(editor)) {
    throw new Error(
      'transform middleware tx is only available during editor.update'
    )
  }

  return getUpdateView(editor)
}

export const getNormalizerUpdateView = <V extends Value>(
  editor: Editor<V>
): EditorNormalizerTransaction<V> => {
  const tx = getUpdateView(editor)

  return Object.freeze({
    break: tx.break,
    fragment: tx.fragment,
    marks: tx.marks,
    nodes: tx.nodes,
    selection: tx.selection,
    text: tx.text,
    value: Object.freeze({
      get: tx.value.get,
    }),
  } satisfies EditorNormalizerTransaction<V>)
}

const getFragment = <V extends Value>(
  editor: Editor<V>,
  options: EditorFragmentReadOptions = {}
): Descendant[] => {
  const range = options.at ?? getCurrentSelection(editor)

  if (range == null) {
    return []
  }

  return NodeApi.fragment(editor, range)
}

export const readEditor = <
  V extends Value,
  TExtensions extends readonly unknown[] = readonly [],
  T = unknown,
>(
  editor: Editor<V, TExtensions>,
  fn: (state: EditorStateView<V, TExtensions>) => T
): T => {
  const depth = READ_DEPTH.get(editor) ?? 0
  READ_DEPTH.set(editor, depth + 1)

  try {
    return fn(getStateView(editor))
  } finally {
    if (depth === 0) {
      READ_DEPTH.delete(editor)
    } else {
      READ_DEPTH.set(editor, depth)
    }
  }
}

export const updateEditor = <
  V extends Value,
  TExtensions extends readonly unknown[] = readonly [],
>(
  editor: Editor<V, TExtensions>,
  fn: (
    transaction: EditorUpdateTransaction<V, TExtensions>,
    context: EditorUpdateContext<Editor<V, TExtensions>>
  ) => void,
  options: EditorUpdateOptions = {}
) => {
  if (isExecutingQueryMiddleware(editor)) {
    throw new Error('editor.update cannot be started inside query middleware')
  }

  if ((READ_DEPTH.get(editor) ?? 0) > 0 && !isInTransaction(editor)) {
    throw new Error(
      'editor.update cannot be started inside editor.read outside an active update'
    )
  }

  const tags = normalizeUpdateTags(options.tag)
  const metadata = cloneUpdateMetadata(options.metadata)
  const root = ACTIVE_OPERATION_ROOT.get(editor)
  const run = () =>
    runEditorTransaction(
      editor,
      () => fn(getUpdateView(editor), getUpdateContext(editor)),
      {
        authority: 'update',
        metadata,
        skipNormalize: options.skipNormalize,
      }
    )

  return withUpdateTagContext(editor, tags, () =>
    root
      ? withEditorOperationRoot(editor, root, () =>
          withEditorOperationRootChildren(editor, root, run)
        )
      : run()
  )
}

export const withEditorOperationRoot = <T>(
  editor: Editor,
  root: string,
  fn: () => T
): T => {
  const previousRoot = ACTIVE_OPERATION_ROOT.get(editor)
  ACTIVE_OPERATION_ROOT.set(editor, root)

  try {
    return fn()
  } finally {
    if (previousRoot === undefined) {
      ACTIVE_OPERATION_ROOT.delete(editor)
    } else {
      ACTIVE_OPERATION_ROOT.set(editor, previousRoot)
    }
  }
}

export const getEditorOperationRoot = (editor: Editor): string =>
  ACTIVE_OPERATION_ROOT.get(editor) ?? MAIN_ROOT_KEY

export const withEditorRootChildren = <T>(
  editor: Editor,
  root: string,
  fn: () => T
): T => {
  const restoreRootChildren = enterEditorRootChildren(editor, root)

  if (!restoreRootChildren) {
    return fn()
  }

  try {
    return fn()
  } finally {
    restoreRootChildren()
  }
}

export const withEditorRootChildrenGenerator = <T>(
  editor: Editor,
  root: string | null | undefined,
  create: () => Iterable<T>
): Generator<T, void, undefined> =>
  (function* editorRootChildrenGenerator() {
    const createIterator = () => {
      const restoreRootChildren = enterEditorRootChildren(editor, root)

      try {
        return create()[Symbol.iterator]()
      } finally {
        restoreRootChildren?.()
      }
    }
    const iterator = createIterator()
    let done = false

    try {
      while (true) {
        const restoreRootChildren = enterEditorRootChildren(editor, root)
        let result: IteratorResult<T>

        try {
          result = iterator.next()
        } finally {
          restoreRootChildren?.()
        }

        if (result.done) {
          done = true
          return
        }

        yield result.value
      }
    } finally {
      if (!done) {
        const restoreRootChildren = enterEditorRootChildren(editor, root)

        try {
          iterator.return?.()
        } finally {
          restoreRootChildren?.()
        }
      }
    }
  })()

const enterEditorRootChildren = (
  editor: Editor,
  root: string | null | undefined
): (() => void) | undefined => {
  const targetRoot = root ?? MAIN_ROOT_KEY
  const previousActiveChildrenRoot = ACTIVE_CHILDREN_ROOT.get(editor)
  const previousRoot = getCurrentChildrenRoot(editor)
  const previousChildren = getChildren(editor) as Descendant[]
  const previousRoots = getEditorDocumentRoots(editor)
  const previousRootChildren = previousRoots[previousRoot]

  if (
    previousRoot === targetRoot &&
    previousRootChildren === previousChildren
  ) {
    return undefined
  }

  const hadTargetRoot = Object.hasOwn(previousRoots, targetRoot)
  const rootChildren = previousRoots[targetRoot] ?? []

  ROOTS.set(editor, previousRoots)
  CHILDREN.set(editor, rootChildren)
  ACTIVE_CHILDREN_ROOT.set(editor, targetRoot)
  CURRENT_CHILDREN_ROOT.set(editor, targetRoot)
  RUNTIME_INDEX_CACHE.delete(editor)
  SNAPSHOT_CACHE.delete(editor)

  return () => {
    const currentRoots = ROOTS.get(editor) ?? previousRoots
    const nextRoots =
      hadTargetRoot || Object.hasOwn(currentRoots, targetRoot)
        ? getEditorDocumentRoots(editor)
        : previousRoots
    const restoreRoot = previousRoot
    const restoredChildren = nextRoots[restoreRoot] ?? []

    CHILDREN.set(editor, restoredChildren)
    ROOTS.set(editor, nextRoots)
    CURRENT_CHILDREN_ROOT.set(editor, previousRoot)
    if (previousActiveChildrenRoot === undefined) {
      ACTIVE_CHILDREN_ROOT.delete(editor)
    } else {
      ACTIVE_CHILDREN_ROOT.set(editor, previousActiveChildrenRoot)
    }
    RUNTIME_INDEX_CACHE.delete(editor)
    SNAPSHOT_CACHE.delete(editor)
  }
}

export const withEditorOperationRootChildren = <T>(
  editor: Editor,
  root: string | null | undefined,
  fn: () => T
): T => {
  const restoreRootChildren = enterEditorRootChildren(editor, root)

  if (!restoreRootChildren) {
    return fn()
  }

  try {
    return fn()
  } finally {
    restoreRootChildren()
  }
}

export const withOperationRootChildren = <T>(
  editor: Editor,
  operation: Operation,
  fn: () => T
): T => {
  const root = getOperationRoot(operation)

  return root
    ? withEditorOperationRoot(editor, root, () =>
        withEditorOperationRootChildren(editor, root, fn)
      )
    : fn()
}

export const setChildren = (
  editor: Editor,
  children: Descendant[],
  options: { invalidateRuntimeIndex?: boolean } = {}
) => {
  const root = getCurrentChildrenRoot(editor)

  CHILDREN.set(editor, children)
  ROOTS.set(editor, {
    ...(ROOTS.get(editor) ?? {}),
    [root]: children,
  })
  bumpMutationVersion(editor)
  if (options.invalidateRuntimeIndex) {
    bumpRuntimeIndexVersion(editor)
  }
  SNAPSHOT_CACHE.delete(editor)
  markTransactionChanged(editor)
}

export const deleteEditorRoot = (
  editor: Editor,
  root: string | null | undefined
) => {
  const targetRoot = root ?? MAIN_ROOT_KEY

  if (targetRoot === MAIN_ROOT_KEY) {
    return
  }

  const currentRoots = getEditorDocumentRoots(editor)

  if (!Object.hasOwn(currentRoots, targetRoot)) {
    return
  }

  const nextRoots = { ...currentRoots }
  delete nextRoots[targetRoot]

  ROOTS.set(editor, nextRoots)
  if (getCurrentChildrenRoot(editor) === targetRoot) {
    CHILDREN.set(editor, [])
  }
  bumpMutationVersion(editor)
  bumpRuntimeIndexVersion(editor)
  SNAPSHOT_CACHE.delete(editor)
  markTransactionChanged(editor)
}

export const getCurrentMarks = (editor: Editor): EditorMarks | null =>
  cloneValue(
    CURRENT_MARKS.has(editor)
      ? (CURRENT_MARKS.get(editor) as EditorMarks | null)
      : null
  )

export const setCurrentMarks = (editor: Editor, marks: EditorMarks | null) => {
  const cloned = cloneValue(marks ?? null)
  CURRENT_MARKS.set(editor, cloned)
  bumpMutationVersion(editor)
  SNAPSHOT_CACHE.delete(editor)
  markTransactionChanged(editor)
}

export const getCurrentSelection = (editor: Editor): Selection =>
  cloneValue(
    CURRENT_SELECTION.has(editor)
      ? (CURRENT_SELECTION.get(editor) as Selection)
      : null
  )

export const getCurrentSelectionRoot = (editor: Editor): string =>
  CURRENT_SELECTION_ROOT.get(editor) ?? MAIN_ROOT_KEY

export const getPublicSelection = (editor: Editor): Selection =>
  getCurrentSelection(editor)

const normalizeSelectionRoot = (
  selection: Selection,
  root: string
): Selection => {
  const cloned = cloneValue(selection ?? null)

  if (!cloned) {
    return cloned
  }

  const normalizePointRoot = <TPoint extends { root?: string }>(
    point: TPoint
  ) => {
    const { root: _root, ...pointWithoutRoot } = point

    return root === MAIN_ROOT_KEY
      ? pointWithoutRoot
      : { ...pointWithoutRoot, root }
  }

  return {
    anchor: normalizePointRoot(cloned.anchor),
    focus: normalizePointRoot(cloned.focus),
  }
}

export const setCurrentSelection = (
  editor: Editor,
  selection: Selection,
  root = ACTIVE_OPERATION_ROOT.get(editor) ?? getCurrentSelectionRoot(editor)
) => {
  const cloned = normalizeSelectionRoot(selection, root)
  CURRENT_SELECTION.set(editor, cloned)
  CURRENT_SELECTION_ROOT.set(editor, root)
  bumpMutationVersion(editor)
  SNAPSHOT_CACHE.delete(editor)
  markTransactionChanged(editor)
}

export const syncImplicitTargetToCurrentSelection = (editor: Editor) => {
  const snapshot = TRANSACTION_SNAPSHOT.get(editor)

  if (!snapshot) {
    return
  }

  snapshot.implicitTarget = cloneValue(getCurrentSelection(editor))
  snapshot.implicitTargetResolved = true
}

export const transformImplicitTarget = (
  editor: Editor,
  operation: Operation
) => {
  const snapshot = TRANSACTION_SNAPSHOT.get(editor)

  if (!snapshot?.implicitTargetResolved || !snapshot.implicitTarget) {
    return
  }

  snapshot.implicitTarget = RangeApi.transform(
    snapshot.implicitTarget,
    operation
  )
}

export const resolveImplicitTarget = (
  editor: Editor,
  fallback: Selection
): Selection => {
  if (TARGET_RUNTIME_ACTIVE.has(editor)) {
    return fallback
  }

  const runtime = TARGET_RUNTIME.get(editor)

  if (!runtime) {
    return fallback
  }

  TARGET_RUNTIME_ACTIVE.add(editor)

  try {
    const target = runtime.resolveImplicitTarget(editor, {
      fallback,
      reason: 'implicit-target',
    })

    if (JSON.stringify(target ?? null) !== JSON.stringify(fallback ?? null)) {
      setCurrentSelection(editor, target)
    }

    return target
  } finally {
    TARGET_RUNTIME_ACTIVE.delete(editor)
  }
}

export const setTargetRuntime = (
  editor: Editor,
  runtime: EditorTargetRuntime | null
) => {
  if (runtime) {
    TARGET_RUNTIME.set(editor, runtime)
  } else {
    TARGET_RUNTIME.delete(editor)
  }
}

export const getTargetRuntime = (editor: Editor) =>
  TARGET_RUNTIME.get(editor) ?? null

export const withEditorTargetRuntime = <T>(
  editor: Editor,
  runtime: EditorTargetRuntime,
  fn: () => T
): T => {
  const previousRuntime = TARGET_RUNTIME.get(editor)
  const hadPreviousRuntime = TARGET_RUNTIME.has(editor)

  TARGET_RUNTIME.set(editor, runtime)

  try {
    return fn()
  } finally {
    if (hadPreviousRuntime) {
      TARGET_RUNTIME.set(editor, previousRuntime!)
    } else {
      TARGET_RUNTIME.delete(editor)
    }
  }
}

const getLiveOperations = (editor: Editor): Operation[] => {
  const existing = OPERATIONS.get(editor)

  if (existing) {
    return existing
  }

  const operations: Operation[] = []
  OPERATIONS.set(editor, operations)

  return operations
}

export const getOperations = (
  editor: Editor,
  startIndex?: number
): readonly Operation[] => {
  if (isInTransaction(editor)) {
    return Object.freeze(
      cloneValue(getLiveOperations(editor).slice(startIndex ?? 0))
    )
  }

  if (startIndex != null && startIndex > 0) {
    return Object.freeze(
      cloneValue(getLiveOperations(editor).slice(startIndex))
    )
  }

  const cached = PUBLIC_OPERATIONS.get(editor)

  if (cached) {
    return cached
  }

  const operations = Object.freeze(cloneValue(getLiveOperations(editor)))
  PUBLIC_OPERATIONS.set(editor, operations)

  return operations
}

export const setOperations = (editor: Editor, operations: Operation[]) => {
  OPERATIONS.set(editor, cloneValue(operations))
  PUBLIC_OPERATIONS.delete(editor)
}

export const appendOperation = (editor: Editor, operation: Operation) => {
  getLiveOperations(editor).push(operation)
  if (operationInvalidatesRuntimeIndex(operation)) {
    bumpRuntimeIndexVersion(editor)
  }
  if (!isInTransaction(editor)) {
    PUBLIC_OPERATIONS.delete(editor)
  }
}

export const setBaseApply = (
  editor: Editor,
  apply: (operation: Operation) => void
) => {
  BASE_APPLY.set(editor, apply)
}

const applyWithOperationMiddlewares = (
  editor: Editor,
  operation: Operation
) => {
  const initialOperation = withRootLifecycleDefaults(
    editor,
    withDefaultOperationRoot(editor, operation)
  )
  const baseApply = BASE_APPLY.get(editor)

  if (!baseApply) {
    throw new Error('Editor operation applier has not been initialized.')
  }

  const middlewares = [...getExtensionRegistry(editor).operationMiddlewares]
  let index = -1

  const dispatch = (nextOperation: Operation = initialOperation) => {
    index += 1
    const rootedOperation = withRootLifecycleDefaults(
      editor,
      withDefaultOperationRoot(editor, nextOperation)
    )
    const middleware = middlewares[index]

    if (!middleware) {
      baseApply(rootedOperation)
      return
    }

    middleware({ editor, operation: rootedOperation }, dispatch)
  }

  dispatch(initialOperation)
}

export const applyOperation = (editor: Editor, operation: Operation) => {
  const writer = TRANSACTION_APPLY.get(editor)

  if (writer) {
    writer(operation)
    return
  }

  assertCanStartEditorWrite(editor)
  runEditorTransaction(editor, (transaction) => {
    transaction.apply(operation)
  })
}

export const getLatestOperation = (editor: Editor) =>
  getLiveOperations(editor).at(-1)

export const getLatestContentOperation = (
  editor: Editor,
  startIndex: number
): Operation | undefined =>
  getLiveOperations(editor)
    .slice(startIndex)
    .findLast((operation) => operation.type !== 'set_selection')

export const getOperationCount = (editor: Editor) =>
  getLiveOperations(editor).length

export const hasInternalEditorState = (value: unknown): value is Editor =>
  typeof value === 'object' &&
  value !== null &&
  CHILDREN.has(value as Editor) &&
  OPERATIONS.has(value as Editor)

const getTransactionView = (editor: Editor): EditorTransaction => {
  const existing = TRANSACTION_VIEW.get(editor)

  if (existing) {
    return existing
  }

  const transaction = Object.freeze({
    apply(operation: Operation) {
      applyWithOperationMiddlewares(editor, operation)
    },
    get children() {
      return getChildren(editor)
    },
    getModelSelection() {
      return getCurrentSelection(editor)
    },
    get marks() {
      return getCurrentMarks(editor)
    },
    get operations() {
      return Object.freeze(cloneValue(getLiveOperations(editor)))
    },
    resolveTarget(options: { at?: Location } = {}) {
      if (options.at !== undefined) {
        return options.at
      }

      const snapshot = TRANSACTION_SNAPSHOT.get(editor)

      if (snapshot?.implicitTargetResolved) {
        return cloneValue(snapshot.implicitTarget)
      }

      const target = resolveImplicitTarget(editor, getCurrentSelection(editor))

      if (snapshot) {
        snapshot.implicitTarget = cloneValue(target)
        snapshot.implicitTargetResolved = true
      }

      return target
    },
    get selection() {
      return getCurrentSelection(editor)
    },
    setMarks(marks: EditorMarks | null) {
      setCurrentMarks(editor, marks)
    },
    setSelection(selection: Selection) {
      const currentSelection = getCurrentSelection(editor)
      const operation = createSetSelectionOperation(currentSelection, selection)

      if (!operation) {
        return
      }

      applyWithOperationMiddlewares(editor, operation)
    },
  }) as unknown as EditorTransaction

  TRANSACTION_VIEW.set(editor, transaction)

  return transaction
}

export const getSnapshot = (editor: Editor): EditorSnapshot => {
  const cached = SNAPSHOT_CACHE.get(editor)

  if (cached) {
    return cached
  }

  const liveChildren = getChildren(editor)
  const children = cloneFrozen(liveChildren)
  const selection = cloneFrozen(getCurrentSelection(editor))
  const marks = cloneFrozen(getCurrentMarks(editor))

  const snapshot = Object.freeze({
    children,
    index: buildSnapshotIndex(editor, liveChildren),
    marks,
    selection,
    version: getVersion(editor),
  }) as unknown as EditorSnapshot

  SNAPSHOT_CACHE.set(editor, snapshot)

  return snapshot
}

const canBuildPathStableSnapshot = (
  operations: readonly Operation[],
  root: string
) =>
  operations.length > 0 &&
  operations.every(
    (operation) =>
      (operation.type === 'insert_text' ||
        operation.type === 'remove_text' ||
        operation.type === 'set_selection') &&
      getOperationRoot(operation) === root
  )

const getHomogeneousOperationRoot = (
  operations: readonly Operation[]
): string | null | undefined => {
  if (operations.length === 0) {
    return undefined
  }

  const roots = new Set(operations.map(getOperationRoot))

  return roots.size === 1 ? roots.values().next().value : null
}

const getRootScopedSelection = (
  selection: Selection,
  selectionRoot: string,
  root: string
): Selection => (selectionRoot === root ? cloneFrozen(selection) : null)

const getRootScopedMarks = (
  marks: EditorMarks | null,
  selectionRoot: string,
  root: string
): EditorMarks | null => (selectionRoot === root ? cloneFrozen(marks) : null)

const getCurrentRootIndex = (editor: Editor, root: string): SnapshotIndex =>
  buildSnapshotIndex(editor, getEditorDocumentRoots(editor)[root] ?? [])

const getTransactionSnapshotIndex = (
  editor: Editor,
  transactionSnapshot: TransactionSnapshot,
  root: string
): RuntimeIndexLike =>
  transactionSnapshot.rootIndexes[root] ??
  (root === transactionSnapshot.childrenRoot
    ? transactionSnapshot.previousIndex
    : null) ??
  buildSnapshotIndex(editor, transactionSnapshot.roots[root] ?? [])

const getTransactionRootSnapshot = (
  editor: Editor,
  transactionSnapshot: TransactionSnapshot,
  root: string
): EditorSnapshot => {
  const children = transactionSnapshot.roots[root] ?? []
  const runtimeIndex = getTransactionSnapshotIndex(
    editor,
    transactionSnapshot,
    root
  )
  const index =
    runtimeIndex.pathToId instanceof Map
      ? buildSnapshotIndex(editor, children)
      : runtimeIndex

  return Object.freeze({
    children: cloneFrozen(children),
    index,
    marks: getRootScopedMarks(
      transactionSnapshot.marks,
      transactionSnapshot.selectionRoot,
      root
    ),
    selection: getRootScopedSelection(
      transactionSnapshot.selection,
      transactionSnapshot.selectionRoot,
      root
    ),
    version: transactionSnapshot.previousVersion,
  }) as unknown as EditorSnapshot
}

const getCurrentRootSnapshot = (
  editor: Editor,
  root: string
): EditorSnapshot => {
  const children = getEditorDocumentRoots(editor)[root] ?? []
  const selectionRoot = getCurrentSelectionRoot(editor)

  return Object.freeze({
    children: cloneFrozen(children),
    index: buildSnapshotIndex(editor, children),
    marks: getRootScopedMarks(getCurrentMarks(editor), selectionRoot, root),
    selection: getRootScopedSelection(
      getCurrentSelection(editor),
      selectionRoot,
      root
    ),
    version: getVersion(editor),
  }) as unknown as EditorSnapshot
}

const getListenerSnapshot = (
  editor: Editor,
  _change?: SnapshotChange
): EditorSnapshot =>
  withEditorRootChildren(editor, MAIN_ROOT_KEY, () => getSnapshot(editor))

const withUnknownRuntimeImpact = (change: SnapshotChange): SnapshotChange =>
  Object.freeze({
    ...change,
    affectedNodeRuntimeIds: null,
    affectedProjectionRuntimeIds: null,
    affectedSelectionRuntimeIds: null,
    affectedTextRuntimeIds: null,
    dirty: buildDirtyRegion({
      dirtyPaths: [],
      dirtyScope: 'all',
      touchedRuntimeIds: null,
    }),
    dirtyElementRuntimeIds: null,
    dirtyPaths: [],
    dirtyScope: 'all',
    dirtyTextRuntimeIds: null,
    dirtyTopLevelRanges: null,
    dirtyTopLevelRuntimeIds: null,
    fullDocumentChanged: true,
    nodeImpactRuntimeIds: null,
    rootRuntimeIdsChanged: true,
    structuralDirtyRuntimeIds: null,
    textDirtyRuntimeIds: null,
    topLevelOrderChanged: true,
    touchedRuntimeIds: null,
  })

const withTransactionViewState = (
  editor: Editor,
  transactionSnapshot: TransactionSnapshot,
  change: SnapshotChange
): SnapshotChange => {
  const marksBefore = cloneValue(transactionSnapshot.marks)
  const marksAfter = cloneValue(getCurrentMarks(editor))
  const selectionBefore = cloneValue(transactionSnapshot.selection)
  const selectionAfter = cloneValue(getCurrentSelection(editor))
  const marksChanged =
    change.classes[0] === 'mark' ||
    !areSerializableValuesEqual(marksBefore ?? null, marksAfter ?? null)
  const selectionChanged =
    change.operations.some((operation) => operation.type === 'set_selection') ||
    !areSerializableValuesEqual(selectionBefore ?? null, selectionAfter ?? null)
  const selectionRootChanged =
    transactionSnapshot.selectionRoot !== getCurrentSelectionRoot(editor)
  const selectionImpactRuntimeIds =
    selectionChanged && selectionRootChanged
      ? null
      : change.selectionImpactRuntimeIds

  return Object.freeze({
    ...change,
    affectedSelectionRuntimeIds: selectionImpactRuntimeIds,
    marksAfter,
    marksBefore,
    marksChanged,
    selectionAfter,
    selectionBefore,
    selectionChanged,
    selectionImpactRuntimeIds,
    snapshotChanged:
      change.childrenChanged ||
      marksChanged ||
      selectionChanged ||
      change.statePatches.length > 0,
  })
}

type TextSnapshotOperation = Extract<
  Operation,
  { type: 'insert_text' | 'remove_text' }
>

type TextSnapshotPatch = {
  operations: TextSnapshotOperation[]
  path: Path
}

const applyTextSnapshotOperations = (
  text: string,
  operations: readonly TextSnapshotOperation[]
) =>
  operations.reduce((currentText, operation) => {
    const before = currentText.slice(0, operation.offset)

    if (operation.type === 'insert_text') {
      return before + operation.text + currentText.slice(operation.offset)
    }

    return before + currentText.slice(operation.offset + operation.text.length)
  }, text)

const buildTextSnapshotPatches = (
  operations: readonly Operation[]
): TextSnapshotPatch[] => {
  const patches = new Map<string, TextSnapshotPatch>()

  for (const operation of operations) {
    if (
      (operation.type !== 'insert_text' && operation.type !== 'remove_text') ||
      operation.text.length === 0
    ) {
      continue
    }

    const key = pathKey(operation.path)
    const patch = patches.get(key)

    if (patch) {
      patch.operations.push(operation)
      continue
    }

    patches.set(key, {
      operations: [operation],
      path: operation.path,
    })
  }

  return [...patches.values()]
}

const updateTextPatchesInSnapshotChildren = (
  children: readonly Descendant[],
  patches: readonly TextSnapshotPatch[],
  depth = 0
): readonly Descendant[] | null => {
  if (patches.length === 0) {
    return children
  }

  const patchesByIndex = new Map<number, TextSnapshotPatch[]>()

  for (const patch of patches) {
    const index = patch.path[depth]

    if (index == null) {
      return null
    }

    const bucket = patchesByIndex.get(index) ?? []
    bucket.push(patch)
    patchesByIndex.set(index, bucket)
  }

  const nextChildren = [...children]

  for (const [index, indexPatches] of patchesByIndex) {
    const node = children[index]

    if (!node) {
      return null
    }

    const textPatches = indexPatches.filter(
      (patch) => depth === patch.path.length - 1
    )
    const childPatches = indexPatches.filter(
      (patch) => depth < patch.path.length - 1
    )

    if (textPatches.length > 0) {
      if (!NodeApi.isText(node) || childPatches.length > 0) {
        return null
      }

      nextChildren[index] = Object.freeze({
        ...node,
        text: applyTextSnapshotOperations(
          node.text,
          textPatches.flatMap((patch) => patch.operations)
        ),
      }) as Descendant

      continue
    }

    if (!('children' in node) || !Array.isArray(node.children)) {
      return null
    }

    const updatedDescendants = updateTextPatchesInSnapshotChildren(
      node.children,
      childPatches,
      depth + 1
    )

    if (!updatedDescendants) {
      return null
    }

    nextChildren[index] =
      updatedDescendants === node.children
        ? node
        : (Object.freeze({
            ...node,
            children: updatedDescendants as Descendant[],
          }) as Descendant)
  }

  return Object.freeze(nextChildren)
}

const getPathStableSnapshot = (
  editor: Editor,
  previousSnapshot: EditorSnapshot,
  operations: readonly Operation[],
  root: string
): EditorSnapshot | null => {
  if (!canBuildPathStableSnapshot(operations, root)) {
    return null
  }

  const children = updateTextPatchesInSnapshotChildren(
    previousSnapshot.children as readonly Descendant[],
    buildTextSnapshotPatches(operations)
  )

  if (!children) {
    return null
  }

  const snapshot = Object.freeze({
    children,
    index: previousSnapshot.index,
    marks: getRootScopedMarks(
      getCurrentMarks(editor),
      getCurrentSelectionRoot(editor),
      root
    ),
    selection: getRootScopedSelection(
      getCurrentSelection(editor),
      getCurrentSelectionRoot(editor),
      root
    ),
    version: getVersion(editor),
  }) as unknown as EditorSnapshot

  return snapshot
}

const uniqPaths = (paths: Path[]) => {
  const seen = new Set<string>()
  return paths.filter((path) => {
    const key = pathKey(path)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

const getIndexedPaths = (index: RuntimeIndexLike): Path[] =>
  index.idToPath instanceof Map
    ? Array.from(index.idToPath.values())
    : Object.values(index.idToPath)

const getIndexedRuntimeId = (
  index: RuntimeIndexLike,
  path: Path
): RuntimeId | undefined => {
  const key = pathKey(path)

  return index.pathToId instanceof Map
    ? index.pathToId.get(key)
    : index.pathToId[key]
}

const uniqRuntimeIds = (
  runtimeIds: readonly (RuntimeId | null | undefined)[]
): RuntimeId[] => {
  const seen = new Set<RuntimeId>()
  const result: RuntimeId[] = []

  for (const runtimeId of runtimeIds) {
    if (!runtimeId || seen.has(runtimeId)) {
      continue
    }

    seen.add(runtimeId)
    result.push(runtimeId)
  }

  return result
}

const getRuntimeIdsForPaths = (
  paths: readonly Path[],
  previousIndex: RuntimeIndexLike,
  nextIndex: RuntimeIndexLike
): RuntimeId[] =>
  uniqRuntimeIds(
    paths.flatMap((path) => [
      getIndexedRuntimeId(previousIndex, path),
      getIndexedRuntimeId(nextIndex, path),
    ])
  )

const getRuntimeIdsForIndex = (index: RuntimeIndexLike): RuntimeId[] =>
  uniqRuntimeIds(
    getIndexedPaths(index).map((path) => getIndexedRuntimeId(index, path))
  )

const operationChangesTopLevelOrder = (operation: Operation): boolean => {
  switch (operation.type) {
    case 'replace_children':
      return operation.path.length === 0
    case 'insert_node':
    case 'merge_node':
    case 'remove_node':
    case 'split_node':
      return operation.path.length === 1
    case 'move_node':
      return operation.path.length === 1 || operation.newPath.length === 1
    default:
      return false
  }
}

function operationChangesTextContent(operation: Operation): boolean {
  return operation.type === 'split_node' && operation.path.length > 1
}

const getOperationScopePaths = (operations: readonly Operation[]): Path[] =>
  operations.flatMap((operation) => {
    if (!('path' in operation) || !Array.isArray(operation.path)) {
      return []
    }

    return operation.type === 'move_node'
      ? [operation.path, operation.newPath]
      : [operation.path]
  })

const getTextOperationPaths = (operations: readonly Operation[]): Path[] =>
  operations.flatMap((operation) =>
    operation.type === 'insert_text' || operation.type === 'remove_text'
      ? [operation.path]
      : []
  )

const getStructuralTextOperationPaths = (
  operations: readonly Operation[]
): Path[] =>
  operations.flatMap((operation) =>
    operation.type === 'split_node' && operation.path.length > 1
      ? [operation.path]
      : []
  )

const getTextElementPaths = (operations: readonly Operation[]): Path[] =>
  uniqPaths(
    getTextOperationPaths(operations).flatMap((path) =>
      PathApi.ancestors(path).filter((ancestor) => ancestor.length > 0)
    )
  )

const getTopLevelRuntimeIdsForPaths = (
  paths: readonly Path[],
  previousIndex: RuntimeIndexLike,
  nextIndex: RuntimeIndexLike
): RuntimeId[] =>
  getRuntimeIdsForPaths(
    Array.from(
      new Set(paths.filter((path) => path.length > 0).map((path) => path[0]!))
    ).map((index) => [index]),
    previousIndex,
    nextIndex
  )

const buildCommitRuntimeDirtiness = ({
  classes,
  decorationImpactRuntimeIds,
  dirtyPaths,
  dirtyScope,
  nextIndex,
  nodeImpactRuntimeIds,
  operations,
  previousIndex,
  selectionImpactRuntimeIds,
}: {
  classes: readonly OperationClass[]
  decorationImpactRuntimeIds: readonly RuntimeId[] | null
  dirtyPaths: readonly Path[]
  dirtyScope: 'none' | 'paths' | 'all'
  nextIndex: RuntimeIndexLike
  nodeImpactRuntimeIds: readonly RuntimeId[] | null
  operations: readonly Operation[]
  previousIndex: RuntimeIndexLike
  selectionImpactRuntimeIds: readonly RuntimeId[] | null
}): CommitRuntimeDirtiness => {
  const changeClass = classes[0]
  const fullDocumentChanged = dirtyScope === 'all' || changeClass === 'replace'
  const topLevelOrderChanged =
    fullDocumentChanged || operations.some(operationChangesTopLevelOrder)
  const rootRuntimeIdsChanged = topLevelOrderChanged
  const scopePaths =
    dirtyPaths.length > 0 ? dirtyPaths : getOperationScopePaths(operations)

  if (fullDocumentChanged) {
    const nextRuntimeIds = getRuntimeIdsForIndex(nextIndex)

    return {
      affectedNodeRuntimeIds: nextRuntimeIds,
      affectedProjectionRuntimeIds: nextRuntimeIds,
      affectedSelectionRuntimeIds: selectionImpactRuntimeIds,
      affectedTextRuntimeIds: nextRuntimeIds,
      dirtyElementRuntimeIds: null,
      dirtyTextRuntimeIds: null,
      dirtyTopLevelRanges: null,
      dirtyTopLevelRuntimeIds: null,
      fullDocumentChanged,
      markDirtyRuntimeIds: [],
      rootRuntimeIdsChanged,
      structuralDirtyRuntimeIds: null,
      textDirtyRuntimeIds: null,
      topLevelOrderChanged,
    }
  }

  const structuralTextRuntimeIds =
    changeClass === 'structural'
      ? getRuntimeIdsForPaths(
          getStructuralTextOperationPaths(operations),
          previousIndex,
          nextIndex
        )
      : []
  const dirtyTextRuntimeIds =
    changeClass === 'text'
      ? getRuntimeIdsForPaths(
          getTextOperationPaths(operations),
          previousIndex,
          nextIndex
        )
      : structuralTextRuntimeIds
  const dirtyElementRuntimeIds =
    changeClass === 'structural'
      ? null
      : changeClass === 'text'
        ? getRuntimeIdsForPaths(
            getTextElementPaths(operations),
            previousIndex,
            nextIndex
          )
        : []

  return {
    affectedNodeRuntimeIds: nodeImpactRuntimeIds,
    affectedProjectionRuntimeIds: decorationImpactRuntimeIds,
    affectedSelectionRuntimeIds: selectionImpactRuntimeIds,
    affectedTextRuntimeIds:
      changeClass === 'text' || structuralTextRuntimeIds.length > 0
        ? dirtyTextRuntimeIds
        : ([] as RuntimeId[]),
    dirtyElementRuntimeIds,
    dirtyTextRuntimeIds,
    dirtyTopLevelRanges: getTopLevelRanges(scopePaths),
    dirtyTopLevelRuntimeIds: topLevelOrderChanged
      ? null
      : getTopLevelRuntimeIdsForPaths(scopePaths, previousIndex, nextIndex),
    fullDocumentChanged,
    markDirtyRuntimeIds: [],
    rootRuntimeIdsChanged,
    structuralDirtyRuntimeIds:
      changeClass === 'structural' ? null : ([] as RuntimeId[]),
    textDirtyRuntimeIds:
      changeClass === 'text' || structuralTextRuntimeIds.length > 0
        ? dirtyTextRuntimeIds
        : ([] as RuntimeId[]),
    topLevelOrderChanged,
  }
}

const getSelectionShellPaths = (
  selection: Selection,
  index: RuntimeIndexLike
): Path[] => {
  if (!selection) {
    return []
  }

  const paths: Path[] = []

  for (const point of [selection.anchor, selection.focus]) {
    for (let depth = point.path.length; depth > 0; depth--) {
      paths.push(point.path.slice(0, depth))
    }
  }

  if (RangeApi.isCollapsed(selection)) {
    return uniqPaths(paths)
  }

  for (const path of getIndexedPaths(index)) {
    if (RangeApi.includes(selection, path)) {
      paths.push(path)
    }
  }

  return uniqPaths(paths)
}

const getSelectionRuntimeIds = (
  selection: Selection,
  index: RuntimeIndexLike
): RuntimeId[] =>
  getSelectionShellPaths(selection, index)
    .map((path) => getIndexedRuntimeId(index, path))
    .filter((runtimeId): runtimeId is RuntimeId => Boolean(runtimeId))

const isBroadTopLevelSelection = (selection: Selection) => {
  if (!selection || RangeApi.isCollapsed(selection)) {
    return false
  }

  const [start, end] = RangeApi.edges(selection)
  const startTopLevelIndex = start.path[0]
  const endTopLevelIndex = end.path[0]

  return (
    startTopLevelIndex != null &&
    endTopLevelIndex != null &&
    Math.abs(endTopLevelIndex - startTopLevelIndex) >= 128
  )
}

const getSelectionImpactRuntimeIds = ({
  nextIndex,
  previousIndex,
  selectionAfter,
  selectionBefore,
}: {
  nextIndex: RuntimeIndexLike
  previousIndex: RuntimeIndexLike
  selectionAfter: Selection
  selectionBefore: Selection
}): RuntimeId[] | null => {
  if (
    isBroadTopLevelSelection(selectionBefore) ||
    isBroadTopLevelSelection(selectionAfter)
  ) {
    return null
  }

  return Array.from(
    new Set([
      ...getSelectionRuntimeIds(selectionBefore, previousIndex),
      ...getSelectionRuntimeIds(selectionAfter, nextIndex),
    ])
  )
}

const getDecorationImpactRuntimeIds = ({
  classes,
  dirtyPaths,
  nextIndex,
  previousIndex,
  selectionImpactRuntimeIds,
  touchedRuntimeIds,
}: {
  classes: readonly OperationClass[]
  dirtyPaths: readonly Path[]
  nextIndex: RuntimeIndexLike
  previousIndex: RuntimeIndexLike
  selectionImpactRuntimeIds: readonly RuntimeId[] | null
  touchedRuntimeIds: readonly RuntimeId[] | null
}): readonly RuntimeId[] | null => {
  const changeClass = classes[0]

  if (changeClass === 'replace' || changeClass === 'structural') {
    return null
  }

  if (changeClass === 'selection') {
    return selectionImpactRuntimeIds
  }

  if (changeClass === 'mark') {
    return []
  }

  const dirtyRuntimeIds = getRuntimeIdsForPaths(
    dirtyPaths,
    previousIndex,
    nextIndex
  )

  return dirtyRuntimeIds.length > 0
    ? dirtyRuntimeIds
    : [...(touchedRuntimeIds ?? [])]
}

const getNodeImpactRuntimeIds = ({
  classes,
  dirtyPaths,
  nextIndex,
  previousIndex,
  touchedRuntimeIds,
}: {
  classes: readonly OperationClass[]
  dirtyPaths: readonly Path[]
  nextIndex: RuntimeIndexLike
  previousIndex: RuntimeIndexLike
  touchedRuntimeIds: readonly RuntimeId[] | null
}): readonly RuntimeId[] | null => {
  const changeClass = classes[0]

  if (changeClass === 'replace' || changeClass === 'structural') {
    return null
  }

  if (changeClass === 'selection' || changeClass === 'mark') {
    return []
  }

  const dirtyRuntimeIds = getRuntimeIdsForPaths(
    dirtyPaths,
    previousIndex,
    nextIndex
  )

  return dirtyRuntimeIds.length > 0
    ? dirtyRuntimeIds
    : [...(touchedRuntimeIds ?? [])]
}

export const buildSnapshotChange = ({
  command = null,
  metadata = {},
  nextSnapshot,
  operations,
  previousSnapshot,
  reason,
  statePatches = [],
  tags = [],
}: {
  command?: EditorCommitCommand | null
  metadata?: EditorUpdateMetadata
  nextSnapshot: EditorSnapshot
  operations: Operation[]
  previousSnapshot: EditorSnapshot
  reason: 'replace' | null
  statePatches?: readonly EditorStatePatch[]
  tags?: readonly EditorUpdateTag[]
}): SnapshotChange => {
  const hasTextOperation = operations.some(
    (op) => op.type === 'insert_text' || op.type === 'remove_text'
  )
  const hasReplaceFragmentOperation = operations.some(
    (op) => op.type === 'replace_fragment'
  )
  const hasStructuralTextOperation = operations.some(
    operationChangesTextContent
  )
  const classes =
    reason === 'replace' || hasReplaceFragmentOperation
      ? (['replace'] as const)
      : operations.length > 0 &&
          operations.every((op) => op.type === 'set_selection')
        ? (['selection'] as const)
        : hasTextOperation &&
            operations.every(
              (op) =>
                op.type === 'insert_text' ||
                op.type === 'remove_text' ||
                op.type === 'set_selection'
            )
          ? (['text'] as const)
          : operations.length > 0
            ? hasStructuralTextOperation
              ? (['structural', 'text'] as const)
              : (['structural'] as const)
            : statePatches.length > 0
              ? (['state'] as const)
              : (['mark'] as const)

  const marksChanged =
    JSON.stringify(previousSnapshot.marks) !==
    JSON.stringify(nextSnapshot.marks)
  const selectionChanged =
    JSON.stringify(previousSnapshot.selection) !==
    JSON.stringify(nextSnapshot.selection)
  const selectionImpactRuntimeIds =
    classes[0] === 'replace'
      ? null
      : getSelectionImpactRuntimeIds({
          nextIndex: nextSnapshot.index,
          previousIndex: previousSnapshot.index,
          selectionAfter: nextSnapshot.selection,
          selectionBefore: previousSnapshot.selection,
        })

  const childrenChanged =
    classes[0] === 'replace' ||
    classes[0] === 'text' ||
    classes[0] === 'structural'

  const dirtyPaths =
    classes[0] === 'text'
      ? uniqPaths(
          operations.flatMap((op) =>
            'path' in op && Array.isArray(op.path)
              ? [[], op.path.slice(0, -1), op.path]
              : []
          )
        )
      : []

  const touchedRuntimeIds =
    classes[0] === 'replace'
      ? null
      : classes[0] === 'selection' || classes[0] === 'mark'
        ? []
        : uniqPaths(
            operations.flatMap((op) =>
              'path' in op && Array.isArray(op.path) ? [op.path] : []
            )
          ).map(
            (path) =>
              previousSnapshot.index.pathToId[pathKey(path)] ??
              nextSnapshot.index.pathToId[pathKey(path)]
          )
  const decorationImpactRuntimeIds = getDecorationImpactRuntimeIds({
    classes,
    dirtyPaths,
    nextIndex: nextSnapshot.index,
    previousIndex: previousSnapshot.index,
    selectionImpactRuntimeIds,
    touchedRuntimeIds,
  })
  const nodeImpactRuntimeIds = getNodeImpactRuntimeIds({
    classes,
    dirtyPaths,
    nextIndex: nextSnapshot.index,
    previousIndex: previousSnapshot.index,
    touchedRuntimeIds,
  })
  const dirtyScope =
    classes[0] === 'replace'
      ? 'all'
      : classes[0] === 'selection' ||
          classes[0] === 'mark' ||
          classes[0] === 'state'
        ? 'none'
        : 'paths'

  return completeCommit(
    {
      ...buildCommitRuntimeDirtiness({
        classes,
        decorationImpactRuntimeIds,
        dirtyPaths,
        dirtyScope,
        nextIndex: nextSnapshot.index,
        nodeImpactRuntimeIds,
        operations,
        previousIndex: previousSnapshot.index,
        selectionImpactRuntimeIds,
      }),
      childrenChanged,
      classes,
      command: cloneValue(command),
      decorationImpactRuntimeIds,
      dirtyPaths,
      dirtyScope,
      dirtyStateKeys: Object.freeze(statePatches.map((patch) => patch.key)),
      marksAfter: cloneValue(nextSnapshot.marks),
      marksBefore: cloneValue(previousSnapshot.marks),
      marksChanged,
      metadata: cloneUpdateMetadata(metadata),
      nodeImpactRuntimeIds,
      operations: Object.freeze([...operations]),
      replaceEpoch: classes[0] === 'replace' ? 1 : 0,
      selectionAfter: cloneValue(nextSnapshot.selection),
      selectionBefore: cloneValue(previousSnapshot.selection),
      selectionChanged,
      selectionImpactRuntimeIds,
      statePatches: Object.freeze(cloneValue([...statePatches])),
      tags: Object.freeze([...tags]),
      touchedRuntimeIds:
        touchedRuntimeIds == null
          ? null
          : Object.freeze(touchedRuntimeIds.filter(Boolean) as RuntimeId[]),
    },
    {
      previousVersion: previousSnapshot.version,
      version: nextSnapshot.version,
    }
  )
}

export const notifyListeners = (editor: Editor, change?: SnapshotChange) => {
  if (change) {
    LAST_COMMIT.set(editor, change)
  }

  const listeners = LISTENERS.get(editor)
  const sourceListeners = SOURCE_LISTENERS.get(editor)
  const commitListeners = change
    ? getExtensionRegistry(editor).commitListeners
    : null
  const hasSnapshotListeners =
    (listeners && listeners.size > 0) || hasSourceListeners(editor)
  const commitListenersNeedSnapshot =
    commitListeners &&
    [...commitListeners].some((listener) => listener.length >= 2)

  if (hasSnapshotListeners || (commitListeners && commitListeners.size > 0)) {
    let snapshot: EditorSnapshot | null = null
    const getSnapshotForListeners = () => {
      snapshot ??= getListenerSnapshot(editor, change)

      return snapshot
    }

    if (change) {
      for (const listener of commitListeners ?? []) {
        if (listener.length >= 2) {
          listener(change, getSnapshotForListeners())
        } else {
          ;(listener as (commit: SnapshotChange) => void)(change)
        }
      }
    }

    if (hasSnapshotListeners || commitListenersNeedSnapshot) {
      getSnapshotForListeners()
    }

    for (const listener of listeners ?? []) {
      listener(getSnapshotForListeners(), change)
    }

    if (change && sourceListeners) {
      for (const source of getSourcesForChange(change)) {
        for (const listener of sourceListeners.get(source) ?? []) {
          listener(getSnapshotForListeners(), change)
        }
      }
    }
  }
}

const materializeAfterCommitHandlers = (
  editor: Editor,
  commit: SnapshotChange,
  handlers: readonly TransactionAfterCommitHandler[]
): MaterializedAfterCommitHandler[] => {
  const snapshots = new Map<string, EditorSnapshot>()

  return handlers.map(({ handler, root }) => {
    let snapshot = snapshots.get(root)

    if (!snapshot) {
      snapshot = getCurrentRootSnapshot(editor, root)
      snapshots.set(root, snapshot)
    }

    return {
      context: {
        commit,
        editor,
        snapshot,
      } as EditorCommitContext,
      handler,
    }
  })
}

const runAfterCommitHandlers = (
  handlers: readonly MaterializedAfterCommitHandler[]
) => {
  for (const { context, handler } of handlers) {
    handler(context)
  }
}

export const incrementVersion = (editor: Editor) => {
  setVersion(editor, getVersion(editor) + 1)
}

export const canUseTextFastPath = (editor: Editor) =>
  getEditorRuntime(editor).normalizeNode ===
    DEFAULT_NORMALIZE_NODE.get(editor) &&
  getEditorRuntime(editor).shouldNormalize ===
    DEFAULT_SHOULD_NORMALIZE.get(editor) &&
  getEditorRuntime(editor).isNormalizing === DEFAULT_IS_NORMALIZING.get(editor)

export const hasListeners = (editor: Editor) =>
  (LISTENERS.get(editor)?.size ?? 0) > 0 || hasSourceListeners(editor)

const hasSourceListeners = (editor: Editor) => {
  const sourceListeners = SOURCE_LISTENERS.get(editor)

  if (!sourceListeners) {
    return false
  }

  for (const listeners of sourceListeners.values()) {
    if (listeners.size > 0) {
      return true
    }
  }

  return false
}

const getSourcesForChange = (
  change: SnapshotChange
): readonly EditorCommitSource[] => {
  const sources: EditorCommitSource[] = ['commit']

  if (
    change.selectionChanged ||
    (change.selectionImpactRuntimeIds?.length ?? 0) > 0
  ) {
    sources.push('selection')
  }

  if (change.classes.includes('text')) {
    sources.push('text')
  }

  if (
    change.nodeImpactRuntimeIds == null ||
    change.nodeImpactRuntimeIds.length > 0
  ) {
    sources.push('node')
  }

  if (
    change.classes.includes('text') ||
    change.classes.includes('structural') ||
    change.classes.includes('replace')
  ) {
    sources.push('decoration')
  }

  if (
    change.classes.includes('text') ||
    change.classes.includes('structural') ||
    change.classes.includes('replace')
  ) {
    sources.push('root')
  }

  if (change.dirtyStateKeys.length > 0) {
    sources.push('state')
  }

  return sources
}

const restoreTransactionSnapshot = (
  editor: Editor,
  transactionSnapshot: TransactionSnapshot
) => {
  const restoredRoots = cloneValue(transactionSnapshot.roots)
  const activeRoot = getCurrentChildrenRoot(editor)
  const restoredChildren: Descendant[] = Object.hasOwn(
    restoredRoots,
    activeRoot
  )
    ? (restoredRoots[activeRoot] ?? [])
    : activeRoot === transactionSnapshot.childrenRoot
      ? (cloneValue(transactionSnapshot.children) as Descendant[])
      : (restoredRoots[MAIN_ROOT_KEY] ?? [])

  const seedFromIndex = (
    children: readonly Descendant[],
    sourceIndex: RuntimeIndexLike,
    parentPath: Path = []
  ) => {
    children.forEach((child, childIndex) => {
      const path = [...parentPath, childIndex] as Path
      const runtimeId =
        sourceIndex.pathToId instanceof Map
          ? sourceIndex.pathToId.get(pathKey(path))
          : sourceIndex.pathToId[pathKey(path)]

      if (runtimeId) {
        setRuntimeId(child, editor, runtimeId)
      } else {
        getOrCreateRuntimeId(child, editor)
      }

      if ('children' in child && Array.isArray(child.children)) {
        seedFromIndex(child.children, sourceIndex, path)
      }
    })
  }

  for (const [root, children] of Object.entries(restoredRoots)) {
    const index =
      transactionSnapshot.rootIndexes[root] ??
      (root === transactionSnapshot.childrenRoot
        ? transactionSnapshot.previousIndex
        : null)

    if (index) {
      seedFromIndex(children, index)
    } else {
      seedRuntimeIds(children, editor)
    }
  }
  CHILDREN.set(editor, restoredChildren)
  ROOTS.set(editor, restoredRoots)
  CURRENT_CHILDREN_ROOT.set(editor, activeRoot)
  bumpMutationVersion(editor)
  bumpRuntimeIndexVersion(editor)
  SNAPSHOT_CACHE.delete(editor)
  setCurrentSelection(
    editor,
    transactionSnapshot.selection,
    transactionSnapshot.selectionRoot
  )
  setCurrentMarks(editor, transactionSnapshot.marks)
  DOCUMENT_STATE.set(
    editor,
    transactionSnapshot.documentState
      ? cloneValue(transactionSnapshot.documentState)
      : undefined
  )
  setOperations(editor, transactionSnapshot.operations)
}

export const runEditorTransaction = (
  editor: Editor,
  fn: (transaction: EditorTransaction) => void,
  options: {
    authority?: TransactionAuthority
    metadata?: EditorUpdateMetadata
    skipNormalize?: boolean
  } = {}
) => {
  const depth = TRANSACTION_DEPTH.get(editor) ?? 0
  const isOuter = depth === 0

  if (isOuter) {
    assertCanStartEditorWrite(editor, options.authority)
  }

  if (isOuter) {
    const needsPreviousSnapshot = hasListeners(editor)
    const previousSnapshot = needsPreviousSnapshot
      ? profileCoreDuration('transaction-previous-snapshot', () =>
          getSnapshot(editor)
        )
      : null
    const previousVersion = previousSnapshot?.version ?? getVersion(editor)
    const previousIndex = previousSnapshot?.index ?? getLiveRuntimeIndex(editor)
    const childrenRoot = getCurrentChildrenRoot(editor)
    const roots = getEditorDocumentRoots(editor)
    const rootEntries = Object.entries(roots)
    const rootIndexes =
      previousSnapshot || rootEntries.length > 1
        ? profileCoreDuration('transaction-root-indexes', () =>
            Object.fromEntries(
              rootEntries.map(([root, children]) => [
                root,
                buildSnapshotIndex(editor, children),
              ])
            )
          )
        : {}
    const transactionRoots = profileCoreDuration(
      'transaction-roots-snapshot',
      () => ({ ...roots })
    )
    const transactionChildren = profileCoreDuration(
      'transaction-children-clone',
      () =>
        previousSnapshot?.children ??
        transactionRoots[childrenRoot] ??
        getChildren(editor)
    )

    TRANSACTION_SNAPSHOT.set(editor, {
      afterCommitHandlers: [],
      children: transactionChildren,
      childrenRoot,
      command: profileCoreDuration('transaction-command', () =>
        cloneValue(getCommandContext(editor))
      ),
      documentState: cloneDocumentState(DOCUMENT_STATE.get(editor)),
      implicitTarget: null,
      implicitTargetResolved: false,
      marks: previousSnapshot?.marks ?? getCurrentMarks(editor),
      metadata: cloneUpdateMetadata(options.metadata),
      operations: [...getOperations(editor)],
      previousIndex,
      previousSnapshot,
      previousVersion,
      reason: null,
      rootIndexes,
      roots: transactionRoots,
      selection: previousSnapshot?.selection ?? getCurrentSelection(editor),
      selectionRoot: getCurrentSelectionRoot(editor),
      statePatches: [],
      tags: new Set(getCurrentUpdateTags(editor)),
    })
    TRANSACTION_CHANGED.set(editor, false)
  } else if (options.metadata) {
    const transactionSnapshot = TRANSACTION_SNAPSHOT.get(editor)

    if (transactionSnapshot) {
      transactionSnapshot.metadata = mergeUpdateMetadata(
        transactionSnapshot.metadata,
        options.metadata
      )
    }
  }

  TRANSACTION_DEPTH.set(editor, depth + 1)

  try {
    const transaction = getTransactionView(editor)
    TRANSACTION_APPLY.set(editor, transaction.apply)
    profileCoreDuration('transaction-callback', () => fn(transaction))

    const operations = getLiveOperations(editor)
    const snapshot = TRANSACTION_SNAPSHOT.get(editor)
    const operationsSinceSnapshot = operations.slice(
      snapshot?.operations.length ?? 0
    )
    const selectionOnlyTransaction =
      operationsSinceSnapshot.length > 0 &&
      operationsSinceSnapshot.every(
        (operation) => operation.type === 'set_selection'
      )

    if (
      isOuter &&
      (TRANSACTION_CHANGED.get(editor) ?? false) &&
      getEditorRuntime(editor).isNormalizing() &&
      !options.skipNormalize &&
      !selectionOnlyTransaction
    ) {
      const latestContentOperationByRoot = new Map<string, Operation>()

      for (const operation of operationsSinceSnapshot) {
        if (operation.type === 'set_selection') {
          continue
        }

        latestContentOperationByRoot.set(
          getOperationRoot(operation) ?? MAIN_ROOT_KEY,
          operation
        )
      }

      for (const root of latestContentOperationByRoot.keys()) {
        const operation = latestContentOperationByRoot.get(root)
        const normalize = () =>
          profileCoreDuration('transaction-normalize', () =>
            getEditorTransformRegistry(editor).normalize({
              explicit: false,
              force: getOperationCount(editor) === 0,
              operation,
            })
          )

        withEditorOperationRoot(editor, root, () =>
          withEditorOperationRootChildren(editor, root, normalize)
        )
      }
    }
  } catch (error) {
    if (isOuter) {
      const snapshot = TRANSACTION_SNAPSHOT.get(editor)

      if (snapshot) {
        restoreTransactionSnapshot(editor, snapshot)
      }
      resetRangeRefDrafts(editor)
      TRANSACTION_APPLY.delete(editor)
      TRANSACTION_SNAPSHOT.delete(editor)
      TRANSACTION_CHANGED.delete(editor)
    }
    throw error
  } finally {
    const nextDepth = (TRANSACTION_DEPTH.get(editor) ?? 1) - 1
    TRANSACTION_DEPTH.set(editor, nextDepth)

    if (isOuter) {
      const snapshot = TRANSACTION_SNAPSHOT.get(editor)
      const changed =
        (TRANSACTION_CHANGED.get(editor) ?? false) &&
        hasTransactionNetChanges(editor, snapshot)

      TRANSACTION_APPLY.delete(editor)
      TRANSACTION_SNAPSHOT.delete(editor)
      TRANSACTION_CHANGED.delete(editor)

      if (changed) {
        profileCoreDuration('publish-range-refs', () =>
          publishRangeRefDrafts(editor)
        )
        PUBLIC_OPERATIONS.delete(editor)
        profileCoreDuration('set-version', () =>
          setVersion(editor, getVersion(editor) + 1)
        )
        const allOperations = profileCoreDuration('copy-operations', () => [
          ...getOperations(editor),
        ])
        const operations = snapshot
          ? allOperations.slice(snapshot.operations.length)
          : allOperations
        const operationRoot = getHomogeneousOperationRoot(operations)
        const changeRoot =
          operationRoot === null
            ? null
            : (operationRoot ?? snapshot?.childrenRoot ?? MAIN_ROOT_KEY)
        const previousVersion = snapshot?.previousVersion ?? getVersion(editor)
        const needsSnapshotChange =
          snapshot !== undefined &&
          snapshot !== null &&
          changeRoot !== null &&
          hasListeners(editor)
        const change = profileCoreDuration('build-change', () => {
          const nextChange =
            operationRoot === null
              ? withUnknownRuntimeImpact(
                  getOperationDirtiness(editor, operations, {
                    command: snapshot?.command,
                    marksBefore: snapshot?.marks,
                    previousIndex: snapshot?.previousIndex,
                    previousVersion,
                    reason: snapshot?.reason ?? null,
                    selectionBefore: snapshot?.selection,
                    statePatches: snapshot?.statePatches,
                    metadata: snapshot?.metadata,
                    tags: snapshot ? [...snapshot.tags] : [],
                  })
                )
              : needsSnapshotChange
                ? (() => {
                    const previousSnapshotForChange =
                      snapshot.previousSnapshot &&
                      changeRoot === snapshot.childrenRoot
                        ? snapshot.previousSnapshot
                        : getTransactionRootSnapshot(
                            editor,
                            snapshot,
                            changeRoot!
                          )
                    const nextSnapshot = profileCoreDuration(
                      'next-snapshot',
                      () =>
                        getPathStableSnapshot(
                          editor,
                          previousSnapshotForChange,
                          operations,
                          changeRoot!
                        ) ?? getCurrentRootSnapshot(editor, changeRoot!)
                    )

                    if (changeRoot === snapshot.childrenRoot) {
                      SNAPSHOT_CACHE.set(editor, nextSnapshot)
                    }

                    return buildSnapshotChange({
                      command: snapshot.command,
                      metadata: snapshot.metadata,
                      nextSnapshot,
                      operations,
                      previousSnapshot: previousSnapshotForChange,
                      reason: snapshot.reason,
                      statePatches: snapshot.statePatches,
                      tags: [...snapshot.tags],
                    })
                  })()
                : (() => {
                    const previousIndexForChange =
                      snapshot && changeRoot
                        ? getTransactionSnapshotIndex(
                            editor,
                            snapshot,
                            changeRoot
                          )
                        : snapshot?.previousIndex
                    const operationIndexesArePathStable =
                      snapshot &&
                      changeRoot &&
                      canBuildPathStableSnapshot(operations, changeRoot)

                    return getOperationDirtiness(editor, operations, {
                      command: snapshot?.command,
                      marksBefore:
                        snapshot && changeRoot
                          ? getRootScopedMarks(
                              snapshot.marks,
                              snapshot.selectionRoot,
                              changeRoot
                            )
                          : snapshot?.marks,
                      nextIndex: operationIndexesArePathStable
                        ? previousIndexForChange
                        : changeRoot
                          ? getCurrentRootIndex(editor, changeRoot)
                          : undefined,
                      previousIndex: previousIndexForChange,
                      previousVersion,
                      reason: snapshot?.reason ?? null,
                      selectionBefore:
                        snapshot && changeRoot
                          ? getRootScopedSelection(
                              snapshot.selection,
                              snapshot.selectionRoot,
                              changeRoot
                            )
                          : snapshot?.selection,
                      statePatches: snapshot?.statePatches,
                      metadata: snapshot?.metadata,
                      tags: snapshot ? [...snapshot.tags] : [],
                    })
                  })()

          return snapshot
            ? withTransactionViewState(editor, snapshot, nextChange)
            : nextChange
        })
        const afterCommitHandlers =
          snapshot && snapshot.afterCommitHandlers.length > 0
            ? materializeAfterCommitHandlers(
                editor,
                change,
                snapshot.afterCommitHandlers
              )
            : []

        profileCoreDuration('notify-listeners', () =>
          notifyListeners(editor, change)
        )
        profileCoreDuration('run-after-commit-handlers', () =>
          runAfterCommitHandlers(afterCommitHandlers)
        )
      }
    }
  }
}

export const replaceSnapshot = (editor: Editor, input: SnapshotInput) => {
  runEditorTransaction(
    editor,
    () => {
      const transaction = TRANSACTION_SNAPSHOT.get(editor)
      const existingIndex = buildSnapshotIndex(editor, getChildren(editor))
      const nextChildren = cloneValue([...input.children])

      if (transaction) {
        transaction.reason = 'replace'
      }

      seedRuntimeIdsFromIndex(nextChildren, editor, existingIndex)
      setChildren(editor, nextChildren, { invalidateRuntimeIndex: true })
      setCurrentSelection(editor, input.selection ?? null)
      setCurrentMarks(editor, input.marks ?? null)
    },
    {
      authority: 'replace',
    }
  )
}

export const subscribe = <V extends Value>(
  editor: Editor<V>,
  listener: SnapshotListener<V>
) => {
  const typedListener = listener as SnapshotListener
  const listeners = LISTENERS.get(editor) ?? new Set<SnapshotListener>()
  listeners.add(typedListener)
  LISTENERS.set(editor, listeners)

  return () => {
    listeners.delete(typedListener)
  }
}

export const subscribeSource = <V extends Value>(
  editor: Editor<V>,
  source: EditorCommitSource,
  listener: SnapshotListener<V>
) => {
  const typedListener = listener as SnapshotListener
  const sourceListeners =
    SOURCE_LISTENERS.get(editor) ??
    new Map<EditorCommitSource, Set<SnapshotListener>>()
  const listeners = sourceListeners.get(source) ?? new Set<SnapshotListener>()

  listeners.add(typedListener)
  sourceListeners.set(source, listeners)
  SOURCE_LISTENERS.set(editor, sourceListeners)

  return () => {
    listeners.delete(typedListener)

    if (listeners.size === 0) {
      sourceListeners.delete(source)
    }
  }
}

export const initializePublicState = <
  V extends Value,
  TExtensions extends readonly unknown[] = readonly [],
>(
  editor: Editor<V, TExtensions>,
  options: CreateEditorOptions<V, TExtensions> = {}
) => {
  const initialValue = normalizeInitialValue(options.initialValue)
  const initialChildren = initialValue.children

  if (!NodeApi.isNodeList(initialChildren)) {
    throw new Error(
      '[Slate] initialValue is invalid! Expected a list of elements.'
    )
  }

  for (const [key, children] of Object.entries(initialValue.roots)) {
    if (!NodeApi.isNodeList(children)) {
      throw new Error(
        `[Slate] initialValue.roots.${key} is invalid! Expected a list of elements.`
      )
    }
  }

  if (initialValue.explicit && initialChildren.length === 0) {
    throw new Error(
      '[Slate] initialValue is invalid! Expected at least one element.'
    )
  }

  CHILDREN.set(editor, initialChildren)
  ROOTS.set(editor, initialValue.roots)
  CURRENT_CHILDREN_ROOT.set(editor, MAIN_ROOT_KEY)
  DOCUMENT_STATE.set(editor, initialValue.state)
  seedRuntimeIds(initialChildren, editor)
  const initialSelectionRoot =
    getExplicitRangeRoot(options.initialSelection) ?? MAIN_ROOT_KEY
  CURRENT_SELECTION.set(
    editor,
    normalizeSelectionRoot(
      options.initialSelection ?? null,
      initialSelectionRoot
    )
  )
  CURRENT_SELECTION_ROOT.set(editor, initialSelectionRoot)
  CURRENT_MARKS.set(editor, null)
  DEFAULT_IS_NORMALIZING.set(editor, getEditorRuntime(editor).isNormalizing)
  DEFAULT_NORMALIZE_NODE.set(editor, getEditorRuntime(editor).normalizeNode)
  DEFAULT_SHOULD_NORMALIZE.set(editor, getEditorRuntime(editor).shouldNormalize)
  LISTENERS.set(editor, new Set())
  SOURCE_LISTENERS.set(editor, new Map())
  LAST_COMMIT.set(editor, null)
  STATE_FIELDS.set(editor, new Map())
  setOperations(editor, [])
  MUTATION_VERSION.set(editor, 0)
  RUNTIME_INDEX_VERSION.set(editor, 0)
  RUNTIME_INDEX_CACHE.delete(editor)
  SNAPSHOT_CACHE.delete(editor)
  setVersion(editor, 0)
}
