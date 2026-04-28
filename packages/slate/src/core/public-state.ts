import { publishRangeRefDrafts, resetRangeRefDrafts } from '../editor/range-ref'
import type {
  DirtyRegion,
  Editor,
  EditorCommit,
  EditorCommitCommand,
  EditorMarks,
  EditorSnapshot,
  EditorTargetRuntime,
  EditorTransaction,
  EditorUpdateOptions,
  OperationClass,
  RuntimeId,
  Selection,
  SnapshotChange,
  SnapshotIndex,
  SnapshotInput,
  SnapshotListener,
  Value,
} from '../interfaces/editor'
import type { Location } from '../interfaces/location'
import type { Descendant, Node as SlateNode } from '../interfaces/node'
import type { Operation } from '../interfaces/operation'
import type { Path } from '../interfaces/path'
import { Range } from '../interfaces/range'
import type { Text } from '../interfaces/text'
import { createSetSelectionOperation } from '../selection-operation'
import {
  getOrCreateRuntimeId,
  seedRuntimeIds,
  seedRuntimeIdsFromIndex,
} from '../utils/runtime-ids'
import { getExtensionRegistry } from './extension-registry'

type TransactionSnapshot = {
  children: Descendant[]
  marks: EditorMarks | null
  operations: Operation[]
  tags: Set<string>
  implicitTarget: Selection
  implicitTargetResolved: boolean
  previousSnapshot: EditorSnapshot
  command: EditorCommitCommand | null
  reason: 'replace' | null
  selection: Selection
}

type TransactionAuthority = 'explicit' | 'replace' | 'update'

type LiveRuntimeIndex = {
  idToPath: Map<RuntimeId, Path>
  pathToId: Map<string, RuntimeId>
}

type RuntimeIndexLike = SnapshotIndex | LiveRuntimeIndex

const CHILDREN = new WeakMap<Editor, Descendant[]>()
const CURRENT_MARKS = new WeakMap<Editor, EditorMarks | null>()
const CURRENT_SELECTION = new WeakMap<Editor, Selection>()
const LISTENERS = new WeakMap<Editor, Set<SnapshotListener>>()
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
const DEFAULT_IS_NORMALIZING = new WeakMap<Editor, Editor['isNormalizing']>()
const DEFAULT_NORMALIZE_NODE = new WeakMap<Editor, Editor['normalizeNode']>()
const DEFAULT_SHOULD_NORMALIZE = new WeakMap<
  Editor,
  Editor['shouldNormalize']
>()
const TRANSACTION_CHANGED = new WeakMap<Editor, boolean>()
const TRANSACTION_APPLY = new WeakMap<Editor, (operation: Operation) => void>()
const COMMAND_CONTEXT = new WeakMap<Editor, EditorCommitCommand[]>()
const READ_DEPTH = new WeakMap<Editor, number>()
const TRANSACTION_DEPTH = new WeakMap<Editor, number>()
const TRANSACTION_SNAPSHOT = new WeakMap<Editor, TransactionSnapshot>()
const TRANSACTION_VIEW = new WeakMap<Editor, EditorTransaction>()
const UPDATE_TAG_CONTEXT = new WeakMap<Editor, string[][]>()

const cloneValue = <T>(value: T): T => structuredClone(value)
const cloneFrozen = <T>(value: T): T => deepFreeze(cloneValue(value))

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
    decorationImpactRuntimeIds:
      change.decorationImpactRuntimeIds == null
        ? null
        : Object.freeze([...change.decorationImpactRuntimeIds]),
    dirty: buildDirtyRegion(change),
    nodeImpactRuntimeIds:
      change.nodeImpactRuntimeIds == null
        ? null
        : Object.freeze([...change.nodeImpactRuntimeIds]),
    previousVersion,
    snapshotChanged:
      change.childrenChanged || change.selectionChanged || change.marksChanged,
    structureChanged,
    selectionImpactRuntimeIds:
      change.selectionImpactRuntimeIds == null
        ? null
        : Object.freeze([...change.selectionImpactRuntimeIds]),
    tags: Object.freeze([...(change.tags ?? [])]),
    textChanged,
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
  tags: readonly string[],
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

export const getChildren = <V extends Value>(editor: Editor<V>): V =>
  (CHILDREN.get(editor) ?? []) as V

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
    tags = getCurrentUpdateTags(editor),
  }: {
    command?: EditorCommitCommand | null
    marksBefore?: EditorMarks | null
    previousIndex?: SnapshotIndex
    previousVersion?: number
    reason?: 'replace' | null
    selectionBefore?: Selection
    tags?: readonly string[]
  } = {}
): SnapshotChange => {
  const hasTextOperation = operations.some(
    (op) => op.type === 'insert_text' || op.type === 'remove_text'
  )
  const classes =
    reason === 'replace'
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
            ? (['structural'] as const)
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
            .map(
              (path) =>
                previousIndex?.pathToId[pathKey(path)] ??
                getLiveRuntimeIdAtPath(editor, path)
            )
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
  const nextRuntimeIndex = getLiveRuntimeIndex(editor)
  const selectionImpactRuntimeIds =
    classes[0] === 'replace'
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

  return completeCommit(
    {
      childrenChanged:
        classes[0] === 'replace' ||
        classes[0] === 'text' ||
        classes[0] === 'structural',
      classes,
      command: cloneValue(command),
      decorationImpactRuntimeIds,
      dirtyPaths,
      dirtyScope:
        classes[0] === 'replace'
          ? 'all'
          : classes[0] === 'selection' || classes[0] === 'mark'
            ? 'none'
            : 'paths',
      marksAfter: cloneValue(marksAfter),
      marksBefore: cloneValue(marksBefore),
      marksChanged,
      nodeImpactRuntimeIds,
      operations: Object.freeze([...operations]),
      replaceEpoch: classes[0] === 'replace' ? 1 : 0,
      selectionAfter: cloneValue(selectionAfter),
      selectionBefore: cloneValue(selectionBefore),
      selectionChanged,
      selectionImpactRuntimeIds,
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

export const readEditor = <T>(editor: Editor, fn: () => T): T => {
  const depth = READ_DEPTH.get(editor) ?? 0
  READ_DEPTH.set(editor, depth + 1)

  try {
    return fn()
  } finally {
    if (depth === 0) {
      READ_DEPTH.delete(editor)
    } else {
      READ_DEPTH.set(editor, depth)
    }
  }
}

export const updateEditor = (
  editor: Editor,
  fn: () => void,
  options: EditorUpdateOptions = {}
) => {
  if ((READ_DEPTH.get(editor) ?? 0) > 0 && !isInTransaction(editor)) {
    throw new Error(
      'editor.update cannot be started inside editor.read outside an active update'
    )
  }

  const tags = normalizeUpdateTags(options.tag)

  return withUpdateTagContext(editor, tags, () =>
    withTransaction(editor, () => fn(), {
      authority: 'update',
      skipNormalize: options.skipNormalize,
    })
  )
}

export const setChildren = (editor: Editor, children: Descendant[]) => {
  CHILDREN.set(editor, children)
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

export const getPublicSelection = (editor: Editor): Selection =>
  getCurrentSelection(editor)

export const setCurrentSelection = (editor: Editor, selection: Selection) => {
  const cloned = cloneValue(selection ?? null)
  CURRENT_SELECTION.set(editor, cloned)
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

  snapshot.implicitTarget = Range.transform(snapshot.implicitTarget, operation)
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
  const baseApply = BASE_APPLY.get(editor)

  if (!baseApply) {
    throw new Error('Editor operation applier has not been initialized.')
  }

  const middlewares = [...getExtensionRegistry(editor).operationMiddlewares]
  let index = -1

  const dispatch = (nextOperation: Operation = operation) => {
    index += 1
    const middleware = middlewares[index]

    if (!middleware) {
      baseApply(nextOperation)
      return
    }

    middleware({ editor, operation: nextOperation }, dispatch)
  }

  dispatch(operation)
}

export const applyOperation = (editor: Editor, operation: Operation) => {
  const writer = TRANSACTION_APPLY.get(editor)

  if (writer) {
    writer(operation)
    return
  }

  assertCanStartEditorWrite(editor)
  withTransaction(editor, (transaction) => {
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

  for (const path of getIndexedPaths(index)) {
    if (Range.includes(selection, path)) {
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
}): RuntimeId[] =>
  Array.from(
    new Set([
      ...getSelectionRuntimeIds(selectionBefore, previousIndex),
      ...getSelectionRuntimeIds(selectionAfter, nextIndex),
    ])
  )

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
  nextSnapshot,
  operations,
  previousSnapshot,
  reason,
  tags = [],
}: {
  command?: EditorCommitCommand | null
  nextSnapshot: EditorSnapshot
  operations: Operation[]
  previousSnapshot: EditorSnapshot
  reason: 'replace' | null
  tags?: readonly string[]
}): SnapshotChange => {
  const hasTextOperation = operations.some(
    (op) => op.type === 'insert_text' || op.type === 'remove_text'
  )
  const classes =
    reason === 'replace'
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
            ? (['structural'] as const)
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

  return completeCommit(
    {
      childrenChanged,
      classes,
      command: cloneValue(command),
      decorationImpactRuntimeIds,
      dirtyPaths,
      dirtyScope:
        classes[0] === 'replace'
          ? 'all'
          : classes[0] === 'selection' || classes[0] === 'mark'
            ? 'none'
            : 'paths',
      marksAfter: cloneValue(nextSnapshot.marks),
      marksBefore: cloneValue(previousSnapshot.marks),
      marksChanged,
      nodeImpactRuntimeIds,
      operations: Object.freeze([...operations]),
      replaceEpoch: reason === 'replace' ? 1 : 0,
      selectionAfter: cloneValue(nextSnapshot.selection),
      selectionBefore: cloneValue(previousSnapshot.selection),
      selectionChanged,
      selectionImpactRuntimeIds,
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
  const commitListeners = change
    ? getExtensionRegistry(editor).commitListeners
    : null

  if (
    (listeners && listeners.size > 0) ||
    (commitListeners && commitListeners.size > 0)
  ) {
    const snapshot = getSnapshot(editor)

    for (const listener of listeners ?? []) {
      listener(snapshot, change)
    }

    if (change) {
      for (const listener of commitListeners ?? []) {
        listener(change, snapshot)
      }
    }
  }
}

export const incrementVersion = (editor: Editor) => {
  setVersion(editor, getVersion(editor) + 1)
}

export const canUseTextFastPath = (editor: Editor) =>
  editor.normalizeNode === DEFAULT_NORMALIZE_NODE.get(editor) &&
  editor.shouldNormalize === DEFAULT_SHOULD_NORMALIZE.get(editor) &&
  editor.isNormalizing === DEFAULT_IS_NORMALIZING.get(editor)

export const hasListeners = (editor: Editor) =>
  (LISTENERS.get(editor)?.size ?? 0) > 0

const restoreTransactionSnapshot = (
  editor: Editor,
  transactionSnapshot: TransactionSnapshot
) => {
  const restoredChildren = cloneValue(transactionSnapshot.children)
  seedRuntimeIdsFromIndex(
    restoredChildren,
    editor,
    transactionSnapshot.previousSnapshot.index
  )
  CHILDREN.set(editor, restoredChildren)
  setCurrentSelection(editor, transactionSnapshot.selection)
  setCurrentMarks(editor, transactionSnapshot.marks)
  setOperations(editor, transactionSnapshot.operations)
}

export const withTransaction = (
  editor: Editor,
  fn: (transaction: EditorTransaction) => void,
  options: { authority?: TransactionAuthority; skipNormalize?: boolean } = {}
) => {
  const depth = TRANSACTION_DEPTH.get(editor) ?? 0
  const isOuter = depth === 0

  if (isOuter) {
    assertCanStartEditorWrite(editor, options.authority)
  }

  if (isOuter) {
    TRANSACTION_SNAPSHOT.set(editor, {
      children: cloneValue(getChildren(editor)),
      command: cloneValue(getCommandContext(editor)),
      tags: new Set(getCurrentUpdateTags(editor)),
      implicitTarget: null,
      implicitTargetResolved: false,
      marks: cloneValue(getCurrentMarks(editor)),
      operations: [...getOperations(editor)],
      previousSnapshot: getSnapshot(editor),
      reason: null,
      selection: cloneValue(getCurrentSelection(editor)),
    })
    TRANSACTION_CHANGED.set(editor, false)
  }

  TRANSACTION_DEPTH.set(editor, depth + 1)

  try {
    const transaction = getTransactionView(editor)
    TRANSACTION_APPLY.set(editor, transaction.apply)
    fn(transaction)

    const operations = getLiveOperations(editor)
    const snapshot = TRANSACTION_SNAPSHOT.get(editor)
    const selectionOnlyTransaction =
      operations.length > 0 &&
      operations
        .slice(snapshot?.operations.length ?? 0)
        .every((operation) => operation.type === 'set_selection')

    if (
      isOuter &&
      (TRANSACTION_CHANGED.get(editor) ?? false) &&
      editor.isNormalizing() &&
      !options.skipNormalize &&
      !selectionOnlyTransaction
    ) {
      editor.normalize({
        explicit: false,
        force: getOperationCount(editor) === 0,
        operation:
          getLatestContentOperation(editor, snapshot?.operations.length ?? 0) ??
          getLatestOperation(editor),
      })
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
      const changed = TRANSACTION_CHANGED.get(editor) ?? false

      const snapshot = TRANSACTION_SNAPSHOT.get(editor)
      TRANSACTION_APPLY.delete(editor)
      TRANSACTION_SNAPSHOT.delete(editor)
      TRANSACTION_CHANGED.delete(editor)

      if (changed) {
        publishRangeRefDrafts(editor)
        PUBLIC_OPERATIONS.delete(editor)
        setVersion(editor, getVersion(editor) + 1)
        const allOperations = [...getOperations(editor)]
        const operations = snapshot
          ? allOperations.slice(snapshot.operations.length)
          : allOperations
        const previousVersion =
          snapshot?.previousSnapshot.version ?? getVersion(editor)
        notifyListeners(
          editor,
          snapshot && hasListeners(editor)
            ? buildSnapshotChange({
                command: snapshot.command,
                nextSnapshot: getSnapshot(editor),
                operations,
                previousSnapshot: snapshot.previousSnapshot,
                reason: snapshot.reason,
                tags: [...snapshot.tags],
              })
            : getOperationDirtiness(editor, operations, {
                command: snapshot?.command,
                marksBefore: snapshot?.previousSnapshot.marks,
                previousIndex: snapshot?.previousSnapshot.index,
                previousVersion,
                reason: snapshot?.reason ?? null,
                selectionBefore: snapshot?.previousSnapshot.selection,
                tags: snapshot ? [...snapshot.tags] : [],
              })
        )
      }
    }
  }
}

export const replaceSnapshot = (editor: Editor, input: SnapshotInput) => {
  withTransaction(
    editor,
    () => {
      const transaction = TRANSACTION_SNAPSHOT.get(editor)
      const existingIndex = buildSnapshotIndex(editor, getChildren(editor))
      const nextChildren = cloneValue([...input.children])

      if (transaction) {
        transaction.reason = 'replace'
      }

      seedRuntimeIdsFromIndex(nextChildren, editor, existingIndex)
      setChildren(editor, nextChildren)
      setCurrentSelection(editor, input.selection ?? null)
      setCurrentMarks(editor, input.marks ?? null)
    },
    {
      authority: 'replace',
    }
  )
}

export const applyOperations = (
  editor: Editor,
  operations: readonly Operation[],
  options: EditorUpdateOptions = {}
) => {
  if (operations.length === 0) {
    return
  }

  updateEditor(
    editor,
    () => {
      for (const operation of operations) {
        applyOperation(editor, cloneValue(operation))
      }
    },
    options
  )
}

export const subscribe = (editor: Editor, listener: SnapshotListener) => {
  const listeners = LISTENERS.get(editor) ?? new Set<SnapshotListener>()
  listeners.add(listener)
  LISTENERS.set(editor, listeners)

  return () => {
    listeners.delete(listener)
  }
}

export const initializePublicState = (editor: Editor) => {
  CHILDREN.set(editor, [])
  seedRuntimeIds([], editor)
  CURRENT_SELECTION.set(editor, null)
  CURRENT_MARKS.set(editor, null)
  DEFAULT_IS_NORMALIZING.set(editor, editor.isNormalizing)
  DEFAULT_NORMALIZE_NODE.set(editor, editor.normalizeNode)
  DEFAULT_SHOULD_NORMALIZE.set(editor, editor.shouldNormalize)
  LISTENERS.set(editor, new Set())
  LAST_COMMIT.set(editor, null)
  setOperations(editor, [])
  MUTATION_VERSION.set(editor, 0)
  RUNTIME_INDEX_VERSION.set(editor, 0)
  RUNTIME_INDEX_CACHE.delete(editor)
  SNAPSHOT_CACHE.delete(editor)
  setVersion(editor, 0)
}
