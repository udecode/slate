import { executeCommand } from '../core/command-registry'
import { getEditorSchema } from '../core/editor-runtime'
import { getCurrentMarks, runEditorTransaction } from '../core/public-state'
import { getEditorTransformRegistry } from '../core/transform-registry'
import { Editor, type EditorStaticApi } from '../interfaces/editor'
import { Node } from '../interfaces/node'
import type { Path } from '../interfaces/path'
import { Range } from '../interfaces/range'
import { node } from './node'

type AddMarkCommand = {
  key: string
  type: 'add_mark'
  value: Parameters<EditorStaticApi['addMark']>[2]
}

const applyAddMark: EditorStaticApi['addMark'] = (editor, key, value) => {
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
      getEditorTransformRegistry(editor).setNodes(
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

export const addMark: EditorStaticApi['addMark'] = (editor, key, value) => {
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
