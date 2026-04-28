import { type Editor, Node } from '../interfaces'
import type { WithEditorFirstArg } from '../utils'

export const getFragment: WithEditorFirstArg<Editor['getFragment']> = (
  editor
) => {
  const selection = editor.getSelection()

  if (selection) {
    return Node.fragment(editor, selection)
  }
  return []
}
