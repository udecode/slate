import { setChildren as setEditorChildren } from '../core/public-state'
import {
  type Ancestor,
  type Descendant,
  type Element,
  Node,
  type Path,
  Scrubber,
  type Text,
} from '../interfaces'
import { Editor } from '../interfaces/editor'
import { inheritRuntimeId } from './runtime-ids'

const setChildren = (root: Ancestor, children: Descendant[]) => {
  if (Node.isEditor(root)) {
    setEditorChildren(root, children)
    return
  }

  ;(root as { children: Descendant[] }).children = children
}

const getChildren = (root: Ancestor): Descendant[] =>
  Node.isEditor(root) ? Editor.getChildren(root) : root.children

export const insertChildren = <T>(
  xs: T[],
  index: number,
  ...newValues: T[]
) => [...xs.slice(0, index), ...newValues, ...xs.slice(index)]

export const replaceChildren = <T>(
  xs: T[],
  index: number,
  removeCount: number,
  ...newValues: T[]
) => [...xs.slice(0, index), ...newValues, ...xs.slice(index + removeCount)]

export const removeChildren = replaceChildren

/**
 * Replace a descendant with a new node, replacing all ancestors
 */
export const modifyDescendant = <N extends Descendant>(
  root: Ancestor,
  path: Path,
  f: (node: N) => N
) => {
  if (path.length === 0) {
    throw new Error('Cannot modify the editor')
  }

  const node = Node.get(root, path) as N
  const slicedPath = path.slice()
  let modifiedNode: Descendant = f(node)
  inheritRuntimeId(modifiedNode, node)

  while (slicedPath.length > 1) {
    const index = slicedPath.pop()!
    const ancestorNode = Node.get(root, slicedPath) as Ancestor
    if (Node.isEditor(ancestorNode)) {
      throw new Error('Cannot modify the editor as a descendant')
    }

    modifiedNode = {
      ...ancestorNode,
      children: replaceChildren(
        getChildren(ancestorNode),
        index,
        1,
        modifiedNode
      ),
    }
    inheritRuntimeId(modifiedNode, ancestorNode)
  }

  const index = slicedPath.pop()!
  setChildren(root, replaceChildren(getChildren(root), index, 1, modifiedNode))
}

/**
 * Replace the children of a node, replacing all ancestors
 */
export const modifyChildren = (
  root: Ancestor,
  path: Path,
  f: (children: Descendant[]) => Descendant[]
) => {
  if (path.length === 0) {
    setChildren(root, f(getChildren(root)))
  } else {
    modifyDescendant<Element>(root, path, (node) => {
      if (Node.isText(node)) {
        throw new Error(
          `Cannot get the element at path [${path}] because it refers to a leaf node: ${Scrubber.stringify(
            node
          )}`
        )
      }

      return { ...node, children: f(node.children) }
    })
  }
}

/**
 * Replace a leaf, replacing all ancestors
 */
export const modifyLeaf = (
  root: Ancestor,
  path: Path,
  f: (leaf: Text) => Text
) =>
  modifyDescendant(root, path, (node) => {
    if (!Node.isText(node)) {
      throw new Error(
        `Cannot get the leaf node at path [${path}] because it refers to a non-leaf node: ${Scrubber.stringify(
          node
        )}`
      )
    }

    return f(node)
  })
