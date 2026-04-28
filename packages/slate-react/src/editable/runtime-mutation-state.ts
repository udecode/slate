import type { Editor, EditorMarks, EditorTargetRuntime, Selection } from 'slate'
import {
  setEditorMarks,
  setEditorSelection,
  setEditorTargetRuntime,
} from 'slate/internal'

export const writeRuntimeMarks = (
  editor: Editor,
  marks: EditorMarks | null
) => {
  setEditorMarks(editor, marks)
}

export const writeRuntimeSelection = (editor: Editor, selection: Selection) => {
  setEditorSelection(editor, selection)
}

export const writeTargetRuntime = (
  editor: Editor,
  targetRuntime: EditorTargetRuntime | null
) => {
  setEditorTargetRuntime(editor, targetRuntime)
}
