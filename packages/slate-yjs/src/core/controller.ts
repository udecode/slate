import type {
  Descendant,
  Editor,
  EditorCommit,
  EditorSnapshot,
  Operation,
  Path,
  Range,
} from 'slate'
import { NodeApi } from 'slate'
import * as Y from 'yjs'

import {
  createYjsAwarenessSelection,
  readYjsAwarenessSelection,
  yjsAwarenessSelectionsEqual,
} from './awareness'
import {
  getYjsChildren,
  getYjsLength,
  getYjsNode,
  getYjsParent,
  getYjsTextContent,
  readSlateValueFromYjs,
  replaceYjsChildren,
} from './document'
import { applySlateOperationToYjs } from './operations'
import type {
  YjsAwarenessChange,
  YjsAwarenessLike,
  YjsExtensionOptions,
  YjsRemoteCursor,
  YjsState,
  YjsTraceEntry,
  YjsTx,
} from './types'
import {
  createYjsUndoManagerAdapter,
  type YjsUndoManagerStackItem,
} from './undo-manager-adapter'

type SplitHistory = {
  elementPath: Path
  elementPosition: number
  elementProperties: Record<string, unknown>
  rightText: string
  textPath: Path
  textProperties: Record<string, unknown>
}

const SPLIT_HISTORY_META = 'slate-yjs:split-history'

const remoteImportOptions = {
  metadata: {
    collab: { origin: 'remote', saveToHistory: false },
    history: { mode: 'skip' },
    selection: { dom: 'preserve', focus: false, scroll: false },
  },
  tag: ['collaboration', 'remote-yjs-import'],
} as const

export class YjsController {
  private readonly autoSendSelection: boolean
  private readonly awareness?: YjsAwarenessLike
  private readonly awarenessDataField: string
  private readonly awarenessObserver: (event: YjsAwarenessChange) => void
  private readonly awarenessSelectionField: string
  private readonly awarenessSubscribers = new Set<() => void>()
  private readonly clientId: number | string
  private readonly doc: Y.Doc
  private readonly editor: Editor
  private readonly historyOrigin = {}
  private readonly localOrigin = {}
  private readonly observer: (
    events: Y.YEvent<Y.XmlElement>[],
    transaction: Y.Transaction
  ) => void
  private readonly root: Y.XmlElement
  private readonly traceEntries: YjsTraceEntry[] = []
  private readonly undoManager: Y.UndoManager
  private readonly undoManagerAdapter: ReturnType<
    typeof createYjsUndoManagerAdapter
  >

  private awarenessRevision = 0
  private connected = true
  private importing = false
  private paused = false

  constructor(editor: Editor, options: YjsExtensionOptions) {
    this.editor = editor
    this.doc = options.doc ?? new Y.Doc()
    this.root = this.doc.get(options.rootName ?? 'slate', Y.XmlElement)
    this.clientId = options.clientId ?? this.doc.clientID
    this.awareness = options.awareness
    this.awarenessDataField = options.awarenessDataField ?? 'data'
    this.awarenessSelectionField =
      options.awarenessSelectionField ?? 'selection'
    this.autoSendSelection = options.autoSendSelection ?? true
    this.awarenessObserver = () => {
      this.updateAwarenessRevision()
    }
    this.undoManager = new Y.UndoManager(this.root, {
      trackedOrigins: new Set([this.localOrigin]),
    })
    this.undoManagerAdapter = createYjsUndoManagerAdapter(this.undoManager)
    this.observer = (_events, transaction) => {
      if (transaction.origin === this.localOrigin || this.paused) {
        return
      }

      this.importFromYjs()
    }

    this.awareness?.on?.('change', this.awarenessObserver)
  }

  destroy() {
    this.awareness?.off?.('change', this.awarenessObserver)
    this.root.unobserveDeep(this.observer)
    this.undoManager.destroy()
  }

  handleCommit(commit: EditorCommit, snapshot: EditorSnapshot) {
    if (this.importing || this.paused || !commit.snapshotChanged) {
      return
    }
    if (
      commit.tags.includes('skip-collab') ||
      commit.tags.includes('collaboration') ||
      commit.metadata.collab?.origin === 'remote'
    ) {
      return
    }

    const shouldSendSelection =
      this.autoSendSelection &&
      commit.operations.some((operation) => operation.type === 'set_selection')

    if (!commit.snapshotChanged) {
      if (shouldSendSelection) {
        this.sendSelection(snapshot.selection)
      }

      return
    }

    const operations = commit.operations.filter(
      (operation) => operation.type !== 'set_selection'
    )

    if (operations.length === 0) {
      if (shouldSendSelection) {
        this.sendSelection(snapshot.selection)
      }

      return
    }

    const splitHistory = this.createSplitHistory(operations)

    this.undoManager.stopCapturing()
    this.doc.transact(() => {
      for (const operation of operations) {
        this.applyOperation(operation)
      }
    }, this.localOrigin)
    this.storeSplitHistory(splitHistory)
    this.undoManager.stopCapturing()

    if (shouldSendSelection) {
      this.sendSelection(snapshot.selection)
    }
  }

  seed() {
    if (this.root.length === 0) {
      const children = this.editor.read((state) => [
        ...state.value.get().roots.main,
      ]) as Descendant[]

      this.doc.transact(() => {
        replaceYjsChildren(this.root, children)
      }, {})
      this.traceEntries.push({ mode: 'seed' })
    } else {
      this.importFromYjs('seed')
    }

    this.root.observeDeep(this.observer)
  }

  state(): YjsState {
    return {
      awarenessRevision: () => this.awarenessRevision,
      clientId: () => this.clientId,
      connected: () => this.connected,
      doc: () => this.doc,
      paused: () => this.paused,
      remoteCursor: (clientId) => this.remoteCursor(clientId),
      remoteCursors: () => this.remoteCursors(),
      root: () => this.root,
      subscribeAwareness: (listener) => this.subscribeAwareness(listener),
      trace: () => [...this.traceEntries],
    }
  }

  tx(): YjsTx {
    return {
      clearSelection: () => {
        this.clearSelection()
      },
      clearTrace: () => {
        this.traceEntries.length = 0
      },
      connect: () => {
        this.connected = true
        this.updateAwarenessRevision()
      },
      disconnect: () => {
        this.connected = false
        this.updateAwarenessRevision()
      },
      pause: () => {
        this.paused = true
      },
      reconcile: () => {
        this.importFromYjs()
      },
      redo: () => {
        if (!this.redoSplit()) {
          this.undoManager.redo()
        }
      },
      resume: () => {
        this.paused = false
      },
      sendCursorData: (data) => {
        this.sendCursorData(data)
      },
      sendSelection: (range, data) => {
        this.sendSelection(range, data)
      },
      undo: () => {
        if (!this.undoSplit()) {
          this.undoManager.undo()
        }
      },
    }
  }

  private subscribeAwareness(listener: () => void) {
    this.awarenessSubscribers.add(listener)

    return () => {
      this.awarenessSubscribers.delete(listener)
    }
  }

  private updateAwarenessRevision() {
    this.awarenessRevision += 1

    for (const listener of this.awarenessSubscribers) {
      listener()
    }
  }

  private clearSelection() {
    if (!this.awareness) {
      return
    }

    if (
      this.awareness.getLocalState()?.[this.awarenessSelectionField] !== null
    ) {
      this.awareness.setLocalStateField(this.awarenessSelectionField, null)
    }
  }

  private currentSelection(): Range | null {
    return this.editor.read((state) => state.selection.get()) as Range | null
  }

  private getLocalAwarenessClientId() {
    return (
      this.awareness?.doc?.clientID ??
      this.awareness?.clientID ??
      (typeof this.clientId === 'number' ? this.clientId : this.doc.clientID)
    )
  }

  private remoteCursor<
    TCursorData extends Record<string, unknown> = Record<string, unknown>,
  >(clientId: number): YjsRemoteCursor<TCursorData> | null {
    if (
      !this.awareness ||
      !this.connected ||
      clientId === this.getLocalAwarenessClientId()
    ) {
      return null
    }

    const state = this.awareness.getStates().get(clientId)

    if (!state) {
      return null
    }

    const cursor: YjsRemoteCursor<TCursorData> = {
      clientId,
      selection: readYjsAwarenessSelection(
        this.root,
        state[this.awarenessSelectionField]
      ),
    }
    const data = state[this.awarenessDataField]

    if (data !== undefined) {
      cursor.data = data as TCursorData
    }

    return cursor
  }

  private remoteCursors<
    TCursorData extends Record<string, unknown> = Record<string, unknown>,
  >(): YjsRemoteCursor<TCursorData>[] {
    if (!this.awareness || !this.connected) {
      return []
    }

    return [...this.awareness.getStates().keys()]
      .sort((a, b) => a - b)
      .flatMap((clientId) => {
        const cursor = this.remoteCursor<TCursorData>(clientId)

        return cursor ? [cursor] : []
      })
  }

  private sendCursorData(data: Record<string, unknown> | null) {
    this.awareness?.setLocalStateField(this.awarenessDataField, data)
  }

  private sendSelection(
    range: Range | null | undefined = this.currentSelection(),
    data?: Record<string, unknown> | null
  ) {
    if (!this.awareness) {
      return
    }

    if (data !== undefined) {
      this.sendCursorData(data)
    }

    const nextSelection = range
      ? createYjsAwarenessSelection(this.root, range)
      : null
    const currentSelection =
      this.awareness.getLocalState()?.[this.awarenessSelectionField]

    if (!yjsAwarenessSelectionsEqual(currentSelection, nextSelection)) {
      this.awareness.setLocalStateField(
        this.awarenessSelectionField,
        nextSelection
      )
    }
  }

  private applyOperation(operation: Operation) {
    const trace = applySlateOperationToYjs(this.root, operation)

    if (!trace) {
      return
    }

    this.traceEntries.push(trace)

    if (trace.mode === 'unsupported') {
      throw new Error(`Unsupported Yjs operation: ${operation.type}`)
    }
  }

  private createSplitHistory(
    operations: readonly Operation[]
  ): SplitHistory | null {
    const textSplit = operations.find(
      (operation): operation is Extract<Operation, { type: 'split_node' }> => {
        if (operation.type !== 'split_node') {
          return false
        }

        try {
          return getYjsNode(this.root, operation.path) instanceof Y.XmlText
        } catch {
          return false
        }
      }
    )

    if (!textSplit) {
      return null
    }

    const elementPath = textSplit.path.slice(0, -1)
    const elementSplit = operations.find(
      (operation): operation is Extract<Operation, { type: 'split_node' }> =>
        operation.type === 'split_node' &&
        pathsEqual(operation.path, elementPath)
    )

    if (!elementSplit) {
      return null
    }

    const text = getYjsNode(this.root, textSplit.path)

    if (!(text instanceof Y.XmlText)) {
      return null
    }

    return {
      elementPath,
      elementPosition: elementSplit.position,
      elementProperties: elementSplit.properties as Record<string, unknown>,
      rightText: getYjsTextContent(text).slice(textSplit.position),
      textPath: textSplit.path,
      textProperties: textSplit.properties as Record<string, unknown>,
    }
  }

  private peekSplit(item: YjsUndoManagerStackItem | null): {
    item: YjsUndoManagerStackItem
    splitHistory: SplitHistory
  } | null {
    const splitHistory = item?.meta.get(SPLIT_HISTORY_META)

    if (!item || !isSplitHistory(splitHistory)) {
      return null
    }

    return { item, splitHistory }
  }

  private redoSplit() {
    const redo = this.peekSplit(this.undoManagerAdapter.peekRedo())

    if (!redo) {
      return false
    }

    this.doc.transact(() => {
      const text = getYjsNode(this.root, redo.splitHistory.textPath)

      if (!(text instanceof Y.XmlText)) {
        throw new Error('Cannot redo split_node because the text node is gone.')
      }

      const textValue = getYjsTextContent(text)

      if (!textValue.endsWith(redo.splitHistory.rightText)) {
        throw new Error(
          'Cannot redo split_node because the right text is no longer at the split boundary.'
        )
      }

      const textPosition = textValue.length - redo.splitHistory.rightText.length

      applySlateOperationToYjs(this.root, {
        path: redo.splitHistory.textPath,
        position: textPosition,
        properties: redo.splitHistory.textProperties,
        type: 'split_node',
      } as Operation)
      applySlateOperationToYjs(this.root, {
        path: redo.splitHistory.elementPath,
        position: redo.splitHistory.elementPosition,
        properties: redo.splitHistory.elementProperties,
        type: 'split_node',
      } as Operation)
    }, this.historyOrigin)

    this.undoManagerAdapter.moveRedoToUndo(redo.item)

    return true
  }

  private storeSplitHistory(splitHistory: SplitHistory | null) {
    if (!splitHistory) {
      return
    }

    this.undoManagerAdapter.storeUndoMeta(SPLIT_HISTORY_META, splitHistory)
  }

  private undoSplit() {
    const undo = this.peekSplit(this.undoManagerAdapter.peekUndo())

    if (!undo) {
      return false
    }

    let rightText = undo.splitHistory.rightText

    this.doc.transact(() => {
      const leftText = getYjsNode(this.root, undo.splitHistory.textPath)
      const rightElementPath = nextPath(undo.splitHistory.elementPath)
      const rightElement = getYjsNode(this.root, rightElementPath)
      const { index, parent } = getYjsParent(this.root, rightElementPath)

      if (!(leftText instanceof Y.XmlText)) {
        throw new Error('Cannot undo split_node because the left text is gone.')
      }
      if (!(rightElement instanceof Y.XmlElement)) {
        throw new Error(
          'Cannot undo split_node because the right element is gone.'
        )
      }

      rightText = appendElementText(leftText, rightElement)
      parent.delete(index, 1)
    }, this.historyOrigin)

    undo.splitHistory.rightText = rightText
    this.undoManagerAdapter.moveUndoToRedo(undo.item)

    return true
  }

  private importFromYjs(mode: YjsTraceEntry['mode'] = 'remote-reconcile') {
    const children = readSlateValueFromYjs(this.root)
    const selection = this.sanitizeImportSelection(
      children,
      this.editor.read((state) => state.selection.get()) as Range | null
    )

    this.traceEntries.push({ mode })
    this.importing = true

    try {
      this.editor.update((tx) => {
        tx.value.replace({
          children,
          marks: null,
          selection,
        })
      }, remoteImportOptions)
    } finally {
      this.importing = false
    }
  }

  private sanitizeImportSelection(
    children: Descendant[],
    selection: Range | null
  ) {
    if (!selection) {
      return null
    }

    const root = { children } as Parameters<typeof NodeApi.getIf>[0]

    for (const point of [selection.anchor, selection.focus]) {
      const node = NodeApi.getIf(root, point.path)

      if (
        !node ||
        !NodeApi.isText(node) ||
        point.offset < 0 ||
        point.offset > node.text.length
      ) {
        return null
      }
    }

    return selection
  }
}

const appendElementText = (target: Y.XmlText, element: Y.XmlElement) => {
  const children = getYjsChildren(element)

  if (children.length !== 1 || !(children[0] instanceof Y.XmlText)) {
    throw new Error(
      'Cannot undo split_node with a non-text right-side element yet.'
    )
  }

  let offset = getYjsLength(target)
  let insertedText = ''

  for (const delta of children[0].toDelta()) {
    if (typeof delta.insert !== 'string' || delta.insert.length === 0) {
      continue
    }

    target.insert(offset, delta.insert, delta.attributes)
    offset += delta.insert.length
    insertedText += delta.insert
  }

  return insertedText
}

const isSplitHistory = (value: unknown): value is SplitHistory =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as SplitHistory).elementPath) &&
  Array.isArray((value as SplitHistory).textPath) &&
  typeof (value as SplitHistory).rightText === 'string' &&
  typeof (value as SplitHistory).elementPosition === 'number'

const nextPath = (path: Path) => {
  const index = path.at(-1)

  if (index === undefined) {
    throw new Error('Cannot get a next path for the root.')
  }

  return [...path.slice(0, -1), index + 1]
}

const pathsEqual = (a: Path, b: Path) =>
  a.length === b.length && a.every((part, index) => part === b[index])
