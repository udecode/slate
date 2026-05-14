import {
  type Descendant,
  defineEditorExtension,
  type EditorCommit,
  type EditorExtension,
  PathApi,
  type Range,
} from 'slate'
import { Editor } from 'slate/internal'
import * as Y from 'yjs'

import {
  applyYjsEventsToEditor,
  clone,
  decodeYRelativePosition,
  encodeSlateCommitToYjs,
  encodeYRelativePosition,
  isSlateRangeInValue,
  readSlateValueFromYjs,
  remoteYjsUpdateOptions,
  slateRangeToYRelativeRange,
  writeSlateValueToYjs,
  yRelativeRangeToSlateRange,
} from './codec'
import type {
  EncodedYRelativeRange,
  YjsAwareness,
  YjsAwarenessChange,
  YjsController,
  YjsControllerState,
  YjsExtensionOptions,
  YjsRemoteCursorDecorationData,
  YjsRemoteCursorState,
} from './types'

const DEFAULT_ORIGIN = Symbol('slate-yjs-local-origin')

const isRemoteOrSkippedCommit = (commit: EditorCommit) =>
  commit.tags.includes('skip-collab') ||
  commit.tags.includes('collaboration') ||
  commit.metadata.collab?.origin === 'remote'

const isSelectionOnlyCommit = (commit: EditorCommit) =>
  commit.operations.length > 0 &&
  commit.operations.every((operation) => operation.type === 'set_selection')

const hasSameValue = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b)

class SlateYjsController implements YjsController {
  awareness: YjsAwareness | null
  editor: YjsController['editor'] = null
  extension: EditorExtension
  origin: unknown
  sharedRoot: Y.XmlText
  undoManager: Y.UndoManager

  private applyingRemote = false
  private readonly awarenessField: string
  private awarenessListener: ((event: YjsAwarenessChange) => void) | null = null
  private connection: YjsControllerState['connection'] = 'disconnected'
  private readonly cursorDataField: string
  private exports = 0
  private imports = 0
  private readonly listeners = new Set<() => void>()
  private observeYjsEvents:
    | ((events: Y.YEvent<Y.XmlText>[], transaction: Y.Transaction) => void)
    | null = null
  private revision = 0
  private runtimeState: {
    set: (
      value:
        | YjsControllerState
        | ((previous: YjsControllerState) => YjsControllerState)
    ) => void
  } | null = null
  private stateSnapshot: YjsControllerState = {
    connection: 'disconnected',
    exports: 0,
    imports: 0,
    revision: 0,
  }

  constructor(options: YjsExtensionOptions) {
    this.sharedRoot = options.sharedRoot
    this.awareness = options.awareness ?? null
    this.origin = options.origin ?? DEFAULT_ORIGIN
    this.undoManager =
      options.undoManager ??
      new Y.UndoManager(this.sharedRoot, {
        trackedOrigins: new Set([this.origin]),
      })
    this.awarenessField = options.awarenessField ?? 'selection'
    this.cursorDataField = options.cursorDataField ?? 'user'

    this.extension = defineEditorExtension({
      name: 'slate-yjs',
      register: (context) => {
        this.editor = context.editor
        this.runtimeState = context.runtimeState<YjsControllerState>(
          this.getState()
        )

        return {
          cleanup: () => {
            this.disconnect()
            this.editor = null
            this.runtimeState = null
          },
          commitListeners: [
            (commit) => {
              this.handleCommit(commit)
            },
          ],
        }
      },
    })
  }

  connect() {
    const editor = this.requireEditor()

    if (this.connection === 'connected') {
      return
    }

    this.assertAttached()
    this.observeYjsEvents = (events, transaction) => {
      if (transaction.origin === this.origin) {
        return
      }

      this.importRemoteEvents(events)
    }
    this.sharedRoot.observeDeep(this.observeYjsEvents)

    if (this.awareness) {
      this.awarenessListener = () => {
        this.notify()
      }
      this.awareness.on('change', this.awarenessListener)
    }

    const remoteValue = readSlateValueFromYjs(this.sharedRoot)
    if (remoteValue) {
      this.importRemoteSnapshot()
    } else {
      this.sharedRoot.doc!.transact(() => {
        writeSlateValueToYjs(
          this.sharedRoot,
          Editor.getSnapshot(editor).children
        )
      }, this.origin)
    }

    this.setConnection('connected')
    this.exportSelection()
  }

  disconnect() {
    if (this.connection === 'disconnected') {
      return
    }

    if (this.observeYjsEvents) {
      this.sharedRoot.unobserveDeep(this.observeYjsEvents)
      this.observeYjsEvents = null
    }
    if (this.awareness && this.awarenessListener) {
      this.awareness.off('change', this.awarenessListener)
      this.awarenessListener = null
    }

    this.awareness?.setLocalStateField(this.awarenessField, null)
    this.setConnection('disconnected')
  }

  exportSelection(
    range: Range | null = this.editor
      ? Editor.getSnapshot(this.editor).selection
      : null
  ) {
    if (!this.awareness || !this.editor || this.connection !== 'connected') {
      return
    }

    if (!range) {
      this.awareness.setLocalStateField(this.awarenessField, null)
      return
    }

    const value = Editor.getSnapshot(this.editor).children
    if (!isSlateRangeInValue(value, range)) {
      this.awareness.setLocalStateField(this.awarenessField, null)
      return
    }

    const relativeRange = slateRangeToYRelativeRange(
      this.sharedRoot,
      value,
      range
    )

    this.awareness.setLocalStateField(this.awarenessField, {
      anchor: encodeYRelativePosition(relativeRange.anchor),
      focus: encodeYRelativePosition(relativeRange.focus),
    } satisfies EncodedYRelativeRange)
  }

  getRemoteCursorDecorations<TData = unknown>(
    entry: [Descendant, number[]]
  ): readonly {
    data: YjsRemoteCursorDecorationData<TData>
    key: string
    range: Range
  }[] {
    const [, path] = entry

    return this.getRemoteCursorStates<TData>()
      .filter(
        (cursor): cursor is YjsRemoteCursorState<TData> & { range: Range } =>
          Boolean(cursor.range) &&
          (PathApi.equals(cursor.range!.anchor.path, path) ||
            PathApi.equals(cursor.range!.focus.path, path))
      )
      .map((cursor) => ({
        data: { cursor },
        key: `slate-yjs-cursor:${cursor.clientId}`,
        range: cursor.range,
      }))
  }

  getRemoteCursorStates<
    TData = unknown,
  >(): readonly YjsRemoteCursorState<TData>[] {
    if (!this.awareness || !this.editor) {
      return []
    }

    const states: YjsRemoteCursorState<TData>[] = []

    for (const [clientId, state] of this.awareness.getStates()) {
      if (clientId === this.awareness.clientID) {
        continue
      }

      const encodedRange = state[this.awarenessField] as
        | EncodedYRelativeRange
        | null
        | undefined
      const relativeRange = encodedRange
        ? {
            anchor: decodeYRelativePosition(encodedRange.anchor),
            focus: decodeYRelativePosition(encodedRange.focus),
          }
        : null
      const range = relativeRange
        ? yRelativeRangeToSlateRange(
            this.sharedRoot,
            this.editor,
            relativeRange
          )
        : null

      states.push({
        clientId,
        data: (state[this.cursorDataField] as TData | undefined) ?? null,
        range,
        relativeRange,
        user: (state.user as YjsRemoteCursorState['user']) ?? null,
      })
    }

    return states
  }

  getState(): YjsControllerState {
    return this.stateSnapshot
  }

  pause() {
    if (this.connection === 'connected') {
      this.setConnection('paused')
    }
  }

  redo() {
    const editorWithRedo = this.editor as typeof this.editor & {
      redo?: () => void
    }

    if (editorWithRedo?.redo) {
      editorWithRedo.redo()
    } else {
      this.undoManager.redo()
    }
  }

  reconcile() {
    this.importRemoteSnapshot()
  }

  resume() {
    if (this.connection === 'paused') {
      this.setConnection('connected')
      this.importRemoteSnapshot()
      this.exportSelection()
    }
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  undo() {
    const editorWithUndo = this.editor as typeof this.editor & {
      undo?: () => void
    }

    if (editorWithUndo?.undo) {
      editorWithUndo.undo()
    } else {
      this.undoManager.undo()
    }
  }

  private assertAttached() {
    if (!this.sharedRoot.doc) {
      throw new Error('slate-yjs requires sharedRoot to be attached to a Y.Doc')
    }
  }

  private handleCommit(commit: EditorCommit) {
    if (
      !this.editor ||
      this.applyingRemote ||
      this.connection !== 'connected' ||
      isRemoteOrSkippedCommit(commit)
    ) {
      return
    }

    if (isSelectionOnlyCommit(commit)) {
      this.exportSelection(commit.selectionAfter)
      this.notify()

      return
    }

    encodeSlateCommitToYjs({
      editor: this.editor,
      operations: commit.operations,
      origin: this.origin,
      sharedRoot: this.sharedRoot,
    })
    this.exports++
    this.exportSelection(commit.selectionAfter)
    this.writeRuntimeState()
    this.notify()
  }

  private importRemoteEvents(events: readonly Y.YEvent<Y.XmlText>[]) {
    if (!this.editor || this.connection !== 'connected') {
      return
    }

    this.applyingRemote = true
    try {
      if (
        applyYjsEventsToEditor({
          editor: this.editor,
          events,
          sharedRoot: this.sharedRoot,
        })
      ) {
        this.imports++
      }
    } finally {
      this.applyingRemote = false
    }

    this.exportSelection()
    this.writeRuntimeState()
    this.notify()
  }

  private importRemoteSnapshot() {
    if (!this.editor) {
      return
    }

    const remoteValue = readSlateValueFromYjs(this.sharedRoot)
    const currentValue = Editor.getSnapshot(this.editor).children

    if (!remoteValue || hasSameValue(remoteValue, currentValue)) {
      return
    }

    this.applyingRemote = true
    try {
      const snapshot = Editor.getSnapshot(this.editor)
      const selection = isSlateRangeInValue(remoteValue, snapshot.selection)
        ? snapshot.selection
        : null

      this.editor.update((tx) => {
        tx.value.replace({
          children: clone(remoteValue),
          marks: snapshot.marks,
          selection,
        })
      }, remoteYjsUpdateOptions)
      this.imports++
    } finally {
      this.applyingRemote = false
    }

    this.writeRuntimeState()
    this.notify()
  }

  private notify() {
    this.revision++
    this.writeRuntimeState()

    for (const listener of this.listeners) {
      listener()
    }
  }

  private requireEditor() {
    if (!this.editor) {
      throw new Error(
        'Extend an editor with controller.extension before connecting slate-yjs'
      )
    }

    return this.editor
  }

  private setConnection(connection: YjsControllerState['connection']) {
    if (this.connection === connection) {
      return
    }

    this.connection = connection
    this.writeRuntimeState()
    this.notify()
  }

  private writeRuntimeState() {
    const nextState = {
      connection: this.connection,
      exports: this.exports,
      imports: this.imports,
      revision: this.revision,
    }

    if (
      nextState.connection !== this.stateSnapshot.connection ||
      nextState.exports !== this.stateSnapshot.exports ||
      nextState.imports !== this.stateSnapshot.imports ||
      nextState.revision !== this.stateSnapshot.revision
    ) {
      this.stateSnapshot = nextState
    }

    this.runtimeState?.set(this.stateSnapshot)
  }
}

/**
 * Create a Slate v2 extension controller that synchronizes editor commits with
 * a `Y.XmlText` root.
 */
export const createYjsExtension = (
  options: YjsExtensionOptions
): YjsController => new SlateYjsController(options)
