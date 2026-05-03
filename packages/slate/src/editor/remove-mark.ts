import { executeCommand } from '../core/command-registry'
import { getEditorSchema } from '../core/editor-runtime'
import { getCurrentMarks, runEditorTransaction } from '../core/public-state'
import { getEditorTransformRegistry } from '../core/transform-registry'
import { Editor, type EditorStaticApi } from '../interfaces/editor'
import { Node } from '../interfaces/node'
import type { Path } from '../interfaces/path'
import { Range } from '../interfaces/range'
import { node } from './node'

type RemoveMarkCommand = {
  key: string
  type: 'remove_mark'
}

const applyRemoveMark: EditorStaticApi['removeMark'] = (editor, key) => {
  runEditorTransaction(editor, (tx) => {
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
      return (
        !getEditorSchema(editor).isVoid(parentNode) ||
        getEditorSchema(editor).markableVoid(parentNode)
      )
    }
    const expandedSelection = Range.isExpanded(selection)
    let markAcceptingVoidSelected = false
    if (!expandedSelection) {
      const [selectedNode, selectedPath] = node(editor, selection)
      if (selectedNode && match(selectedNode, selectedPath)) {
        const [parentNode] = Editor.parent(editor, selectedPath)
        markAcceptingVoidSelected =
          Node.isElement(parentNode) &&
          getEditorSchema(editor).markableVoid(parentNode)
      }
    }
    if (expandedSelection || markAcceptingVoidSelected) {
      getEditorTransformRegistry(editor).unsetNodes(key, {
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

export const removeMark: EditorStaticApi['removeMark'] = (editor, key) => {
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
