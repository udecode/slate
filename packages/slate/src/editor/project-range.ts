import type { EditorInterface } from '../interfaces/editor'
import { projectRangeInSnapshot } from '../range-projection'

export const projectRange: EditorInterface['projectRange'] = (editor, range) =>
  projectRangeInSnapshot(editor.getSnapshot(), range)
