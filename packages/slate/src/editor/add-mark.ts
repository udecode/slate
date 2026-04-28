import { executeCommand } from '../core/command-registry'
import { getCurrentMarks, withTransaction } from '../core/public-state'
import { Editor, type EditorInterface } from '../interfaces/editor'
import { Node } from '../interfaces/node'
import type { Path } from '../interfaces/path'
import { Range } from '../interfaces/range'

type AddMarkCommand = {
  key: string
  type: 'add_mark'
  value: Parameters<EditorInterface['addMark']>[2]
}

const applyAddMark: EditorInterface['addMark'] = (editor, key, value) => {
  withTransaction(editor, (tx) => {
    const selection = tx.resolveTarget()

    if (!selection || !Range.isRange(selection)) {
      return
    }

    const match = (node: Node, path: Path) => {
      if (!Node.isText(node)) {
        return false // marks can only be applied to text
      }
      const [parentNode] = Editor.parent(editor, path)
      if (!Node.isElement(parentNode)) {
        return false
      }
      return !editor.isVoid(parentNode) || editor.markableVoid(parentNode)
    }
    const expandedSelection = Range.isExpanded(selection)
    let markAcceptingVoidSelected = false
    if (!expandedSelection) {
      const [selectedNode, selectedPath] = Editor.node(editor, selection)
      if (selectedNode && match(selectedNode, selectedPath)) {
        const [parentNode] = Editor.parent(editor, selectedPath)
        markAcceptingVoidSelected =
          Node.isElement(parentNode) && editor.markableVoid(parentNode)
      }
    }
    if (expandedSelection || markAcceptingVoidSelected) {
      editor.setNodes(
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

      tx.setMarks(marks)
    }
  })
}

export const addMark: EditorInterface['addMark'] = (editor, key, value) => {
  executeCommand<AddMarkCommand>(
    editor,
    { key, type: 'add_mark', value },
    (command) => {
      applyAddMark(editor, command.key, command.value)
      return { handled: true }
    },
    { implicitUpdate: true }
  )
}
