import {
  getCurrentMarks,
  getCurrentSelection,
  setCurrentMarks,
  withTransaction,
} from '../core/public-state'
import { Editor, type EditorInterface } from '../interfaces/editor'
import { Node } from '../interfaces/node'
import type { Path } from '../interfaces/path'
import { Range } from '../interfaces/range'
import { Transforms } from '../interfaces/transforms'

export const addMark: EditorInterface['addMark'] = (editor, key, value) => {
  const selection = getCurrentSelection(editor)

  if (selection) {
    const match = (node: Node, path: Path) => {
      if (!Node.isText(node)) {
        return false // marks can only be applied to text
      }
      const [parentNode] = Editor.parent(editor, path)
      return !editor.isVoid(parentNode) || editor.markableVoid(parentNode)
    }
    const expandedSelection = Range.isExpanded(selection)
    let markAcceptingVoidSelected = false
    if (!expandedSelection) {
      const [selectedNode, selectedPath] = Editor.node(editor, selection)
      if (selectedNode && match(selectedNode, selectedPath)) {
        const [parentNode] = Editor.parent(editor, selectedPath)
        markAcceptingVoidSelected =
          parentNode && editor.markableVoid(parentNode)
      }
    }
    if (expandedSelection || markAcceptingVoidSelected) {
      Transforms.setNodes(
        editor,
        { [key]: value },
        {
          match,
          split: true,
          voids: true,
        }
      )
    } else {
      const marks = {
        ...(getCurrentMarks(editor) || {}),
        [key]: value,
      }

      withTransaction(editor, () => {
        setCurrentMarks(editor, marks)
      })
    }
  }
}
