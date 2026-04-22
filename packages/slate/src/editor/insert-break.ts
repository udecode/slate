import { getCurrentSelection, withTransaction } from '../core/public-state'
import type { EditorInterface } from '../interfaces/editor'
import { Node } from '../interfaces/node'
import type { Path } from '../interfaces/path'
import { Range } from '../interfaces/range'

export const insertBreak: EditorInterface['insertBreak'] = (editor) => {
  const selection = getCurrentSelection(editor)

  if (!selection) {
    return
  }

  if (!Range.isCollapsed(selection)) {
    editor.deleteFragment()
  }

  const collapsed = getCurrentSelection(editor)

  if (!collapsed || !Range.isCollapsed(collapsed)) {
    return
  }

  const point = collapsed.anchor

  withTransaction(editor, () => {
    const [node] = editor.node(point.path)
    const nodeProps = Node.extractProps(node)

    if (!Node.isText(node)) {
      throw new Error(
        'Editor.insertBreak currently supports only text-node selections'
      )
    }

    let nextPath = [...point.path.slice(0, -1), point.path.at(-1)! + 1] as Path

    if (point.offset === 0) {
      editor.apply({
        type: 'insert_node',
        path: point.path,
        node: {
          text: '',
          ...nodeProps,
        },
      })
    } else if (point.offset === node.text.length) {
      editor.apply({
        type: 'insert_node',
        path: nextPath,
        node: {
          text: '',
          ...nodeProps,
        },
      })
    } else {
      editor.apply({
        type: 'split_node',
        path: point.path,
        position: point.offset,
        properties: nodeProps,
      })
    }

    for (let depth = point.path.length - 1; depth > 0; depth -= 1) {
      const parentPath = point.path.slice(0, depth) as Path
      const position = nextPath[depth]!
      const [parentNode] = editor.node(parentPath)

      if (Node.isText(parentNode)) {
        throw new Error(
          'Editor.insertBreak currently expects element ancestors'
        )
      }

      editor.apply({
        type: 'split_node',
        path: parentPath,
        position,
        properties: Node.extractProps(parentNode),
      })

      nextPath = [...parentPath.slice(0, -1), parentPath.at(-1)! + 1] as Path
    }

    const firstPoint = editor.start(nextPath)

    editor.apply({
      type: 'set_selection',
      properties: getCurrentSelection(editor),
      newProperties: {
        anchor: firstPoint,
        focus: firstPoint,
      },
    })
  })
}
