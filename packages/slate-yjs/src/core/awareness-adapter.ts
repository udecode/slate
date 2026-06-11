import type { Editor, Range } from 'slate'
import * as Y from 'yjs'

import {
  createYjsAwarenessSelection,
  readYjsAwarenessSelection,
  yjsAwarenessSelectionsEqual,
} from './awareness'
import { getYjsLength, getYjsNodeIf } from './document'
import { isRecord } from './record'
import type {
  YjsAwarenessLike,
  YjsAwarenessState,
  YjsRemoteCursor,
  YjsRemoteCursorData,
} from './types'

type YjsAwarenessAdapterOptions = {
  readonly awareness?: YjsAwarenessLike
  readonly awarenessDataField: string
  readonly awarenessSelectionField: string
  readonly canSendSelection: () => boolean
  readonly clientId: number | string
  readonly doc: Y.Doc
  readonly editor: Editor
  readonly isConnected: () => boolean
  readonly root: Y.XmlElement
}

export type YjsAwarenessAdapter = {
  readonly clearSelection: () => void
  readonly currentSelection: () => Range | null
  readonly remoteCursor: <
    TCursorData extends YjsRemoteCursorData = YjsRemoteCursorData,
  >(
    clientId: number
  ) => YjsRemoteCursor<TCursorData> | null
  readonly remoteCursors: <
    TCursorData extends YjsRemoteCursorData = YjsRemoteCursorData,
  >() => readonly YjsRemoteCursor<TCursorData>[]
  readonly sendCursorData: (data: YjsRemoteCursorData | null) => void
  readonly sendSelection: (
    range?: Range | null,
    data?: YjsRemoteCursorData | null
  ) => void
}

const getSortedAwarenessClientIds = (
  awareness: YjsAwarenessLike
): readonly number[] => [...awareness.getStates().keys()].sort((a, b) => a - b)

const readRemoteCursorRecordData = <
  TCursorData extends YjsRemoteCursorData = YjsRemoteCursorData,
>(
  state: YjsAwarenessState,
  field: string
): TCursorData | undefined => {
  const data = state[field]

  return isRecord(data) ? (data as TCursorData) : undefined
}

export const createYjsAwarenessAdapter = ({
  awareness,
  awarenessDataField,
  awarenessSelectionField,
  canSendSelection,
  clientId,
  doc,
  editor,
  isConnected,
  root,
}: YjsAwarenessAdapterOptions): YjsAwarenessAdapter => {
  const currentSelection = (): Range | null =>
    editor.read((state) => state.selection.get())

  const getLocalAwarenessClientId = (): number =>
    awareness?.doc?.clientID ??
    awareness?.clientID ??
    (typeof clientId === 'number' ? clientId : doc.clientID)

  const isValidYjsSelectionPoint = (point: Range['anchor']): boolean => {
    const node = getYjsNodeIf(root, point.path)

    return (
      node instanceof Y.XmlText &&
      point.offset >= 0 &&
      point.offset <= getYjsLength(node)
    )
  }

  const sanitizeYjsSelection = (range: Range): Range | null =>
    ([range.anchor, range.focus] as const).every(isValidYjsSelectionPoint)
      ? range
      : null

  const clearSelection = (): void => {
    if (awareness === undefined) {
      return
    }

    const localState = awareness.getLocalState()

    if (
      localState !== null &&
      awarenessSelectionField in localState &&
      localState[awarenessSelectionField] !== null
    ) {
      awareness.setLocalStateField(awarenessSelectionField, null)
    }
  }

  const remoteCursor = <
    TCursorData extends YjsRemoteCursorData = YjsRemoteCursorData,
  >(
    remoteClientId: number
  ): YjsRemoteCursor<TCursorData> | null => {
    if (
      awareness === undefined ||
      !isConnected() ||
      remoteClientId === getLocalAwarenessClientId()
    ) {
      return null
    }

    const state = awareness.getStates().get(remoteClientId)

    if (state === undefined) {
      return null
    }

    const data = readRemoteCursorRecordData<TCursorData>(
      state,
      awarenessDataField
    )

    return {
      clientId: remoteClientId,
      ...(data === undefined ? {} : { data }),
      selection: readYjsAwarenessSelection(
        root,
        state[awarenessSelectionField]
      ),
    }
  }

  const remoteCursors = <
    TCursorData extends YjsRemoteCursorData = YjsRemoteCursorData,
  >(): readonly YjsRemoteCursor<TCursorData>[] => {
    if (awareness === undefined || !isConnected()) {
      return []
    }

    return getSortedAwarenessClientIds(awareness).flatMap((remoteClientId) => {
      const cursor = remoteCursor<TCursorData>(remoteClientId)

      return cursor === null ? [] : [cursor]
    })
  }

  const sendCursorData = (data: YjsRemoteCursorData | null): void => {
    awareness?.setLocalStateField(awarenessDataField, data)
  }

  const sendSelection = (
    range: Range | null | undefined = currentSelection(),
    data?: YjsRemoteCursorData | null
  ): void => {
    if (awareness === undefined || !canSendSelection()) {
      return
    }

    if (data !== undefined) {
      sendCursorData(data)
    }

    const nextRange =
      range === null || range === undefined ? null : sanitizeYjsSelection(range)
    const nextSelection =
      nextRange === null ? null : createYjsAwarenessSelection(root, nextRange)
    const currentAwarenessSelection =
      awareness.getLocalState()?.[awarenessSelectionField]

    if (
      !yjsAwarenessSelectionsEqual(currentAwarenessSelection, nextSelection)
    ) {
      awareness.setLocalStateField(awarenessSelectionField, nextSelection)
    }
  }

  return {
    clearSelection,
    currentSelection,
    remoteCursor,
    remoteCursors,
    sendCursorData,
    sendSelection,
  }
}
