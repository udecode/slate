import { useSyncExternalStore } from 'react'
import type { Editor } from 'slate'
import { EDITOR_TO_FORCE_RENDER } from 'slate-dom'

import type {
  SlateYjsRemoteCursorState,
  SlateYjsState,
  SlateYjsStateApi,
} from '../core/index'

const getYjsApi = (editor: Editor) =>
  editor.read((state) => {
    if (!('yjs' in state)) {
      throw new Error(
        'useSlateYjsState requires an editor extended with createYjsExtension(...).'
      )
    }

    return (state as typeof state & { yjs: SlateYjsStateApi }).yjs
  })

const subscribeYjsState = (editor: Editor, listener: () => void) =>
  getYjsApi(editor).subscribe(() => {
    listener()
    EDITOR_TO_FORCE_RENDER.get(editor)?.()
  })

export const useSlateYjsState = (editor: Editor): SlateYjsState => {
  return useSyncExternalStore(
    (listener) => subscribeYjsState(editor, listener),
    () => getYjsApi(editor).getState(),
    () => getYjsApi(editor).getState()
  )
}

export const useSlateYjsRemoteCursorStates = (
  editor: Editor
): SlateYjsRemoteCursorState[] => {
  return useSyncExternalStore(
    (listener) => getYjsApi(editor).subscribe(listener),
    () => getYjsApi(editor).getRemoteCursorStates(),
    () => getYjsApi(editor).getRemoteCursorStates()
  )
}
