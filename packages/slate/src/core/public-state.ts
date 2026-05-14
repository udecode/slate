import { node as getNode } from '../editor/node'
import { nodes as getNodes } from '../editor/nodes'
import { publishRangeRefDrafts, resetRangeRefDrafts } from '../editor/range-ref'
import type {
  CreateEditorOptions,
  DirtyRegion,
  Editor,
  EditorCommit,
  EditorCommitCommand,
  EditorCommitSource,
  EditorCoreStateView,
  EditorCoreUpdateTransaction,
  EditorFragmentReadOptions,
  EditorMarks,
  EditorNodesOptions,
  EditorSnapshot,
  EditorStateNodesApi,
  EditorStateView,
  EditorTargetRuntime,
  EditorTransaction,
  EditorUpdateMetadata,
  EditorUpdateOptions,
  EditorUpdateTag,
  EditorUpdateTransaction,
  OperationClass,
  RuntimeId,
  Selection,
  SnapshotChange,
  SnapshotIndex,
  SnapshotInput,
  SnapshotListener,
  TopLevelRuntimeRange,
  Value,
} from '../interfaces/editor'
import type { Location } from '../interfaces/location'
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
import { createSetSelectionOperation } from '../selection-operation'
import {
  getOrCreateRuntimeId,
  seedRuntimeIds,
  seedRuntimeIdsFromIndex,
  setRuntimeId,
} from '../utils/runtime-ids'
import { getEditorRuntime, getEditorSchema } from './editor-runtime'
import { getExtensionRegistry } from './extension-registry'
import { getEditorTransformRegistry } from './transform-registry'

type TransactionSnapshot = {
  children: readonly Descendant[]
  marks: EditorMarks | null
  metadata: EditorUpdateMetadata
  operations: Operation[]
  tags: Set<EditorUpdateTag>
  implicitTarget: Selection
  implicitTargetResolved: boolean
  previousIndex: RuntimeIndexLike
  previousSnapshot: EditorSnapshot | null
  previousVersion: number
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
  const type = (operation as { type?: unknown } | null)?.type

  if (typeof type === 'string' && KNOWN_OPERATION_TYPES.has(type)) {
    return
  }

  const label = typeof type === 'string' ? `"${type}"` : 'unknown'

  throw new Error(`Cannot replay an unknown Slate operation: ${label}.`)
}

const CHILDREN = new WeakMap<Editor, Descendant[]>()
const CURRENT_MARKS = new WeakMap<Editor, EditorMarks | null>()
const CURRENT_SELECTION = new WeakMap<Editor, Selection>()
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

const cloneValue = <T>(value: T): T => structuredClone(value)
const cloneFrozen = <T>(value: T): T => deepFreeze(cloneValue(value))

const now = () => globalThis.performance?.now?.() ?? Date.now()

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
    markDirtyRuntimeIds: freezeRuntimeIds(change.markDirtyRuntimeIds),
    metadata: cloneUpdateMetadata(change.metadata),
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
    metadata = {},
    tags = getCurrentUpdateTags(editor),
  }: {
    command?: EditorCommitCommand | null
    marksBefore?: EditorMarks | null
    metadata?: EditorUpdateMetadata
    previousIndex?: RuntimeIndexLike
    previousVersion?: number
    reason?: 'replace' | null
    selectionBefore?: Selection
    tags?: readonly EditorUpdateTag[]
  } = {}
): SnapshotChange => {
  const hasTextOperation = operations.some(
    (op) => op.type === 'insert_text' || op.type === 'remove_text'
  )
  const hasReplaceFragmentOperation = operations.some(
    (op) => op.type === 'replace_fragment'
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
    topLevelOrderChanged && classes[0] === 'structural'
      ? previousRuntimeIndex
      : getLiveRuntimeIndex(editor)
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
      : classes[0] === 'selection' || classes[0] === 'mark'
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
    if (map) {
      const mapped: R[] = []

      for (const entry of getNodes(editor, options)) {
        mapped.push(map(entry))
      }

      return mapped
    }

    const entries: NodeEntry<T>[] = []

    for (const entry of getNodes(editor, options)) {
      entries.push(entry)
    }

    return entries
  }

  return toArray
}

const getStateView = <V extends Value>(
  editor: Editor<V>
): EditorStateView<V> => {
  const state = {
    fragment: Object.freeze({
      get: (options = {}) => getFragment(editor, options) as DescendantIn<V>[],
    }),
    marks: Object.freeze({
      get: () => getSelectionMarks(editor),
    }),
    nodes: Object.freeze({
      above: <T extends Ancestor>(options = {}) =>
        getEditorRuntime(editor).above(options) as [T, Path] | undefined,
      children(at: Location = []) {
        const [node] = getNode(editor, at)

        return 'children' in node && Array.isArray(node.children)
          ? node.children
          : []
      },
      first: (at: Location) => getEditorRuntime(editor).first(at),
      get: <T extends SlateNode>(at: Location) =>
        getNode(editor, at) as [T, Path],
      hasBlocks: (element: import('../interfaces/element').Element) =>
        getEditorRuntime(editor).hasBlocks(element),
      hasInlines: (element: import('../interfaces/element').Element) =>
        getEditorRuntime(editor).hasInlines(element),
      hasPath: (path: Path) => getEditorRuntime(editor).hasPath(path),
      hasTexts: (element: import('../interfaces/element').Element) =>
        getEditorRuntime(editor).hasTexts(element),
      isBlock: (element: import('../interfaces/element').Element) =>
        getEditorRuntime(editor).isBlock(element),
      isEmpty: (element: import('../interfaces/element').Element) =>
        getEditorRuntime(editor).isEmpty(element),
      last: (at: Location) => getEditorRuntime(editor).last(at),
      leaf: (at, options = {}) => getEditorRuntime(editor).leaf(at, options),
      levels: <T extends SlateNode>(options = {}) =>
        getEditorRuntime(editor).levels(options) as Generator<
          [T, Path],
          void,
          undefined
        >,
      entries: <T extends SlateNode>(options = {}) =>
        getNodes(editor, options) as Generator<[T, Path], void, undefined>,
      find: <T extends SlateNode>(options = {}) => {
        for (const entry of getNodes(editor, options)) {
          return entry as [T, Path]
        }
      },
      some: (options = {}) => {
        for (const _entry of getNodes(editor, options)) {
          return true
        }

        return false
      },
      toArray: createNodesToArray(editor),
      next: <T extends SlateNode>(options = {}) =>
        getEditorRuntime(editor).next(options) as [T, Path] | undefined,
      parent: (at: Location) => getEditorRuntime(editor).parent(at),
      previous: <T extends SlateNode>(options = {}) =>
        getEditorRuntime(editor).previous(options) as [T, Path] | undefined,
      void: (options = {}) => getEditorRuntime(editor).void(options),
    }),
    points: Object.freeze({
      after: (at: Location, options = {}) =>
        getEditorRuntime(editor).after(at, options),
      before: (at: Location, options = {}) =>
        getEditorRuntime(editor).before(at, options),
      end: (at: Location) =>
        getEditorRuntime(editor).point(at, { edge: 'end' }),
      get: (at: Location, options = {}) =>
        getEditorRuntime(editor).point(at, options),
      isEdge: (point, at) => getEditorRuntime(editor).isEdge(point, at),
      isEnd: (point, at) => getEditorRuntime(editor).isEnd(point, at),
      isStart: (point, at) => getEditorRuntime(editor).isStart(point, at),
      start: (at: Location) =>
        getEditorRuntime(editor).point(at, { edge: 'start' }),
    }),
    ranges: Object.freeze({
      bookmark: (range, options = {}) =>
        getEditorTransformRegistry(editor).bookmark(range, options),
      edges: (at: Location) => getEditorRuntime(editor).edges(at),
      get: (at: Location) => getEditorRuntime(editor).range(at),
      project: (range) => getEditorRuntime(editor).projectRange(range),
      unhang: (range, options = {}) =>
        getEditorRuntime(editor).unhangRange(range, options),
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
        getEditorRuntime(editor).string(at, options),
    }),
    value: Object.freeze({
      get: () => getSnapshot(editor).children as V,
      lastCommit: () => getLastCommit(editor) as EditorCommit<V> | null,
      operations: (startIndex?: number) =>
        getOperations(editor, startIndex) as readonly Operation<V>[],
    }),
  } satisfies EditorCoreStateView<V>

  const stateRecord = state as unknown as EditorStateView<V> &
    Record<string, unknown>

  for (const [groupName, registration] of getExtensionRegistry(editor)
    .stateGroups) {
    stateRecord[groupName] = registration.factory(
      stateRecord as never,
      editor as never
    )
  }

  return Object.freeze(stateRecord) as EditorStateView<V>
}

const getUpdateView = <V extends Value>(
  editor: Editor<V>
): EditorUpdateTransaction<V> => {
  const state = getStateView(editor)
  const transforms = getEditorTransformRegistry(editor)
  const tx = {
    ...state,
    break: Object.freeze({
      insert: () => transforms.insertBreak(),
      insertSoft: () => transforms.insertSoftBreak(),
    }),
    fragment: Object.freeze({
      get: (...args: Parameters<typeof state.fragment.get>) =>
        state.fragment.get(...args),
      delete: (...args: Parameters<typeof transforms.deleteFragment>) =>
        transforms.deleteFragment(...args),
      insert: (...args: Parameters<typeof transforms.insertFragment>) =>
        transforms.insertFragment(...args),
    }),
    marks: Object.freeze({
      ...state.marks,
      add: (key: string, value: unknown) => transforms.addMark(key, value),
      remove: (key: string) => transforms.removeMark(key),
      toggle: (key: string, value = true) => transforms.toggleMark(key, value),
    }),
    nodes: Object.freeze({
      ...state.nodes,
      insert: (...args: Parameters<typeof transforms.insertNodes>) =>
        transforms.insertNodes(...args),
      insertMany: (...args: Parameters<typeof transforms.insertNodes>) =>
        transforms.insertNodes(...args),
      lift: (...args: Parameters<typeof transforms.liftNodes>) =>
        transforms.liftNodes(...args),
      merge: (...args: Parameters<typeof transforms.mergeNodes>) =>
        transforms.mergeNodes(...args),
      move: (...args: Parameters<typeof transforms.moveNodes>) =>
        transforms.moveNodes(...args),
      remove: (...args: Parameters<typeof transforms.removeNodes>) =>
        transforms.removeNodes(...args),
      set: (...args: Parameters<typeof transforms.setNodes>) =>
        transforms.setNodes(...args),
      split: (...args: Parameters<typeof transforms.splitNodes>) =>
        transforms.splitNodes(...args),
      unset: (...args: Parameters<typeof transforms.unsetNodes>) =>
        transforms.unsetNodes(...args),
      unwrap: (...args: Parameters<typeof transforms.unwrapNodes>) =>
        transforms.unwrapNodes(...args),
      wrap: (...args: Parameters<typeof transforms.wrapNodes>) =>
        transforms.wrapNodes(...args),
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
    selection: Object.freeze({
      ...state.selection,
      clear: () => transforms.deselect(),
      collapse: (options = {}) => transforms.collapse(options),
      move: (options = {}) => transforms.move(options),
      set: (target: Location | null) => {
        if (target == null) {
          transforms.deselect()
          return
        }

        transforms.select(target)
      },
      setPoint: (...args: Parameters<typeof transforms.setPoint>) =>
        transforms.setPoint(...args),
      setRange: (...args: Parameters<typeof transforms.setSelection>) =>
        transforms.setSelection(...args),
    }),
    text: Object.freeze({
      ...state.text,
      delete: (options = {}) => transforms.delete(options),
      deleteBackward: (options = {}) =>
        transforms.deleteBackward(options.unit ?? 'character'),
      deleteForward: (options = {}) =>
        transforms.deleteForward(options.unit ?? 'character'),
      insert: (text: string, options = {}) =>
        transforms.insertText(text, options),
    }),
    value: Object.freeze({
      ...state.value,
      replace: (input: SnapshotInput<V>) => replaceSnapshot(editor, input),
    }),
    withoutNormalizing: (fn: () => void) => transforms.withoutNormalizing(fn),
  } satisfies EditorCoreUpdateTransaction<V>

  const txRecord = tx as unknown as EditorUpdateTransaction<V> &
    Record<string, unknown>

  for (const [groupName, registration] of getExtensionRegistry(editor)
    .txGroups) {
    txRecord[groupName] = registration.factory(
      txRecord as never,
      editor as never
    )
  }

  return Object.freeze(txRecord) as EditorUpdateTransaction<V>
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

export const readEditor = <V extends Value, T>(
  editor: Editor<V>,
  fn: (state: EditorStateView<V>) => T
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

export const updateEditor = <V extends Value>(
  editor: Editor<V>,
  fn: (transaction: EditorUpdateTransaction<V>) => void,
  options: EditorUpdateOptions = {}
) => {
  if ((READ_DEPTH.get(editor) ?? 0) > 0 && !isInTransaction(editor)) {
    throw new Error(
      'editor.update cannot be started inside editor.read outside an active update'
    )
  }

  const tags = normalizeUpdateTags(options.tag)
  const metadata = cloneUpdateMetadata(options.metadata)

  return withUpdateTagContext(editor, tags, () =>
    runEditorTransaction(editor, () => fn(getUpdateView(editor)), {
      authority: 'update',
      metadata,
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

const canBuildPathStableSnapshot = (operations: readonly Operation[]) =>
  operations.length > 0 &&
  operations.every(
    (operation) =>
      operation.type === 'insert_text' ||
      operation.type === 'remove_text' ||
      operation.type === 'set_selection'
  )

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
  operations: readonly Operation[]
): EditorSnapshot | null => {
  if (!canBuildPathStableSnapshot(operations)) {
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
    marks: cloneFrozen(getCurrentMarks(editor)),
    selection: cloneFrozen(getCurrentSelection(editor)),
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

  const dirtyTextRuntimeIds =
    changeClass === 'text'
      ? getRuntimeIdsForPaths(
          getTextOperationPaths(operations),
          previousIndex,
          nextIndex
        )
      : []
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
      changeClass === 'text' ? dirtyTextRuntimeIds : ([] as RuntimeId[]),
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
      changeClass === 'text' ? dirtyTextRuntimeIds : ([] as RuntimeId[]),
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
  tags = [],
}: {
  command?: EditorCommitCommand | null
  metadata?: EditorUpdateMetadata
  nextSnapshot: EditorSnapshot
  operations: Operation[]
  previousSnapshot: EditorSnapshot
  reason: 'replace' | null
  tags?: readonly EditorUpdateTag[]
}): SnapshotChange => {
  const hasTextOperation = operations.some(
    (op) => op.type === 'insert_text' || op.type === 'remove_text'
  )
  const hasReplaceFragmentOperation = operations.some(
    (op) => op.type === 'replace_fragment'
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
  const dirtyScope =
    classes[0] === 'replace'
      ? 'all'
      : classes[0] === 'selection' || classes[0] === 'mark'
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
      snapshot ??= getSnapshot(editor)

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

  return sources
}

const restoreTransactionSnapshot = (
  editor: Editor,
  transactionSnapshot: TransactionSnapshot
) => {
  const restoredChildren = cloneValue([...transactionSnapshot.children])

  const seedFromPreviousIndex = (
    children: readonly Descendant[],
    parentPath: Path = []
  ) => {
    children.forEach((child, index) => {
      const path = [...parentPath, index] as Path
      const runtimeId =
        transactionSnapshot.previousIndex.pathToId instanceof Map
          ? transactionSnapshot.previousIndex.pathToId.get(pathKey(path))
          : transactionSnapshot.previousIndex.pathToId[pathKey(path)]

      if (runtimeId) {
        setRuntimeId(child, editor, runtimeId)
      } else {
        getOrCreateRuntimeId(child, editor)
      }

      if ('children' in child && Array.isArray(child.children)) {
        seedFromPreviousIndex(child.children, path)
      }
    })
  }

  seedFromPreviousIndex(restoredChildren)
  CHILDREN.set(editor, restoredChildren)
  setCurrentSelection(editor, transactionSnapshot.selection)
  setCurrentMarks(editor, transactionSnapshot.marks)
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

    TRANSACTION_SNAPSHOT.set(editor, {
      children: previousSnapshot?.children ?? cloneValue(getChildren(editor)),
      command: profileCoreDuration('transaction-command', () =>
        cloneValue(getCommandContext(editor))
      ),
      implicitTarget: null,
      implicitTargetResolved: false,
      marks: previousSnapshot?.marks ?? getCurrentMarks(editor),
      metadata: cloneUpdateMetadata(options.metadata),
      operations: [...getOperations(editor)],
      previousIndex,
      previousSnapshot,
      previousVersion,
      reason: null,
      selection: previousSnapshot?.selection ?? getCurrentSelection(editor),
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
      getEditorRuntime(editor).isNormalizing() &&
      !options.skipNormalize &&
      !selectionOnlyTransaction
    ) {
      getEditorTransformRegistry(editor).normalize({
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
        const previousVersion = snapshot?.previousVersion ?? getVersion(editor)
        const previousSnapshotForChange = snapshot?.previousSnapshot ?? null
        const change = profileCoreDuration('build-change', () =>
          snapshot && previousSnapshotForChange && hasListeners(editor)
            ? buildSnapshotChange({
                command: snapshot.command,
                metadata: snapshot.metadata,
                nextSnapshot: profileCoreDuration(
                  'next-snapshot',
                  () =>
                    getPathStableSnapshot(
                      editor,
                      previousSnapshotForChange,
                      operations
                    ) ?? getSnapshot(editor)
                ),
                operations,
                previousSnapshot: previousSnapshotForChange,
                reason: snapshot.reason,
                tags: [...snapshot.tags],
              })
            : getOperationDirtiness(editor, operations, {
                command: snapshot?.command,
                marksBefore: snapshot?.marks,
                previousIndex: snapshot?.previousIndex,
                previousVersion,
                reason: snapshot?.reason ?? null,
                selectionBefore: snapshot?.selection,
                metadata: snapshot?.metadata,
                tags: snapshot ? [...snapshot.tags] : [],
              })
        )

        profileCoreDuration('notify-listeners', () =>
          notifyListeners(editor, change)
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
      setChildren(editor, nextChildren)
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

export const initializePublicState = <V extends Value>(
  editor: Editor<V>,
  options: CreateEditorOptions<V> = {}
) => {
  const initialChildren = cloneValue([...(options.initialValue ?? [])])

  if (!NodeApi.isNodeList(initialChildren)) {
    throw new Error(
      '[Slate] initialValue is invalid! Expected a list of elements.'
    )
  }

  if (options.initialValue && initialChildren.length === 0) {
    throw new Error(
      '[Slate] initialValue is invalid! Expected at least one element.'
    )
  }

  CHILDREN.set(editor, initialChildren)
  seedRuntimeIds(initialChildren, editor)
  CURRENT_SELECTION.set(editor, cloneValue(options.initialSelection ?? null))
  CURRENT_MARKS.set(editor, null)
  DEFAULT_IS_NORMALIZING.set(editor, getEditorRuntime(editor).isNormalizing)
  DEFAULT_NORMALIZE_NODE.set(editor, getEditorRuntime(editor).normalizeNode)
  DEFAULT_SHOULD_NORMALIZE.set(editor, getEditorRuntime(editor).shouldNormalize)
  LISTENERS.set(editor, new Set())
  SOURCE_LISTENERS.set(editor, new Map())
  LAST_COMMIT.set(editor, null)
  setOperations(editor, [])
  MUTATION_VERSION.set(editor, 0)
  RUNTIME_INDEX_VERSION.set(editor, 0)
  RUNTIME_INDEX_CACHE.delete(editor)
  SNAPSHOT_CACHE.delete(editor)
  setVersion(editor, 0)
}
