import type {
  Descendant,
  EditorExtension,
  Operation,
  Range,
  Editor as SlateEditor,
  Value,
} from 'slate'
import type * as Y from 'yjs'

export type YjsConnectionState = 'connected' | 'disconnected' | 'paused'

export type YjsUserState = {
  color?: string
  name?: string
} & Record<string, unknown>

export type EncodedYRelativePosition = readonly number[]

export type EncodedYRelativeRange = {
  anchor: EncodedYRelativePosition
  focus: EncodedYRelativePosition
}

export type YjsAwarenessSelection = EncodedYRelativeRange

export type YjsAwarenessState = {
  selection?: YjsAwarenessSelection | null
  user?: YjsUserState
} & Record<string, unknown>

export type YjsAwarenessChange = {
  added: number[]
  removed: number[]
  updated: number[]
}

export type YjsAwareness = {
  clientID: number
  getLocalState: () => YjsAwarenessState | null
  getStates: () => Map<number, YjsAwarenessState>
  off: (event: 'change', listener: (event: YjsAwarenessChange) => void) => void
  on: (event: 'change', listener: (event: YjsAwarenessChange) => void) => void
  setLocalState: (state: YjsAwarenessState | null) => void
  setLocalStateField: (field: string, value: unknown) => void
}

export type YjsLocalAwareness = YjsAwareness & {
  applyRemoteState: (clientId: number, state: YjsAwarenessState | null) => void
}

export type YjsRelativeRange = {
  anchor: Y.RelativePosition
  focus: Y.RelativePosition
}

export type YjsRemoteCursorState<TData = unknown> = {
  clientId: number
  data: TData | null
  range: Range | null
  relativeRange: YjsRelativeRange | null
  user: YjsUserState | null
}

export type YjsRemoteCursorDecorationData<TData = unknown> = {
  cursor: YjsRemoteCursorState<TData>
}

export type YjsExtensionOptions = {
  /**
   * Field used inside awareness states for encoded Slate selections.
   *
   * @default 'selection'
   */
  awarenessField?: string
  /**
   * Awareness instance supplied by a provider or deterministic local transport.
   */
  awareness?: YjsAwareness
  /**
   * Field used inside awareness states for user metadata.
   *
   * @default 'user'
   */
  cursorDataField?: string
  /**
   * Local transaction origin used to suppress Yjs echo loops.
   */
  origin?: unknown
  /**
   * Shared Yjs root that stores the Slate snapshot and linear text mirror.
   */
  sharedRoot: Y.XmlText
  /**
   * UndoManager scoped to the shared root. When omitted, the controller creates
   * one that tracks only the local origin.
   */
  undoManager?: Y.UndoManager
}

export type YjsControllerState = {
  connection: YjsConnectionState
  exports: number
  imports: number
  revision: number
}

export type YjsController = {
  awareness: YjsAwareness | null
  connect: () => void
  disconnect: () => void
  editor: SlateEditor | null
  extension: EditorExtension
  exportSelection: (range?: Range | null) => void
  getRemoteCursorDecorations: <TData = unknown>(
    entry: [Descendant, number[]]
  ) => readonly {
    data: YjsRemoteCursorDecorationData<TData>
    key: string
    range: Range
  }[]
  getRemoteCursorStates: <
    TData = unknown,
  >() => readonly YjsRemoteCursorState<TData>[]
  getState: () => YjsControllerState
  origin: unknown
  pause: () => void
  redo: () => void
  reconcile: () => void
  resume: () => void
  sharedRoot: Y.XmlText
  subscribe: (listener: () => void) => () => void
  undo: () => void
  undoManager: Y.UndoManager
}

export type YjsApplyEventsInput = {
  editor: SlateEditor
  events?: readonly Y.YEvent<Y.XmlText>[]
  sharedRoot: Y.XmlText
}

export type YjsEncodeCommitInput = {
  editor: SlateEditor
  operations: readonly Operation[]
  origin: unknown
  sharedRoot: Y.XmlText
}

export type YjsPointMappingInput = SlateEditor | Value

export type YjsPointOptions = {
  assoc?: -1 | 0 | 1
}
