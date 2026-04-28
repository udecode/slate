import { executeCommand } from '../core/command-registry'
import { getCurrentMarks, withTransaction } from '../core/public-state'
import { Editor, type EditorInterface } from '../interfaces/editor'
import { Node } from '../interfaces/node'
import type { Path } from '../interfaces/path'
import { Range } from '../interfaces/range'

type RemoveMarkCommand = {
  key: string
  type: 'remove_mark'
}

const applyRemoveMark: EditorInterface['removeMark'] = (editor, key) => {
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
      editor.unsetNodes(key, {
        match,
        split: true,
        voids: true,
      })
    } else {
      const marks = { ...(getCurrentMarks(editor) || {}) }
      delete marks[<keyof Node>key]
      tx.setMarks(marks)
    }
  })
}

export const removeMark: EditorInterface['removeMark'] = (editor, key) => {
  executeCommand<RemoveMarkCommand>(
    editor,
    { key, type: 'remove_mark' },
    (command) => {
      applyRemoveMark(editor, command.key)
      return { handled: true }
    },
    { implicitUpdate: true }
  )
}
