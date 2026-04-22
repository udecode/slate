import { publishRangeRefDrafts, resetRangeRefDrafts } from '../editor/range-ref'
import type {
  Editor,
  EditorMarks,
  EditorSnapshot,
  RuntimeId,
  Selection,
  SnapshotChange,
  SnapshotIndex,
  SnapshotInput,
  SnapshotListener,
} from '../interfaces/editor'
import type { Descendant } from '../interfaces/node'
import type { Operation } from '../interfaces/operation'
import type { Path } from '../interfaces/path'
import {
  getOrCreateRuntimeId,
  seedRuntimeIds,
  seedRuntimeIdsFromIndex,
} from '../utils/runtime-ids'

type TransactionSnapshot = {
  children: Descendant[]
  marks: EditorMarks | null
  operations: Operation[]
  previousSnapshot: EditorSnapshot
  reason: 'replace' | null
  selection: Selection
}

const CHILDREN = new WeakMap<Editor, Descendant[]>()
const CURRENT_MARKS = new WeakMap<Editor, EditorMarks | null>()
const CURRENT_SELECTION = new WeakMap<Editor, Selection>()
const LISTENERS = new WeakMap<Editor, Set<SnapshotListener>>()
const PUBLIC_MARKS = new WeakMap<Editor, EditorMarks | null>()
const PUBLIC_SELECTION = new WeakMap<Editor, Selection>()
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
const TRANSACTION_DEPTH = new WeakMap<Editor, number>()
const TRANSACTION_SNAPSHOT = new WeakMap<Editor, TransactionSnapshot>()

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

const setPublicMarks = (editor: Editor, marks: EditorMarks | null) => {
  PUBLIC_MARKS.set(editor, cloneValue(marks ?? null))
}

const setPublicSelection = (editor: Editor, selection: Selection) => {
  PUBLIC_SELECTION.set(editor, cloneValue(selection ?? null))
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

const setVersion = (editor: Editor, version: number) => {
  SNAPSHOT_VERSION.set(editor, version)
  SNAPSHOT_CACHE.delete(editor)
}

const bumpMutationVersion = (editor: Editor) => {
  MUTATION_VERSION.set(editor, getMutationVersion(editor) + 1)
}

export const isInTransaction = (editor: Editor) =>
  (TRANSACTION_DEPTH.get(editor) ?? 0) > 0

export const markTransactionChanged = (editor: Editor) => {
  if (isInTransaction(editor)) {
    TRANSACTION_CHANGED.set(editor, true)
  }
}

export const getChildren = (editor: Editor): Descendant[] =>
  CHILDREN.get(editor) ??
  (Array.isArray((editor as Partial<Editor>).children)
    ? ((editor as Partial<Editor>).children as Descendant[])
    : [])

export const setChildren = (editor: Editor, children: Descendant[]) => {
  CHILDREN.set(editor, children)
  bumpMutationVersion(editor)
  SNAPSHOT_CACHE.delete(editor)
  markTransactionChanged(editor)
}

export const getCurrentMarks = (editor: Editor): EditorMarks | null =>
  cloneValue(
    CURRENT_MARKS.get(editor) ??
      ((editor as Partial<Editor>).marks as EditorMarks | null | undefined) ??
      null
  )

export const setCurrentMarks = (editor: Editor, marks: EditorMarks | null) => {
  const cloned = cloneValue(marks ?? null)
  CURRENT_MARKS.set(editor, cloned)
  bumpMutationVersion(editor)
  setPublicMarks(editor, cloned)
  SNAPSHOT_CACHE.delete(editor)
  markTransactionChanged(editor)
}

export const getCurrentSelection = (editor: Editor): Selection =>
  cloneValue(
    CURRENT_SELECTION.get(editor) ??
      ((editor as Partial<Editor>).selection as Selection | undefined) ??
      null
  )

export const setCurrentSelection = (editor: Editor, selection: Selection) => {
  const cloned = cloneValue(selection ?? null)
  CURRENT_SELECTION.set(editor, cloned)
  bumpMutationVersion(editor)
  setPublicSelection(editor, cloned)
  SNAPSHOT_CACHE.delete(editor)
  markTransactionChanged(editor)
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
  })

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

export const buildSnapshotChange = ({
  nextSnapshot,
  operations,
  previousSnapshot,
  reason,
}: {
  nextSnapshot: EditorSnapshot
  operations: Operation[]
  previousSnapshot: EditorSnapshot
  reason: 'replace' | null
}): SnapshotChange => {
  const previousChildren = JSON.stringify(previousSnapshot.children)
  const nextChildren = JSON.stringify(nextSnapshot.children)
  const previousSelection = JSON.stringify(previousSnapshot.selection)
  const nextSelection = JSON.stringify(nextSnapshot.selection)
  const previousMarks = JSON.stringify(previousSnapshot.marks)
  const nextMarks = JSON.stringify(nextSnapshot.marks)

  const classes =
    reason === 'replace'
      ? (['replace'] as const)
      : operations.length === 0 && previousMarks !== nextMarks
        ? (['mark'] as const)
        : operations.length > 0 &&
            operations.every((op) => op.type === 'set_selection')
          ? (['selection'] as const)
          : operations.length > 0 &&
              operations.every(
                (op) => op.type === 'insert_text' || op.type === 'remove_text'
              )
            ? (['text'] as const)
            : (['structural'] as const)

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

  return {
    childrenChanged: previousChildren !== nextChildren,
    classes,
    dirtyPaths,
    dirtyScope:
      classes[0] === 'replace'
        ? 'all'
        : classes[0] === 'selection' || classes[0] === 'mark'
          ? 'none'
          : 'paths',
    marksChanged: previousMarks !== nextMarks,
    operations: Object.freeze([...operations]),
    replaceEpoch: reason === 'replace' ? 1 : 0,
    selectionChanged: previousSelection !== nextSelection,
    touchedRuntimeIds:
      touchedRuntimeIds == null
        ? null
        : Object.freeze(touchedRuntimeIds.filter(Boolean) as RuntimeId[]),
  }
}

export const notifyListeners = (editor: Editor, change?: SnapshotChange) => {
  editor.onChange()

  const listeners = LISTENERS.get(editor)

  if (!listeners || listeners.size === 0) {
    return
  }

  const snapshot = getSnapshot(editor)

  for (const listener of listeners) {
    listener(snapshot, change)
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
  editor.operations = cloneValue(transactionSnapshot.operations)
}

export const withTransaction = (
  editor: Editor,
  fn: () => void,
  options: { skipNormalize?: boolean } = {}
) => {
  const depth = TRANSACTION_DEPTH.get(editor) ?? 0
  const isOuter = depth === 0

  if (isOuter) {
    TRANSACTION_SNAPSHOT.set(editor, {
      children: cloneValue(getChildren(editor)),
      marks: cloneValue(getCurrentMarks(editor)),
      operations: cloneValue(editor.operations),
      previousSnapshot: getSnapshot(editor),
      reason: null,
      selection: cloneValue(getCurrentSelection(editor)),
    })
    TRANSACTION_CHANGED.set(editor, false)
  }

  TRANSACTION_DEPTH.set(editor, depth + 1)

  try {
    fn()

    if (
      isOuter &&
      (TRANSACTION_CHANGED.get(editor) ?? false) &&
      editor.isNormalizing() &&
      !options.skipNormalize
    ) {
      editor.normalize({
        explicit: false,
        force: editor.operations.length === 0,
        operation: editor.operations.at(-1),
      })
    }
  } catch (error) {
    if (isOuter) {
      const snapshot = TRANSACTION_SNAPSHOT.get(editor)

      if (snapshot) {
        restoreTransactionSnapshot(editor, snapshot)
      }
      resetRangeRefDrafts(editor)
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
      TRANSACTION_SNAPSHOT.delete(editor)
      TRANSACTION_CHANGED.delete(editor)

      if (changed) {
        publishRangeRefDrafts(editor)
        setVersion(editor, getVersion(editor) + 1)
        notifyListeners(
          editor,
          snapshot
            ? buildSnapshotChange({
                nextSnapshot: getSnapshot(editor),
                operations: editor.operations,
                previousSnapshot: snapshot.previousSnapshot,
                reason: snapshot.reason,
              })
            : undefined
        )
      }
    }
  }
}

export const replaceSnapshot = (editor: Editor, input: SnapshotInput) => {
  withTransaction(editor, () => {
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
  })
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
  const initialChildren = Array.isArray((editor as Editor).children)
    ? (editor as Editor).children
    : []

  CHILDREN.set(editor, initialChildren)
  seedRuntimeIds(initialChildren, editor)
  CURRENT_SELECTION.set(editor, cloneValue(editor.selection ?? null))
  CURRENT_MARKS.set(editor, cloneValue(editor.marks ?? null))
  DEFAULT_IS_NORMALIZING.set(editor, editor.isNormalizing)
  DEFAULT_NORMALIZE_NODE.set(editor, editor.normalizeNode)
  DEFAULT_SHOULD_NORMALIZE.set(editor, editor.shouldNormalize)
  LISTENERS.set(editor, new Set())
  MUTATION_VERSION.set(editor, 0)
  setPublicSelection(editor, editor.selection ?? null)
  setPublicMarks(editor, editor.marks ?? null)
  SNAPSHOT_CACHE.delete(editor)
  setVersion(editor, 0)

  Object.defineProperty(editor, 'children', {
    configurable: true,
    enumerable: true,
    get() {
      return editor.getChildren()
    },
    set(children: Descendant[]) {
      editor.setChildren(children)
    },
  })

  Object.defineProperty(editor, 'selection', {
    configurable: true,
    enumerable: true,
    get() {
      return PUBLIC_SELECTION.get(editor) ?? null
    },
    set(selection: Selection) {
      setPublicSelection(editor, selection)
    },
  })

  Object.defineProperty(editor, 'marks', {
    configurable: true,
    enumerable: true,
    get() {
      return PUBLIC_MARKS.get(editor) ?? null
    },
    set(marks: EditorMarks | null) {
      setPublicMarks(editor, marks)
    },
  })
}
