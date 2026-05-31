import { useSyncExternalStore } from 'react'
import type { Editor, EditorCoreStateView } from 'slate'

import type { YjsRemoteCursor, YjsState } from '../core'

type YjsStateView = EditorCoreStateView & {
  yjs: YjsState
}

const readYjsState = <T>(editor: Editor, selector: (state: YjsState) => T) =>
  editor.read((state) => selector((state as YjsStateView).yjs))

export const getYjsAwarenessRevision = (editor: Editor) =>
  readYjsState(editor, (state) => state.awarenessRevision())

export function useYjsAwarenessRevision(editor: Editor) {
  return useSyncExternalStore(
    (listener) =>
      readYjsState(editor, (state) => state.subscribeAwareness(listener)),
    () => getYjsAwarenessRevision(editor),
    () => getYjsAwarenessRevision(editor)
  )
}

export function useYjsRemoteCursor<
  TCursorData extends Record<string, unknown> = Record<string, unknown>,
>(editor: Editor, clientId: number): YjsRemoteCursor<TCursorData> | null {
  useYjsAwarenessRevision(editor)

  return readYjsState(editor, (state) =>
    state.remoteCursor<TCursorData>(clientId)
  )
}

export function useYjsRemoteCursors<
  TCursorData extends Record<string, unknown> = Record<string, unknown>,
>(editor: Editor): YjsRemoteCursor<TCursorData>[] {
  useYjsAwarenessRevision(editor)

  return readYjsState(editor, (state) => state.remoteCursors<TCursorData>())
}
