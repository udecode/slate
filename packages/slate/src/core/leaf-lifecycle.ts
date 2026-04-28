import {
  type Descendant,
  Editor,
  Element,
  Node,
  Path,
  Text,
} from '../interfaces'
import { removeNodes } from '../transforms-node'
import { getLiveSelection } from './public-state'

const getChildren = (editor: Editor, node: Editor | Element): Descendant[] =>
  Node.isEditor(node) ? Editor.getChildren(editor) : node.children

const isInlineElement = (editor: Editor, node: Node | undefined) =>
  Element.isElement(node) && editor.isInline(node)

const isRequiredInlineSpacer = (
  editor: Editor,
  siblings: readonly Node[],
  index: number
) => {
  const previous = siblings[index - 1]
  const next = siblings[index + 1]

  return isInlineElement(editor, previous) || isInlineElement(editor, next)
}

const pathToPoint = (
  editor: Editor,
  path: Path,
  affinity: 'backward' | 'forward'
) => {
  const parentPath = path.slice(0, -1)
  const isInSameParent = (point: ReturnType<typeof Editor.before>) =>
    point ? Path.equals(point.path.slice(0, -1), parentPath) : false
  const after = Editor.after(editor, path, { unit: 'offset', voids: true })
  const before = Editor.before(editor, path, { unit: 'offset', voids: true })

  if (affinity === 'forward') {
    return isInSameParent(after) ? after : (before ?? after ?? null)
  }

  return isInSameParent(before) ? before : (after ?? before ?? null)
}

const maybeRebaseSelectionBeforeRemoval = (
  editor: Editor,
  path: Path,
  affinity: 'backward' | 'forward'
) => {
  const selection = getLiveSelection(editor)

  if (
    !selection ||
    (!Path.equals(selection.anchor.path, path) &&
      !Path.equals(selection.focus.path, path))
  ) {
    return
  }

  const point = pathToPoint(editor, path, affinity)

  if (!point) {
    return
  }

  editor.setSelection({ anchor: point, focus: point })
}

export const cleanupTextLeafLifecycle = (
  editor: Editor,
  {
    affinity = 'backward',
  }: {
    affinity?: 'backward' | 'forward'
  } = {}
) => {
  const elementPaths = Array.from(
    Editor.nodes(editor, {
      at: [],
      match: (node) => Node.isEditor(node) || Element.isElement(node),
      mode: 'all',
      reverse: true,
      voids: true,
    }),
    ([, path]) => path
  )

  for (const path of elementPaths) {
    if (!editor.hasPath(path)) {
      continue
    }

    const node = path.length === 0 ? editor : Editor.node(editor, path)[0]

    if (!Node.isEditor(node) && !Element.isElement(node)) {
      continue
    }

    const children = getChildren(editor, node)
    const parentHasText = Node.string(node) !== ''
    let emptyTextChildren = children.filter(
      (child) => Text.isText(child) && child.text === ''
    ).length

    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index]

      if (!Text.isText(child) || child.text !== '') {
        continue
      }

      const childPath = [...path, index]
      const requiredInlineSpacer = isRequiredInlineSpacer(
        editor,
        children,
        index
      )
      const requiredEmptyBlockAnchor = !parentHasText && emptyTextChildren <= 1

      if (requiredInlineSpacer || requiredEmptyBlockAnchor) {
        continue
      }

      maybeRebaseSelectionBeforeRemoval(editor, childPath, affinity)
      removeNodes(editor, { at: childPath, voids: true })
      emptyTextChildren -= 1
    }
  }
}
