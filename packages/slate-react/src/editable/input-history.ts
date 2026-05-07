import type { EditorUpdateMetadata } from 'slate'
import type { Editor } from './runtime-editor-api'

const EDITOR_TO_LAST_NATIVE_TEXT_INPUT_TIME = new WeakMap<Editor, number>()

export const NATIVE_TEXT_INPUT_HISTORY_MERGE_INTERVAL_MS = 1000

const now = () => globalThis.performance?.now?.() ?? Date.now()

export const getNativeTextInputHistoryMetadata = (
  editor: Editor
): EditorUpdateMetadata | undefined => {
  const currentTime = now()
  const previousTime = EDITOR_TO_LAST_NATIVE_TEXT_INPUT_TIME.get(editor)

  EDITOR_TO_LAST_NATIVE_TEXT_INPUT_TIME.set(editor, currentTime)

  if (
    previousTime !== undefined &&
    currentTime - previousTime > NATIVE_TEXT_INPUT_HISTORY_MERGE_INTERVAL_MS
  ) {
    return { history: { mode: 'push' } }
  }
}
