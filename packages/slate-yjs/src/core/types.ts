import type { Range, Value } from 'slate'
import type * as Y from 'yjs'

export type YjsAwarenessChange = {
  added: number[]
  removed: number[]
  updated: number[]
}

export type YjsAwarenessLike = {
  clientID?: number
  doc?: { clientID: number }
  getLocalState: () => Record<string, unknown> | null
  getStates: () => Map<number, Record<string, unknown>>
  off?: (event: 'change', handler: (event: YjsAwarenessChange) => void) => void
  on?: (event: 'change', handler: (event: YjsAwarenessChange) => void) => void
  setLocalStateField: (field: string, value: unknown) => void
}

export type YjsAwarenessSelection = {
  anchor: unknown
  focus: unknown
}

export type YjsRemoteCursor<
  TCursorData extends Record<string, unknown> = Record<string, unknown>,
> = {
  clientId: number
  selection: Range | null
  data?: TCursorData
}

export type YjsTraceMode =
  | 'operation'
  | 'remote-reconcile'
  | 'seed'
  | 'traceable-fallback'
  | 'unsupported'

export type YjsTraceEntry = {
  fallback?: string
  mode: YjsTraceMode
  operationType?: string
}

export type YjsExtensionOptions = {
  autoSendSelection?: boolean
  awareness?: YjsAwarenessLike
  awarenessDataField?: string
  awarenessSelectionField?: string
  clientId?: number | string
  doc?: Y.Doc
  rootName?: string
}

export type YjsState = {
  awarenessRevision: () => number
  clientId: () => number | string
  connected: () => boolean
  doc: () => Y.Doc
  paused: () => boolean
  remoteCursor: <
    TCursorData extends Record<string, unknown> = Record<string, unknown>,
  >(
    clientId: number
  ) => YjsRemoteCursor<TCursorData> | null
  remoteCursors: <
    TCursorData extends Record<string, unknown> = Record<string, unknown>,
  >() => YjsRemoteCursor<TCursorData>[]
  root: () => Y.XmlElement
  subscribeAwareness: (listener: () => void) => () => void
  trace: () => readonly YjsTraceEntry[]
}

export type YjsTx = {
  clearSelection: () => void
  clearTrace: () => void
  connect: () => void
  disconnect: () => void
  pause: () => void
  reconcile: () => void
  redo: () => void
  resume: () => void
  sendCursorData: (data: Record<string, unknown> | null) => void
  sendSelection: (
    range?: Range | null,
    data?: Record<string, unknown> | null
  ) => void
  undo: () => void
}

declare module 'slate' {
  interface EditorStateExtensionGroups<V extends Value = Value> {
    yjs: YjsState
  }

  interface EditorTxExtensionGroups<V extends Value = Value> {
    yjs: YjsTx
  }
}
