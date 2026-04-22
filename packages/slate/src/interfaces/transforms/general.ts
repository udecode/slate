import {
  getCurrentSelection,
  setCurrentSelection,
} from '../../core/public-state'
import {
  type Descendant,
  type Editor,
  Node,
  type NodeEntry,
  type Operation,
  Path,
  Point,
  Range,
  Scrubber,
  type Selection,
  type Text,
} from '../../index'
import {
  insertChildren,
  modifyChildren,
  modifyDescendant,
  modifyLeaf,
  removeChildren,
  replaceChildren,
} from '../../utils/modify'
import { inheritRuntimeId } from '../../utils/runtime-ids'

/**
 * The set of properties that cannot be set using set_node.
 */
export const NON_SETTABLE_NODE_PROPERTIES = [
  'children',
  'text',
  // Do not allow overriding any property on the Object prototype
  ...Object.getOwnPropertyNames(Object.prototype),
]

/**
 * The set of properties that cannot be set using set_selection.
 */
export const NON_SETTABLE_SELECTION_PROPERTIES = Object.getOwnPropertyNames(
  Object.prototype
)

export interface GeneralTransforms {
  /**
   * Transform the editor by an operation.
   */
  applyBatch: (editor: Editor, operations: Operation[]) => void
  transform: (editor: Editor, op: Operation) => void
}

// eslint-disable-next-line no-redeclare
export const GeneralTransforms: GeneralTransforms = {
  applyBatch(editor: Editor, operations: Operation[]): void {
    editor.withTransaction(() => {
      for (const operation of operations) {
        editor.apply(operation)
      }
    })
  },

  transform(editor: Editor, op: Operation): void {
    let transformSelection = false
    let selectionTransformOp = op

    switch (op.type) {
      case 'insert_node': {
        const { path, node } = op

        modifyChildren(editor, Path.parent(path), (children) => {
          const index = path.at(-1)!

          if (index > children.length) {
            throw new Error(
              `Cannot apply an "insert_node" operation at path [${path}] because the destination is past the end of the node.`
            )
          }

          return insertChildren(children, index, node)
        })

        transformSelection = true
        break
      }

      case 'insert_text': {
        const { path, offset, text } = op
        if (text.length === 0) break

        modifyLeaf(editor, path, (node) => {
          const before = node.text.slice(0, offset)
          const after = node.text.slice(offset)

          return {
            ...node,
            text: before + text + after,
          }
        })

        transformSelection = true
        break
      }

      case 'merge_node': {
        const { path } = op
        const index = path.at(-1)!
        const prevPath = Path.previous(path)
        const prevIndex = prevPath.at(-1)!

        if (path.length === 0) {
          throw new Error(
            `Cannot apply a "merge_node" operation at path [${path}] because the root node cannot be merged.`
          )
        }

        // Defend against malicious paths containing strings
        if (typeof index !== 'number' || typeof prevIndex !== 'number')
          throw new Error('Index must be number')

        modifyChildren(editor, Path.parent(path), (children) => {
          const node = children[index]
          const prev = children[prevIndex]
          let newNode: Descendant

          if (Node.isText(node) && Node.isText(prev)) {
            newNode = { ...prev, text: prev.text + node.text }
          } else if (Node.isElement(node) && Node.isElement(prev)) {
            newNode = { ...prev, children: prev.children.concat(node.children) }
          } else {
            throw new Error(
              `Cannot apply a "merge_node" operation at path [${path}] to nodes of different interfaces: ${Scrubber.stringify(
                node
              )} ${Scrubber.stringify(prev)}`
            )
          }

          inheritRuntimeId(newNode, prev)

          return replaceChildren(children, prevIndex, 2, newNode)
        })

        if (getCurrentSelection(editor)) {
          const selection = getCurrentSelection(editor)

          if (selection) {
            const nextSelection = Range.transform(selection, op)

            setCurrentSelection(editor, nextSelection)
          }
        }
        break
      }

      case 'move_node': {
        const { path, newPath } = op
        const index = path.at(-1)!

        if (Path.equals(path, newPath)) {
          break
        }

        if (Path.isAncestor(path, newPath)) {
          throw new Error(
            `Cannot move a path [${path}] to new path [${newPath}] because the destination is inside itself.`
          )
        }

        const node = Node.get(editor, path)

        modifyChildren(editor, Path.parent(path), (children) =>
          removeChildren(children, index, 1)
        )

        // This is tricky, but since the `path` and `newPath` both refer to
        // the same snapshot in time, there's a mismatch. After either
        // removing the original position, the second step's path can be out
        // of date. So instead of using the `op.newPath` directly, we
        // `newPath` is expressed against the pre-removal tree. When the moved
        // node is before that destination, compute the effective post-removal
        // insertion path first.
        const sameParentForwardMove =
          path.length === newPath.length &&
          path.at(-1) != null &&
          newPath.at(-1) != null &&
          Path.equals(path.slice(0, -1), newPath.slice(0, -1)) &&
          path.at(-1)! < newPath.at(-1)!

        const truePath = sameParentForwardMove
          ? newPath
          : Path.transform(newPath, {
              type: 'remove_node',
              path,
              node,
            })!
        const newIndex = truePath.at(-1)!
        selectionTransformOp = { ...op, newPath: truePath }

        modifyChildren(editor, Path.parent(truePath), (children) =>
          insertChildren(children, newIndex, node)
        )

        transformSelection = true
        break
      }

      case 'remove_node': {
        const { path } = op
        const index = path.at(-1)!

        modifyChildren(editor, Path.parent(path), (children) =>
          removeChildren(children, index, 1)
        )

        // Transform all the points in the value, but if the point was in the
        // node that was removed we need to update the range or remove it.
        const currentSelection = getCurrentSelection(editor)

        if (currentSelection) {
          let selection: Selection = { ...currentSelection }

          for (const [point, key] of Range.points(selection)) {
            const result = Point.transform(point, op)

            if (selection != null && result != null) {
              selection[key] = result
            } else {
              let prev: NodeEntry<Text> | undefined
              let next: NodeEntry<Text> | undefined

              for (const [n, p] of Node.texts(editor)) {
                if (Path.compare(p, path) === -1) {
                  prev = [n, p]
                } else {
                  next = [n, p]
                  break
                }
              }

              let preferNext = false
              if (prev && next) {
                if (Path.isSibling(prev[1], path)) {
                  preferNext = false
                } else if (Path.equals(next[1], path)) {
                  preferNext = true
                } else {
                  preferNext =
                    Path.common(prev[1], path).length <
                    Path.common(next[1], path).length
                }
              }

              if (prev && !preferNext) {
                selection![key] = { path: prev[1], offset: prev[0].text.length }
              } else if (next) {
                selection![key] = { path: next[1], offset: 0 }
              } else {
                selection = null
              }
            }
          }

          if (!selection || !Range.equals(selection, currentSelection)) {
            setCurrentSelection(editor, selection)
          }
        }

        break
      }

      case 'remove_text': {
        const { path, offset, text } = op
        if (text.length === 0) break

        modifyLeaf(editor, path, (node) => {
          const before = node.text.slice(0, offset)
          const after = node.text.slice(offset + text.length)

          return {
            ...node,
            text: before + after,
          }
        })

        transformSelection = true
        break
      }

      case 'set_node': {
        const { path, properties, newProperties } = op

        if (path.length === 0) {
          throw new Error('Cannot set properties on the root node!')
        }

        modifyDescendant(editor, path, (node) => {
          const newNode = { ...node }

          for (const key in newProperties) {
            if (!Object.hasOwn(newProperties, key)) continue
            if (NON_SETTABLE_NODE_PROPERTIES.includes(key)) {
              if (key === 'children') {
                throw new Error('set_node does not update child content')
              }
              throw new Error(`Cannot set the "${key}" property of nodes!`)
            }

            const value = newProperties[<keyof Node>key]

            // Make sure we're not setting `then` to a function, since this will
            // cause the node to be treated as a Promise-like object, which can
            // cause unexpected behaviour when returning the node from async
            // functions.
            if (key === 'then' && typeof value === 'function') {
              throw new Error(
                'Cannot set the "then" property of a node to a function'
              )
            }

            if (value == null) {
              delete newNode[<keyof Node>key]
            } else {
              newNode[<keyof Node>key] = value
            }
          }

          // properties that were previously defined, but are now missing, must be deleted
          for (const key in properties) {
            if (!Object.hasOwn(properties, key)) continue
            if (!Object.hasOwn(newProperties, key)) {
              delete newNode[<keyof Node>key]
            }
          }

          return newNode
        })

        break
      }

      case 'set_selection': {
        const { newProperties } = op

        if (newProperties == null) {
          setCurrentSelection(editor, null)
          break
        }

        const currentSelection = getCurrentSelection(editor)

        if (currentSelection == null) {
          if (!(newProperties.anchor && newProperties.focus)) {
            throw new Error(
              `set_selection patch requires an existing selection or a full range. Received: ${Scrubber.stringify(
                newProperties
              )}`
            )
          }

          setCurrentSelection(editor, newProperties as Range)
          break
        }

        const selection = { ...currentSelection }

        for (const key in newProperties) {
          if (!Object.hasOwn(newProperties, key)) continue
          if (NON_SETTABLE_SELECTION_PROPERTIES.includes(key)) {
            throw new Error(
              `Cannot set the "${key}" property of the selection!`
            )
          }

          if (key !== 'anchor' && key !== 'focus') {
            continue
          }

          const value = newProperties[<keyof Range>key]

          if (value == null) {
            if (key === 'anchor' || key === 'focus') {
              throw new Error(`Cannot remove the "${key}" selection property`)
            }

            delete selection[<keyof Range>key]
          } else {
            selection[<keyof Range>key] = value
          }
        }

        setCurrentSelection(editor, selection)

        break
      }

      case 'split_node': {
        const { path, position, properties } = op
        const index = path.at(-1)

        if (path.length === 0) {
          throw new Error(
            `Cannot apply a "split_node" operation at path [${path}] because the root node cannot be split.`
          )
        }

        // Defend against malicious paths containing strings
        if (typeof index !== 'number') throw new Error('Index must be number')

        modifyChildren(editor, Path.parent(path), (children) => {
          const node = children[index]
          let newNode: Descendant
          let nextNode: Descendant

          if (Node.isText(node)) {
            const before = node.text.slice(0, position)
            const after = node.text.slice(position)
            newNode = {
              ...node,
              text: before,
            }
            nextNode = {
              ...properties,
              text: after,
            }
          } else {
            const before = node.children.slice(0, position)
            const after = node.children.slice(position)
            newNode = {
              ...node,
              children: before,
            }
            nextNode = {
              ...(Object.hasOwn(properties, 'type') &&
              typeof (properties as { type?: unknown }).type === 'string'
                ? { type: (properties as { type: string }).type }
                : Object.hasOwn(node, 'type')
                  ? { type: (node as { type?: unknown }).type }
                  : {}),
              ...properties,
              children: after,
            }
          }

          inheritRuntimeId(newNode, node)

          for (const key in properties) {
            if (!Object.hasOwn(properties, key)) continue
            if (NON_SETTABLE_NODE_PROPERTIES.includes(key)) {
              throw new Error(`Cannot set the "${key}" property of nodes!`)
            }

            const value = properties[<keyof Node>key]

            // Make sure we're not setting `then` to a function, since this will
            // cause the node to be treated as a Promise-like object, which can
            // cause unexpected behaviour when returning the node from async
            // functions.
            if (key === 'then' && typeof value === 'function') {
              throw new Error(
                'Cannot set the "then" property of a node to a function'
              )
            }

            if (value != null) {
              nextNode[<keyof Node>key] = value
            }
          }

          return replaceChildren(children, index, 1, newNode, nextNode)
        })

        if (getCurrentSelection(editor)) {
          const selection = getCurrentSelection(editor)

          if (selection) {
            const nextSelection = Range.transform(selection, op, {
              affinity: 'inward',
            })

            setCurrentSelection(editor, nextSelection)
          }
        }
        break
      }
    }

    const currentSelection = getCurrentSelection(editor)

    if (transformSelection && currentSelection) {
      const selection = { ...currentSelection }

      for (const [point, key] of Range.points(selection)) {
        selection[key] = Point.transform(point, selectionTransformOp)!
      }

      if (!Range.equals(selection, currentSelection)) {
        setCurrentSelection(editor, selection)
      }
    }
  },
}
