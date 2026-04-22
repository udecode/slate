import {
  type Descendant,
  Editor,
  Element,
  Node,
  type NodeEntry,
  type Operation,
  Text,
} from '../interfaces'
import {
  insertNodes,
  mergeNodes,
  removeNodes,
  wrapNodes,
} from '../transforms-node'

const resolveFallbackElement = (
  fallbackElement: NormalizeNodeOptions['fallbackElement']
) =>
  typeof fallbackElement === 'function' ? fallbackElement() : fallbackElement

type NormalizeNodeOptions = {
  operation?: Operation
  fallbackElement?: Element | (() => Element)
  explicit?: boolean
  force?: boolean
}

const shouldHaveInlineChildren = (editor: Editor, node: Editor | Element) => {
  if (Node.isEditor(node)) {
    return false
  }

  const firstChild = node.children[0]

  return (
    editor.isInline(node) ||
    Text.isText(firstChild) ||
    (Element.isElement(firstChild) && editor.isInline(firstChild))
  )
}

const isInlineChild = (editor: Editor, node: Descendant) =>
  Element.isElement(node) && editor.isInline(node)

const isTextChild = (
  node: Descendant
): node is Extract<Descendant, { text: string }> => Text.isText(node)

const collectInlineCompatibleDescendants = (
  editor: Editor,
  node: Descendant
): Descendant[] => {
  if (Text.isText(node) || isInlineChild(editor, node)) {
    return [node]
  }

  return node.children.flatMap((child) =>
    collectInlineCompatibleDescendants(editor, child)
  )
}

const normalizeExplicitInlineChildren = (
  editor: Editor,
  node: Editor | Element,
  path: readonly number[]
) => {
  let didMutate = false
  let currentNode: Editor | Element = node

  const refreshNode = () => {
    currentNode = Editor.node(editor, [...path])[0] as Editor | Element
  }

  while (true) {
    let mutatedThisRound = false

    for (let index = currentNode.children.length - 1; index >= 0; index -= 1) {
      const child = currentNode.children[index]!

      if (isTextChild(child) || isInlineChild(editor, child)) {
        continue
      }

      const replacement = collectInlineCompatibleDescendants(editor, child)

      removeNodes(editor, { at: [...path, index], voids: true })

      if (replacement.length > 0) {
        insertNodes(editor, replacement, { at: [...path, index], voids: true })
      }

      mutatedThisRound = true
      didMutate = true
    }

    if (mutatedThisRound) {
      refreshNode()
      continue
    }

    const skippedIndexes = new Set<number>()

    for (let index = currentNode.children.length - 1; index > 0; index -= 1) {
      if (skippedIndexes.has(index)) {
        continue
      }

      const child = currentNode.children[index]!

      if (!isTextChild(child)) {
        continue
      }

      const prevIndex = index - 1

      if (skippedIndexes.has(prevIndex)) {
        continue
      }

      const prev = currentNode.children[prevIndex]!

      if (!isTextChild(prev)) {
        continue
      }

      if (child.text === '') {
        removeNodes(editor, { at: [...path, index], voids: true })
        skippedIndexes.add(index)
        mutatedThisRound = true
        didMutate = true
        continue
      }

      if (prev.text === '') {
        removeNodes(editor, { at: [...path, prevIndex], voids: true })
        skippedIndexes.add(prevIndex)
        mutatedThisRound = true
        didMutate = true
        continue
      }

      if (Text.equals(child, prev, { loose: true })) {
        mergeNodes(editor, { at: [...path, index], voids: true })
        skippedIndexes.add(index)
        mutatedThisRound = true
        didMutate = true
      }
    }

    if (mutatedThisRound) {
      refreshNode()
      continue
    }

    const spacerInsertions = new Set<number>()

    for (const [index, child] of currentNode.children.entries()) {
      if (!isInlineChild(editor, child)) {
        continue
      }

      const prev = currentNode.children[index - 1]
      const next = currentNode.children[index + 1]

      if (!prev || !isTextChild(prev)) {
        spacerInsertions.add(index)
      }

      if (!next || !isTextChild(next)) {
        spacerInsertions.add(index + 1)
      }
    }

    if (spacerInsertions.size === 0) {
      return didMutate
    }

    for (const index of Array.from(spacerInsertions).sort((a, b) => b - a)) {
      insertNodes(editor, { text: '' }, { at: [...path, index], voids: true })
    }

    refreshNode()
    didMutate = true
  }
}

const isDirectChildPath = (
  parentPath: readonly number[],
  childPath: readonly number[]
) =>
  childPath.length === parentPath.length + 1 &&
  parentPath.every((segment, index) => segment === childPath[index])

const insertsDirectBlockOnlyChild = (
  editor: Editor,
  path: readonly number[],
  operation?: Operation
) =>
  operation?.type === 'insert_node' &&
  isDirectChildPath(path, operation.path) &&
  !Text.isText(operation.node) &&
  !isInlineChild(editor, operation.node)

const getBlockOnlyChildIndexesToValidate = (
  path: readonly number[],
  operation?: import('../interfaces').Operation
) => {
  if (!operation) {
    return null
  }

  switch (operation.type) {
    case 'set_node':
    case 'insert_node':
      return isDirectChildPath(path, operation.path)
        ? [operation.path[path.length]]
        : null
    case 'remove_node':
      return isDirectChildPath(path, operation.path) ? [] : null
    case 'move_node': {
      const removesFromParent = isDirectChildPath(path, operation.path)
      const insertsIntoParent = isDirectChildPath(path, operation.newPath)

      if (!removesFromParent && !insertsIntoParent) {
        return null
      }

      if (removesFromParent && insertsIntoParent) {
        return []
      }

      return insertsIntoParent ? [operation.newPath[path.length]] : []
    }
    default:
      return null
  }
}

export const normalizeNode = (
  editor: Editor,
  entry: NodeEntry,
  options: NormalizeNodeOptions = {}
) => {
  const { fallbackElement } = options
  const [node, path] = entry

  if (Text.isText(node)) {
    return
  }

  if (!Node.isEditor(node) && node.children.length === 0) {
    insertNodes(editor, { text: '' }, { at: [...path, 0] })
    return
  }

  const directChildIndexes = getBlockOnlyChildIndexesToValidate(
    path,
    options.operation
  )
  const allowBroadBlockOnlyScan =
    Array.isArray(directChildIndexes) && directChildIndexes.length === 0

  if (shouldHaveInlineChildren(editor, node)) {
    if (
      options.explicit &&
      normalizeExplicitInlineChildren(editor, node, path)
    ) {
      return
    }

    for (const [index, child] of node.children.entries()) {
      const prev = node.children[index - 1]
      const next = node.children[index + 1]
      const touchesDirectChildCleanup =
        !options.explicit &&
        Array.isArray(directChildIndexes) &&
        insertsDirectBlockOnlyChild(editor, path, options.operation) &&
        (directChildIndexes.includes(index) ||
          directChildIndexes.includes(index - 1))
      const canCanonicalizeAdjacentText =
        (options.explicit || options.operation != null) &&
        !touchesDirectChildCleanup

      if (Text.isText(child) && Text.isText(prev)) {
        if (
          canCanonicalizeAdjacentText &&
          child.text === '' &&
          (!next || Text.isText(next))
        ) {
          removeNodes(editor, { at: [...path, index], voids: true })
          return
        }

        if (
          canCanonicalizeAdjacentText &&
          prev.text === '' &&
          (!node.children[index - 2] || Text.isText(node.children[index - 2]!))
        ) {
          removeNodes(editor, { at: [...path, index - 1], voids: true })
          return
        }

        if (
          canCanonicalizeAdjacentText &&
          Text.equals(child, prev, { loose: true })
        ) {
          mergeNodes(editor, { at: [...path, index], voids: true })
          return
        }
      }

      if (
        touchesDirectChildCleanup &&
        Text.isText(child) &&
        Text.isText(prev)
      ) {
        if (child.text === '') {
          removeNodes(editor, { at: [...path, index], voids: true })
          return
        }

        if (prev.text === '') {
          removeNodes(editor, { at: [...path, index - 1], voids: true })
          return
        }
      }

      if (
        Array.isArray(directChildIndexes) &&
        directChildIndexes.includes(index) &&
        !Text.isText(child) &&
        !isInlineChild(editor, child)
      ) {
        const replacement = collectInlineCompatibleDescendants(editor, child)

        removeNodes(editor, { at: [...path, index], voids: true })

        if (replacement.length > 0) {
          insertNodes(editor, replacement, {
            at: [...path, index],
            voids: true,
          })
        }

        return
      }

      if (!isInlineChild(editor, child)) {
        continue
      }

      if (!prev || !Text.isText(prev)) {
        insertNodes(editor, { text: '' }, { at: [...path, index], voids: true })
        return
      }

      if (!next || !Text.isText(next)) {
        insertNodes(
          editor,
          { text: '' },
          { at: [...path, index + 1], voids: true }
        )
        return
      }
    }

    return
  }

  if (Array.isArray(directChildIndexes)) {
    if (directChildIndexes.length === 0) {
      if (!fallbackElement && options.operation) {
        // A direct-child remove/move can expose additional invalid siblings.
        // Fall through to the broader scan instead of exiting early.
      } else if (!fallbackElement) {
        return
      }
    }

    for (const index of directChildIndexes) {
      const child = node.children[index]

      if (!child || (!Text.isText(child) && !isInlineChild(editor, child))) {
        continue
      }

      if (!fallbackElement) {
        removeNodes(editor, { at: [...path, index] })
        return
      }

      const wrapper = resolveFallbackElement(fallbackElement)

      if (!wrapper) {
        return
      }

      wrapNodes(editor, wrapper, {
        at: [...path, index],
      })
      return
    }

    if (!fallbackElement && !allowBroadBlockOnlyScan) {
      return
    }
  }

  if (!fallbackElement && options.operation && !allowBroadBlockOnlyScan) {
    return
  }

  for (const [index, child] of node.children.entries()) {
    if (!Text.isText(child) && !isInlineChild(editor, child)) {
      continue
    }

    const wrapper = resolveFallbackElement(fallbackElement)

    if (!wrapper) {
      removeNodes(editor, { at: [...path, index] })
      return
    }

    wrapNodes(editor, wrapper, {
      at: [...path, index],
    })
    return
  }
}
