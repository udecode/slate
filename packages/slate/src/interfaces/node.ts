import { Path, Range, Scrubber, Text } from '..'
import { modifyChildren, modifyLeaf, removeChildren } from '../utils/modify'
import type { Editor as EditorType, Value } from './editor'
import { Editor } from './editor'
import { Element, type ElementEntry, type ElementOf } from './element'
import type { TextOf } from './text'

/**
 * The `Node` union type represents all of the different types of nodes that
 * occur in a Slate document tree.
 */

export type BaseNode = Editor | Element | Text
export type Node = Editor | Element | Text
export type TNode = Node

export type DescendantOf<N> = N extends { getChildren: () => infer V }
  ? V extends readonly (infer Child)[]
    ? ElementOf<Child> | TextOf<Child>
    : never
  : N extends Element
    ? ElementOf<N> | TextOf<N>
    : N extends Text
      ? N
      : never

export type AncestorOf<N> = N extends { getChildren: () => infer V }
  ? N | (V extends readonly (infer Child)[] ? ElementOf<Child> : never)
  : N extends Element
    ? N | ElementOf<N>
    : never

export type NodeOf<N> = N | ElementOf<N> | TextOf<N>

export type DescendantIn<V extends Value> = DescendantOf<V[number]>

export type AncestorIn<V extends Value> = AncestorOf<EditorType<V> | V[number]>

export type NodeIn<V extends Value> = Element[] extends V
  ? Node
  : NodeOf<EditorType<V> | V[number]>

export type ChildOf<N, I extends number = number> = N extends {
  children: readonly unknown[]
}
  ? N['children'][I]
  : never

export type NodeProps<N = Node> = N extends { children: unknown }
  ? Omit<N, 'children'>
  : N extends { text: string }
    ? Omit<N, 'text'>
    : Omit<N, 'getChildren'>

export interface NodeAncestorsOptions {
  reverse?: boolean
}

export interface NodeChildrenOptions {
  reverse?: boolean
}

export interface NodeDescendantsOptions {
  from?: Path
  to?: Path
  reverse?: boolean
  pass?: (node: NodeEntry) => boolean
}

export interface NodeElementsOptions {
  from?: Path
  to?: Path
  reverse?: boolean
  pass?: (node: NodeEntry) => boolean
}

export interface NodeIsNodeOptions {
  deep?: boolean
}

export interface NodeLevelsOptions {
  reverse?: boolean
}

export interface NodeNodesOptions {
  from?: Path
  to?: Path
  reverse?: boolean
  pass?: (entry: NodeEntry) => boolean
}

export interface NodeTextsOptions {
  from?: Path
  to?: Path
  reverse?: boolean
  pass?: (node: NodeEntry) => boolean
}

export interface NodeInterface {
  /**
   * Get the node at a specific path, asserting that it's an ancestor node.
   */
  ancestor: (root: Node, path: Path) => Ancestor

  /**
   * Return a generator of all the ancestor nodes above a specific path.
   *
   * By default the order is top-down, from highest to lowest ancestor in
   * the tree, but you can pass the `reverse: true` option to go bottom-up.
   */
  ancestors: (
    root: Node,
    path: Path,
    options?: NodeAncestorsOptions
  ) => Generator<NodeEntry<Ancestor>, void, undefined>

  /**
   * Get the child of a node at a specific index.
   */
  child: (root: Node, index: number) => Descendant

  /**
   * Iterate over the children of a node at a specific path.
   */
  children: (
    root: Node,
    path: Path,
    options?: NodeChildrenOptions
  ) => Generator<NodeEntry<Descendant>, void, undefined>

  /**
   * Get an entry for the common ancesetor node of two paths.
   */
  common: (root: Node, path: Path, another: Path) => NodeEntry

  /**
   * Get the node at a specific path, asserting that it's a descendant node.
   */
  descendant: (root: Node, path: Path) => Descendant

  /**
   * Return a generator of all the descendant node entries inside a root node.
   */
  descendants: (
    root: Node,
    options?: NodeDescendantsOptions
  ) => Generator<NodeEntry<Descendant>, void, undefined>

  /**
   * Return a generator of all the element nodes inside a root node. Each iteration
   * will return an `ElementEntry` tuple consisting of `[Element, Path]`. If the
   * root node is an element it will be included in the iteration as well.
   */
  elements: (
    root: Node,
    options?: NodeElementsOptions
  ) => Generator<ElementEntry, void, undefined>

  /**
   * Extract props from a Node.
   */
  extractProps: (node: Node) => NodeProps

  /**
   * Get the first leaf node entry in a root node from a path.
   */
  first: (root: Node, path: Path) => NodeEntry

  /**
   * Get the sliced fragment represented by a range inside a root node.
   */
  fragment: <T extends Ancestor = Editor>(root: T, range: Range) => Descendant[]

  /**
   * Get the descendant node referred to by a specific path. If the path is an
   * empty array, it refers to the root node itself.
   */
  get: (root: Node, path: Path) => Node

  /**
   * Similar to get, but returns undefined if the node does not exist.
   */
  getIf: (root: Node, path: Path) => Node | undefined

  /**
   * Check if a descendant node exists at a specific path.
   */
  has: (root: Node, path: Path) => boolean

  /**
   * Check if a node is an `Editor` or `Element` object.
   */
  isAncestor: (node: Node) => node is Ancestor

  /**
   * Check if a node is an `Editor` object.
   */
  isEditor: (node: Node) => node is Editor

  /**
   * Check if a node is an `Element` object.
   */
  isElement: (node: Node) => node is Element

  /**
   * Check if a value implements the `Node` interface.
   */
  isNode: (value: any, options?: NodeIsNodeOptions) => value is Node

  /**
   * Check if a value is a list of `Node` objects.
   */
  isNodeList: (value: any, options?: NodeIsNodeOptions) => value is Node[]

  /**
   * Check if a node is an `Text` object.
   */
  isText: (node: Node) => node is Text

  /**
   * Get the last leaf node entry in a root node from a path.
   */
  last: (root: Node, path: Path) => NodeEntry

  /**
   * Get the node at a specific path, ensuring it's a leaf text node.
   */
  leaf: (root: Node, path: Path) => Text

  /**
   * Return a generator of the in a branch of the tree, from a specific path.
   *
   * By default the order is top-down, from highest to lowest node in the tree,
   * but you can pass the `reverse: true` option to go bottom-up.
   */
  levels: (
    root: Node,
    path: Path,
    options?: NodeLevelsOptions
  ) => Generator<NodeEntry, void, undefined>

  /**
   * Check if a node matches a set of props.
   */
  matches: (node: Node, props: Partial<Node>) => boolean

  /**
   * Return a generator of all the node entries of a root node. Each entry is
   * returned as a `[Node, Path]` tuple, with the path referring to the node's
   * position inside the root node.
   */
  nodes: (
    root: Node,
    options?: NodeNodesOptions
  ) => Generator<NodeEntry, void, undefined>

  /**
   * Get the parent of a node at a specific path.
   */
  parent: (root: Node, path: Path) => Ancestor

  /**
   * Get the concatenated text string of a node's content.
   *
   * Note that this will not include spaces or line breaks between block nodes.
   * It is not a user-facing string, but a string for performing offset-related
   * computations for a node.
   */
  string: (node: Node) => string

  /**
   * Return a generator of all leaf text nodes in a root node.
   */
  texts: (
    root: Node,
    options?: NodeTextsOptions
  ) => Generator<NodeEntry<Text>, void, undefined>
}

const getAncestorChildren = (node: Ancestor): Descendant[] =>
  Node.isEditor(node) ? Editor.getChildren(node) : node.children

// eslint-disable-next-line no-redeclare
export const Node: NodeInterface = {
  ancestor(root: Node, path: Path): Ancestor {
    const node = Node.get(root, path)

    if (Node.isText(node)) {
      throw new Error(
        `Cannot get the ancestor node at path [${path}] because it refers to a text node instead: ${Scrubber.stringify(
          node
        )}`
      )
    }

    return node
  },

  *ancestors(
    root: Node,
    path: Path,
    options: NodeAncestorsOptions = {}
  ): Generator<NodeEntry<Ancestor>, void, undefined> {
    for (const p of Path.ancestors(path, options)) {
      const n = Node.ancestor(root, p)
      const entry: NodeEntry<Ancestor> = [n, p]
      yield entry
    }
  },

  child(root: Node, index: number): Descendant {
    if (Node.isText(root)) {
      throw new Error(
        `Cannot get the child of a text node: ${Scrubber.stringify(root)}`
      )
    }

    if (typeof index !== 'number') {
      throw new Error('Expected index to be a number')
    }

    const c = getAncestorChildren(root)[index] as Descendant

    if (c == null) {
      throw new Error(
        `Cannot get child at index \`${index}\` in node: ${Scrubber.stringify(
          root
        )}`
      )
    }

    return c
  },

  *children(
    root: Node,
    path: Path,
    options: NodeChildrenOptions = {}
  ): Generator<NodeEntry<Descendant>, void, undefined> {
    const { reverse = false } = options
    const ancestor = Node.ancestor(root, path)
    const children = getAncestorChildren(ancestor)
    let index = reverse ? children.length - 1 : 0

    while (reverse ? index >= 0 : index < children.length) {
      const child = Node.child(ancestor, index)
      const childPath = path.concat(index)
      yield [child, childPath]
      index = reverse ? index - 1 : index + 1
    }
  },

  common(root: Node, path: Path, another: Path): NodeEntry {
    const p = Path.common(path, another)
    const n = Node.get(root, p)
    return [n, p]
  },

  descendant(root: Node, path: Path): Descendant {
    const node = Node.get(root, path)

    if (Node.isEditor(node)) {
      throw new Error(
        `Cannot get the descendant node at path [${path}] because it refers to the root editor node instead: ${Scrubber.stringify(
          node
        )}`
      )
    }

    return node
  },

  *descendants(
    root: Node,
    options: NodeDescendantsOptions = {}
  ): Generator<NodeEntry<Descendant>, void, undefined> {
    for (const [node, path] of Node.nodes(root, options)) {
      if (path.length !== 0) {
        // NOTE: we have to coerce here because checking the path's length does
        // guarantee that `node` is not a `Editor`, but TypeScript doesn't know.
        yield [node, path] as NodeEntry<Descendant>
      }
    }
  },

  *elements(
    root: Node,
    options: NodeElementsOptions = {}
  ): Generator<ElementEntry, void, undefined> {
    for (const [node, path] of Node.nodes(root, options)) {
      if (Node.isElement(node)) {
        yield [node, path]
      }
    }
  },

  extractProps(node: Node): NodeProps {
    if (Node.isText(node)) {
      const { text, ...properties } = node

      return properties
    }
    const { children, ...properties } = Node.isEditor(node)
      ? { children: getAncestorChildren(node) }
      : node

    return properties
  },

  first(root: Node, path: Path): NodeEntry {
    const p = path.slice()
    let n = Node.get(root, p)

    while (n) {
      if (Node.isText(n)) {
        break
      }
      const children = getAncestorChildren(n)

      if (children.length === 0) {
        break
      }
      n = children[0]
      p.push(0)
    }

    return [n, p]
  },

  fragment<T extends Ancestor = Editor>(root: T, range: Range): Descendant[] {
    const newRoot = { children: getAncestorChildren(root) }

    const [start, end] = Range.edges(range)
    const nodeEntries = Node.nodes(newRoot as Ancestor, {
      reverse: true,
      pass: ([, path]) => !Range.includes(range, path),
    })

    for (const [, path] of nodeEntries) {
      if (!Range.includes(range, path)) {
        const index = path.at(-1)!

        modifyChildren(newRoot as Ancestor, Path.parent(path), (children) =>
          removeChildren(children, index, 1)
        )
      }

      if (Path.equals(path, end.path)) {
        modifyLeaf(newRoot as Ancestor, path, (node) => {
          const before = node.text.slice(0, end.offset)
          return { ...node, text: before }
        })
      }

      if (Path.equals(path, start.path)) {
        modifyLeaf(newRoot as Ancestor, path, (node) => {
          const before = node.text.slice(start.offset)
          return { ...node, text: before }
        })
      }
    }

    return newRoot.children
  },

  get(root: Node, path: Path): Node {
    const node = Node.getIf(root, path)
    if (node === undefined) {
      throw new Error(
        `Cannot find a descendant at path [${path}] in node: ${Scrubber.stringify(
          root
        )}`
      )
    }
    return node
  },

  getIf(root: Node, path: Path): Node | undefined {
    let node = root

    for (const p of path) {
      if (typeof p !== 'number') {
        throw new Error('Got non-numeric path index')
      }

      if (Node.isText(node)) {
        return
      }

      const child = getAncestorChildren(node)[p]

      if (!child) {
        return
      }

      node = child
    }

    return node
  },

  has(root: Node, path: Path): boolean {
    let node = root

    for (const p of path) {
      if (typeof p !== 'number') {
        throw new Error('Got non-numeric path index')
      }

      if (Node.isText(node)) {
        return false
      }

      const child = getAncestorChildren(node)[p]

      if (!child) {
        return false
      }

      node = child
    }

    return true
  },

  isAncestor(node: Node): node is Ancestor {
    return !Node.isText(node)
  },

  isEditor(node: Node): node is Editor {
    return Editor.isEditor(node)
  },

  isElement(node: Node): node is Element {
    return Array.isArray((node as Element).children) && !Editor.isEditor(node)
  },

  isNode(value: any, { deep = false }: NodeIsNodeOptions = {}): value is Node {
    return (
      Text.isText(value) ||
      Element.isElement(value, { deep }) ||
      Editor.isEditor(value, { deep })
    )
  },

  isNodeList(
    value: any,
    { deep = false }: NodeIsNodeOptions = {}
  ): value is Node[] {
    return (
      Array.isArray(value) && value.every((val) => Node.isNode(val, { deep }))
    )
  },

  isText(node: Node): node is Text {
    return typeof (node as Text).text === 'string'
  },

  last(root: Node, path: Path): NodeEntry {
    const p = path.slice()
    let n = Node.get(root, p)

    while (n) {
      if (Node.isText(n)) {
        break
      }
      const children = getAncestorChildren(n)

      if (children.length === 0) {
        break
      }
      const i = children.length - 1
      n = children[i]
      p.push(i)
    }

    return [n, p]
  },

  leaf(root: Node, path: Path): Text {
    const node = Node.get(root, path)

    if (!Node.isText(node)) {
      throw new Error(
        `Cannot get the leaf node at path [${path}] because it refers to a non-leaf node: ${Scrubber.stringify(
          node
        )}`
      )
    }

    return node
  },

  *levels(
    root: Node,
    path: Path,
    options: NodeLevelsOptions = {}
  ): Generator<NodeEntry, void, undefined> {
    for (const p of Path.levels(path, options)) {
      const n = Node.get(root, p)
      yield [n, p]
    }
  },

  matches(node: Node, props: Partial<Node>): boolean {
    return (
      (Node.isElement(node) &&
        Element.isElementProps(props) &&
        Element.matches(node, props)) ||
      (Node.isText(node) &&
        Text.isTextProps(props) &&
        Text.matches(node, props))
    )
  },

  *nodes(
    root: Node,
    options: NodeNodesOptions = {}
  ): Generator<NodeEntry, void, undefined> {
    const { pass, reverse = false } = options
    const { from = [], to } = options
    const visited = new Set()
    let p: Path = []
    let n = root

    while (true) {
      if (to && (reverse ? Path.isBefore(p, to) : Path.isAfter(p, to))) {
        break
      }

      if (!visited.has(n)) {
        yield [n, p]
      }

      // If we're allowed to go downward and we haven't descended yet, do.
      if (
        !visited.has(n) &&
        !Node.isText(n) &&
        getAncestorChildren(n).length !== 0 &&
        (pass == null || pass([n, p]) === false)
      ) {
        visited.add(n)
        const children = getAncestorChildren(n)
        let nextIndex = reverse ? children.length - 1 : 0

        if (Path.isAncestor(p, from)) {
          nextIndex = from[p.length]
        }

        p = p.concat(nextIndex)
        n = Node.get(root, p)
        continue
      }

      // If we're at the root and we can't go down, we're done.
      if (p.length === 0) {
        break
      }

      // If we're going forward...
      if (!reverse) {
        const newPath = Path.next(p)

        if (Node.has(root, newPath)) {
          p = newPath
          n = Node.get(root, p)
          continue
        }
      }

      // If we're going backward...
      if (reverse && p.at(-1)! !== 0) {
        const newPath = Path.previous(p)
        p = newPath
        n = Node.get(root, p)
        continue
      }

      // Otherwise we're going upward...
      p = Path.parent(p)
      n = Node.get(root, p)
      visited.add(n)
    }
  },

  parent(root: Node, path: Path): Ancestor {
    const parentPath = Path.parent(path)
    const node = Node.get(root, parentPath)

    if (Node.isText(node)) {
      // this can happen if `path` points somewhere that doesnt exist and it's where a child of a text node would be
      throw new Error(
        `Cannot get the parent of path [${path}] because it does not exist in the root.`
      )
    }

    return node
  },

  string(node: Node): string {
    if (Node.isText(node)) {
      return node.text
    }
    return getAncestorChildren(node).map(Node.string).join('')
  },

  *texts(
    root: Node,
    options: NodeTextsOptions = {}
  ): Generator<NodeEntry<Text>, void, undefined> {
    for (const [node, path] of Node.nodes(root, options)) {
      if (Node.isText(node)) {
        yield [node, path]
      }
    }
  },
}

/**
 * The `Descendant` union type represents nodes that are descendants in the
 * tree. It is returned as a convenience in certain cases to narrow a value
 * further than the more generic `Node` union.
 */

export type Descendant = Element | Text

/**
 * The `Ancestor` union type represents nodes that are ancestors in the tree.
 * It is returned as a convenience in certain cases to narrow a value further
 * than the more generic `Node` union.
 */

export type Ancestor = Editor | Element

/**
 * `NodeEntry` objects are returned when iterating over the nodes in a Slate
 * document tree. They consist of the node and its `Path` relative to the root
 * node in the document.
 */

export type NodeEntry<T = Node> = [T, Path]

export type AncestorEntry<N = Node> = NodeEntry<AncestorOf<N>>

export type DescendantEntry<N = Node> = NodeEntry<DescendantOf<N>>

export type NodeChildEntry<N = Node> = NodeEntry<ChildOf<N>>

export type NodeEntryIn<V extends Value> = NodeEntry<NodeIn<V>>

export type NodeEntryOf<E> = NodeEntry<NodeOf<E>>

export type ElementEntryOf<E> = NodeEntry<ElementOf<E>>

export type TextEntry<N = Node> = NodeEntry<TextOf<N>>

export type TextEntryIn<V extends Value> = NodeEntry<TextOf<V[number]>>

export type TextEntryOf<E> = NodeEntry<TextOf<E>>

export type AncestorEntryOf<E> = NodeEntry<AncestorOf<E>>

export type DescendantEntryIn<V extends Value> = NodeEntry<DescendantIn<V>>

export type DescendantEntryOf<E> = NodeEntry<DescendantOf<E>>
