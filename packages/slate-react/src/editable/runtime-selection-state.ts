import { Editor, type Selection } from 'slate'
import { getEditorLiveSelection } from 'slate/internal'

export const readLiveSelection = (editor: Editor): Selection =>
  getEditorLiveSelection(editor)

export const readRuntimeSelection = (editor: Editor): Selection =>
  readLiveSelection(editor) ?? Editor.getSelection(editor)
