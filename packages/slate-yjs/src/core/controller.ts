import type {
  Descendant,
  Editor,
  EditorCommit,
  EditorSnapshot,
  Element,
  Operation,
  Range,
} from 'slate'
import { createEditor, NodeApi, OperationApi } from 'slate'
import { Editor as EditorApi } from 'slate/internal'
import * as Y from 'yjs'

import {
  createYjsAwarenessSelection,
  readYjsAwarenessSelection,
  yjsAwarenessSelectionsEqual,
} from './awareness'
import {
  getYjsLength,
  getYjsNode,
  getYjsParent,
  getYjsTextContent,
  readSlateValueFromYjs,
  removeRedundantEmptyYjsTextNodes,
  removeYjsChild,
  replaceYjsChildren,
  SPLIT_UNDO_TEXT_ATTRIBUTE,
} from './document'
import {
  removeRejectedYjsOperationsFromHistory,
  removeRejectedYjsOperationsFromHistoryAfterCommit,
} from './history'
import {
  applySlateOperationToYjs,
  isNoopSlateOperationForYjs,
} from './operations'
import {
  connectedFromYjsProviderStatus,
  isPromiseLike,
  normalizeYjsProviderStatus,
  normalizeYjsProviderSynced,
  readYjsProviderStatus,
  readYjsProviderSynced,
} from './provider'
import {
  appendElementText,
  clearSplitUndoTextAttribute,
  findSplitUndoTextRepairs,
  getTrailingSplitUndoText,
  getVisibleText,
  getYjsNodeIf,
  isSplitHistory,
  nextPath,
  type PendingTextSplitHistory,
  pathsEqual,
  SPLIT_HISTORY_META,
  type SplitHistory,
} from './split-history'
import type {
  YjsAwarenessChange,
  YjsAwarenessLike,
  YjsExtensionOptions,
  YjsProviderLike,
  YjsProviderStatus,
  YjsRemoteCursor,
  YjsState,
  YjsTraceEntry,
  YjsTx,
} from './types'
import {
  createYjsUndoManagerAdapter,
  type YjsUndoManagerStackItem,
} from './undo-manager-adapter'

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
  private readonly destroyProviderOnUnmount: boolean
  private readonly doc: Y.Doc
  private readonly editor: Editor
  private readonly canonicalizeOrigin = {}
  private readonly historyOrigin = {}
  private readonly localOrigin = {}
  private readonly seedOrigin = {}
  private readonly observer: (
    events: Y.YEvent<Y.XmlElement>[],
    transaction: Y.Transaction
  ) => void
  private readonly provider?: YjsProviderLike
  private readonly providerOwnedDoc: boolean
  private readonly providerStatusObserver: (status: unknown) => void
  private readonly providerSubscribers = new Set<() => void>()
  private readonly providerSyncedObserver: (synced: unknown) => void
  private readonly root: Y.XmlElement
  private readonly seedProviderOnSync: boolean
  private readonly traceEntries: YjsTraceEntry[] = []
  private readonly undoManager: Y.UndoManager
  private readonly undoManagerAdapter: ReturnType<
    typeof createYjsUndoManagerAdapter
  >

  private awarenessRevision = 0
  private connected = true
  private importing = false
  private paused = false
  private pendingTextSplitHistory: PendingTextSplitHistory | null = null
  private providerRevision = 0
  private providerStatusValue: YjsProviderStatus | null
  private providerSyncedValue: boolean | null

  constructor(editor: Editor, options: YjsExtensionOptions) {
    this.editor = editor
    this.provider = options.provider
    this.providerOwnedDoc =
      !!this.provider && (!!options.doc || !!this.provider.doc)
    this.doc = options.doc ?? this.provider?.doc ?? new Y.Doc()
    this.root = this.doc.get(options.rootName ?? 'slate', Y.XmlElement)
    this.clientId = options.clientId ?? this.doc.clientID
    this.destroyProviderOnUnmount = options.destroyProviderOnUnmount ?? false
    this.seedProviderOnSync = options.seedProviderOnSync ?? true
    this.awareness = options.awareness ?? this.provider?.awareness
    this.awarenessDataField = options.awarenessDataField ?? 'data'
    this.awarenessSelectionField =
      options.awarenessSelectionField ?? 'selection'
    this.autoSendSelection = options.autoSendSelection ?? true
    this.providerStatusValue = readYjsProviderStatus(this.provider)
    this.providerSyncedValue = readYjsProviderSynced(this.provider)
    this.connected = connectedFromYjsProviderStatus(
      this.providerStatusValue,
      this.connected
    )
    this.awarenessObserver = () => {
      this.updateAwarenessRevision()
    }
    this.providerStatusObserver = (payload) => {
      const status = normalizeYjsProviderStatus(payload)

      if (status) {
        this.updateProviderStatus(status)
      }
    }
    this.providerSyncedObserver = (payload) => {
      const synced =
        normalizeYjsProviderSynced(payload) ??
        readYjsProviderSynced(this.provider)

      if (synced !== null) {
        this.updateProviderSynced(synced)
      }
    }
    this.undoManager = new Y.UndoManager(this.root, {
      trackedOrigins: new Set([this.localOrigin]),
    })
    this.undoManagerAdapter = createYjsUndoManagerAdapter(this.undoManager)
    this.observer = (_events, transaction) => {
      if (
        transaction.origin === this.localOrigin ||
        transaction.origin === this.canonicalizeOrigin ||
        transaction.origin === this.seedOrigin ||
        this.paused
      ) {
        return
      }

      if (transaction.origin === this.historyOrigin) {
        this.importFromYjs('remote-reconcile', {
          repairRemoteSplitAfterOfflineUndo: false,
        })

        return
      }

      this.importFromYjs()
    }

    this.awareness?.on?.('change', this.awarenessObserver)
    this.provider?.on?.('status', this.providerStatusObserver)
    this.provider?.on?.('sync', this.providerSyncedObserver)
    this.provider?.on?.('synced', this.providerSyncedObserver)
  }

  destroy() {
    this.awareness?.off?.('change', this.awarenessObserver)
    this.provider?.off?.('status', this.providerStatusObserver)
    this.provider?.off?.('sync', this.providerSyncedObserver)
    this.provider?.off?.('synced', this.providerSyncedObserver)
    if (this.provider) {
      this.clearSelection()
    }
    if (this.destroyProviderOnUnmount) {
      this.provider?.destroy?.()
    }
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
      (operation) =>
        operation.type !== 'set_selection' &&
        !isNoopSlateOperationForYjs(operation)
    )

    if (operations.length === 0) {
      if (shouldSendSelection) {
        this.sendSelection(snapshot.selection)
      }

      return
    }

    if (this.shouldRejectUnsafeProviderCommit()) {
      removeRejectedYjsOperationsFromHistory(this.editor, operations)
      this.replaceEditorValue(
        this.readChildrenBeforeOperations(operations),
        commit.selectionBefore as Range | null
      )
      removeRejectedYjsOperationsFromHistory(this.editor, operations)
      removeRejectedYjsOperationsFromHistoryAfterCommit(this.editor, operations)

      return
    }
    if (this.shouldSeedEmptyProviderDocForCommit()) {
      this.seedValue(this.readChildrenBeforeOperations(operations))
    }

    const splitHistory = this.createSplitHistory(operations)
    const rejectedLocalOperations: Operation[] = []

    this.undoManager.stopCapturing()
    this.doc.transact(() => {
      for (const operation of operations) {
        const trace = this.applyOperation(operation)

        if (this.shouldImportAfterLocalFallback(trace)) {
          rejectedLocalOperations.push(operation)
        }
      }
    }, this.localOrigin)
    this.storeSplitHistory(splitHistory)
    this.undoManager.stopCapturing()

    if (rejectedLocalOperations.length > 0) {
      this.replaceEditorValue(
        readSlateValueFromYjs(this.root),
        snapshot.selection
      )
      removeRejectedYjsOperationsFromHistory(
        this.editor,
        rejectedLocalOperations
      )
      removeRejectedYjsOperationsFromHistoryAfterCommit(
        this.editor,
        rejectedLocalOperations
      )
    }

    if (shouldSendSelection) {
      this.sendSelection(snapshot.selection)
    }
  }

  seed() {
    if (this.root.length === 0) {
      if (this.shouldSeedInitialProviderDoc()) {
        this.seedInitialValue()
      }
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
      providerRevision: () => this.providerRevision,
      providerStatus: () => this.providerStatusValue,
      providerSynced: () => this.providerSyncedValue,
      remoteCursor: (clientId) => this.remoteCursor(clientId),
      remoteCursors: () => this.remoteCursors(),
      root: () => this.root,
      subscribeAwareness: (listener) => this.subscribeAwareness(listener),
      subscribeProvider: (listener) => this.subscribeProvider(listener),
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
        this.connect()
      },
      disconnect: () => {
        this.disconnect()
      },
      pause: () => {
        this.paused = true
      },
      reconcile: () => {
        this.reconcile()
      },
      reconnect: () => {
        this.reconnect()
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

  private subscribeProvider(listener: () => void) {
    this.providerSubscribers.add(listener)

    return () => {
      this.providerSubscribers.delete(listener)
    }
  }

  private updateAwarenessRevision() {
    this.awarenessRevision += 1

    for (const listener of this.awarenessSubscribers) {
      listener()
    }
  }

  private updateProviderRevision() {
    this.providerRevision += 1

    for (const listener of this.providerSubscribers) {
      listener()
    }
  }

  private updateProviderStatus(status: YjsProviderStatus) {
    this.updateConnectedFromProviderStatus(status)

    if (this.providerStatusValue === status) {
      return
    }

    this.providerStatusValue = status
    this.updateProviderRevision()
  }

  private updateConnectedFromProviderStatus(status: YjsProviderStatus) {
    const connected = connectedFromYjsProviderStatus(status, this.connected)

    this.setConnected(connected)
  }

  private syncProviderLifecycleStatus(fallbackConnected: boolean) {
    const status = readYjsProviderStatus(this.provider)

    if (status) {
      if (!fallbackConnected && status === 'connected') {
        return
      }

      this.updateProviderStatus(status)

      return
    }

    if (this.providerStatusValue === null) {
      this.setConnected(fallbackConnected)
    }
  }

  private setConnected(connected: boolean) {
    if (this.connected === connected) {
      return
    }

    this.connected = connected
    this.updateAwarenessRevision()
  }

  private updateProviderSynced(synced: boolean) {
    if (this.providerSyncedValue === synced) {
      return
    }

    this.providerSyncedValue = synced
    this.reconcileProviderOwnedDocAfterSync()
    this.updateProviderRevision()
  }

  private connect() {
    if (this.provider) {
      const result = this.provider.connect?.()

      if (isPromiseLike(result)) {
        void result.then(
          () => {
            this.syncProviderLifecycleStatus(true)
          },
          () => undefined
        )
      } else {
        this.syncProviderLifecycleStatus(true)
      }

      return result
    }

    this.setConnected(true)
  }

  private disconnect() {
    if (this.provider) {
      this.setConnected(false)
      const result = this.provider.disconnect?.()

      if (isPromiseLike(result)) {
        void result.then(
          () => {
            this.syncProviderLifecycleStatus(false)
          },
          () => undefined
        )
      } else {
        this.syncProviderLifecycleStatus(false)
      }

      return result
    }

    this.setConnected(false)
  }

  private reconnect() {
    const result = this.disconnect()

    if (isPromiseLike(result)) {
      void result.then(
        () => {
          this.connect()
        },
        () => undefined
      )

      return
    }

    this.connect()
  }

  private reconcile() {
    if (this.providerOwnedDoc && this.root.length === 0) {
      this.reconcileProviderOwnedDocAfterSync()

      return
    }

    this.importFromYjs()
  }

  private shouldDeferProviderSeed() {
    return (
      this.providerOwnedDoc &&
      this.providerSyncedValue !== true &&
      this.root.length === 0
    )
  }

  private shouldSeedEmptyProviderDocForCommit() {
    return (
      this.providerOwnedDoc &&
      this.seedProviderOnSync &&
      this.providerSyncedValue === true &&
      this.root.length === 0
    )
  }

  private shouldSeedInitialProviderDoc() {
    return (
      (!this.providerOwnedDoc || this.seedProviderOnSync) &&
      !this.shouldDeferProviderSeed()
    )
  }

  private shouldRejectUnsafeProviderCommit() {
    return (
      this.providerOwnedDoc &&
      this.root.length === 0 &&
      (!this.seedProviderOnSync || this.providerSyncedValue !== true)
    )
  }

  private shouldWaitForAppSeededProviderDoc() {
    return this.providerOwnedDoc && this.root.length === 0
  }

  private readEditorChildren() {
    return this.editor.read((state) => [
      ...state.value.get().roots.main,
    ]) as Element[]
  }

  private readChildrenBeforeOperations(operations: readonly Operation[]) {
    const baselineEditor = createEditor()

    EditorApi.replace(baselineEditor, {
      children: this.readEditorChildren(),
      marks: null,
      selection: null,
    })
    baselineEditor.update((tx) => {
      tx.operations.replay([...operations].reverse().map(OperationApi.inverse))
    })

    return EditorApi.getSnapshot(baselineEditor).children as Element[]
  }

  private seedInitialValue() {
    this.seedValue(this.readEditorChildren())
  }

  private seedValue(children: Descendant[]) {
    this.doc.transact(() => {
      replaceYjsChildren(this.root, children)
    }, this.seedOrigin)
    this.traceEntries.push({ mode: 'seed' })
  }

  private reconcileProviderOwnedDocAfterSync() {
    if (!this.providerOwnedDoc || this.providerSyncedValue !== true) {
      return
    }

    if (this.root.length === 0) {
      if (this.seedProviderOnSync) {
        this.seedInitialValue()
      }
    } else {
      this.importFromYjs('seed')
    }
  }

  private clearSelection() {
    if (!this.awareness) {
      return
    }

    const localState = this.awareness.getLocalState()

    if (
      localState &&
      this.awarenessSelectionField in localState &&
      localState[this.awarenessSelectionField] !== null
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
    if (
      this.shouldDeferProviderSeed() ||
      this.shouldWaitForAppSeededProviderDoc()
    ) {
      return
    }

    if (data !== undefined) {
      this.sendCursorData(data)
    }

    const nextRange = range ? this.sanitizeYjsSelection(range) : null
    const nextSelection = nextRange
      ? createYjsAwarenessSelection(this.root, nextRange)
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

  private sanitizeYjsSelection(range: Range): Range | null {
    for (const point of [range.anchor, range.focus]) {
      const node = getYjsNodeIf(this.root, point.path)

      if (
        !(node instanceof Y.XmlText) ||
        point.offset < 0 ||
        point.offset > getYjsLength(node)
      ) {
        return null
      }
    }

    return range
  }

  private applyOperation(operation: Operation) {
    const trace = applySlateOperationToYjs(this.root, operation)

    if (!trace) {
      return null
    }

    this.traceEntries.push(trace)

    if (trace.mode === 'unsupported') {
      throw new Error(`Unsupported Yjs operation: ${operation.type}`)
    }

    return trace
  }

  private shouldImportAfterLocalFallback(trace: YjsTraceEntry | null) {
    return (
      trace?.mode === 'traceable-fallback' &&
      trace.fallback === 'incompatible-structural-merge-elided'
    )
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

    const elementSplit = operations.find(
      (operation): operation is Extract<Operation, { type: 'split_node' }> =>
        operation.type === 'split_node' &&
        !(
          operation.path.length > 0 &&
          getYjsNodeIf(this.root, operation.path) instanceof Y.XmlText
        )
    )

    if (!textSplit) {
      const pendingTextSplitHistory = this.pendingTextSplitHistory

      this.pendingTextSplitHistory = null

      if (
        elementSplit &&
        pendingTextSplitHistory &&
        pathsEqual(elementSplit.path, pendingTextSplitHistory.elementPath)
      ) {
        return {
          ...pendingTextSplitHistory,
          elementPosition: elementSplit.position,
          elementProperties: elementSplit.properties as Record<string, unknown>,
        }
      }

      return null
    }

    const elementPath = textSplit.path.slice(0, -1)
    const text = getYjsNode(this.root, textSplit.path)

    if (!(text instanceof Y.XmlText)) {
      return null
    }

    const pendingTextSplitHistory: PendingTextSplitHistory = {
      elementPath,
      rightText: getYjsTextContent(text).slice(textSplit.position),
      textPath: textSplit.path,
      textProperties: textSplit.properties as Record<string, unknown>,
    }

    if (!elementSplit || !pathsEqual(elementSplit.path, elementPath)) {
      this.pendingTextSplitHistory = pendingTextSplitHistory

      return null
    }

    this.pendingTextSplitHistory = null

    return {
      ...pendingTextSplitHistory,
      elementPosition: elementSplit.position,
      elementProperties: elementSplit.properties as Record<string, unknown>,
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

    // Later redo items may still target the original right-side Yjs node.
    // Let Yjs replay those split items natively so their identities survive.
    if (!redo || this.undoManagerAdapter.redoDepth() > 1) {
      return false
    }

    if (redo.splitHistory.absorbedRemoteSplit) {
      this.undoManagerAdapter.moveRedoToUndo(redo.item)

      return true
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

  private replaceEditorValue(children: Descendant[], selection: Range | null) {
    const nextSelection = this.sanitizeImportSelection(children, selection)

    this.importing = true

    try {
      this.editor.update((tx) => {
        tx.value.replace({
          children,
          marks: null,
          selection: nextSelection,
        })
      }, remoteImportOptions)
    } finally {
      this.importing = false
    }
  }

  private undoSplit() {
    const undo = this.peekSplit(this.undoManagerAdapter.peekUndo())

    // If another local edit was undone first, it can depend on the split-created
    // right-side node. Native Yjs undo keeps that node redoable.
    if (!undo || this.undoManagerAdapter.redoDepth() > 0) {
      return false
    }

    if (undo.splitHistory.absorbedRemoteSplit) {
      this.undoManagerAdapter.moveUndoToRedo(undo.item)

      return true
    }

    const undoneWhileDisconnected = !this.connected
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

      rightText = appendElementText(this.root, leftText, rightElement, {
        [SPLIT_UNDO_TEXT_ATTRIBUTE]: undoneWhileDisconnected,
      })
      removeYjsChild(this.root, parent, index)
    }, this.historyOrigin)

    undo.splitHistory.rightText = rightText
    undo.splitHistory.undoneWhileDisconnected = undoneWhileDisconnected
    this.undoManagerAdapter.moveUndoToRedo(undo.item)

    return true
  }

  private importFromYjs(
    mode: YjsTraceEntry['mode'] = 'remote-reconcile',
    options: { repairRemoteSplitAfterOfflineUndo?: boolean } = {}
  ) {
    if (options.repairRemoteSplitAfterOfflineUndo ?? true) {
      this.repairRemoteSplitAfterOfflineUndo()
    }

    this.doc.transact(() => {
      removeRedundantEmptyYjsTextNodes(this.root)
    }, this.canonicalizeOrigin)

    const children = readSlateValueFromYjs(this.root)

    this.traceEntries.push({ mode })
    this.replaceEditorValue(
      children,
      this.editor.read((state) => state.selection.get()) as Range | null
    )
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

  private repairRemoteSplitAfterOfflineUndo() {
    const repairs = findSplitUndoTextRepairs(this.root)
    const redo = this.peekSplit(this.undoManagerAdapter.peekRedo())
    const splitHistory = redo?.splitHistory
    const activeRepair = splitHistory?.undoneWhileDisconnected
      ? this.getSplitUndoTextRepair(splitHistory)
      : null

    if (repairs.length > 0) {
      this.doc.transact(() => {
        for (const repair of repairs) {
          if (repair.hasRemoteSplitBoundary) {
            repair.text.delete(repair.offset, repair.length)
          } else {
            clearSplitUndoTextAttribute(
              repair.text,
              repair.offset,
              repair.length
            )
          }
        }
      }, this.historyOrigin)
    }

    if (!splitHistory?.undoneWhileDisconnected) {
      return
    }

    if (
      activeRepair?.hasRemoteSplitBoundary ||
      (!activeRepair &&
        this.hasRemoteSplitBoundary(splitHistory) &&
        !this.leftTextEndsWithSplitRightText(splitHistory))
    ) {
      splitHistory.absorbedRemoteSplit = true
    } else {
      splitHistory.undoneWhileDisconnected = false
    }
  }

  private getSplitUndoTextRepair(splitHistory: SplitHistory) {
    if (splitHistory.rightText.length === 0) {
      return null
    }

    try {
      const leftText = getYjsNode(this.root, splitHistory.textPath)

      if (!(leftText instanceof Y.XmlText)) {
        return null
      }

      const trailing = getTrailingSplitUndoText(leftText)

      if (!trailing || trailing.value !== splitHistory.rightText) {
        return null
      }

      return {
        ...trailing,
        hasRemoteSplitBoundary: this.hasRemoteSplitBoundary(splitHistory),
        text: leftText,
      } as const
    } catch {
      return null
    }
  }

  private hasRemoteSplitBoundary(splitHistory: SplitHistory) {
    try {
      const rightElement = getYjsNode(
        this.root,
        nextPath(splitHistory.elementPath)
      )

      return getVisibleText(this.root, rightElement).startsWith(
        splitHistory.rightText
      )
    } catch {
      return false
    }
  }

  private leftTextEndsWithSplitRightText(splitHistory: SplitHistory) {
    try {
      const leftText = getYjsNode(this.root, splitHistory.textPath)

      return (
        leftText instanceof Y.XmlText &&
        getYjsTextContent(leftText).endsWith(splitHistory.rightText)
      )
    } catch {
      return false
    }
  }
}
