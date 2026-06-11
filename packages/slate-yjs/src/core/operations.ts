import type { Operation, Path } from 'slate'
import * as Y from 'yjs'

import {
  getSlateYjsElementType,
  hasYjsAttributes,
  toYjsAttributeRecord,
  type YjsNode,
} from './attributes'
import {
  cloneVisibleYjsNodes,
  createVirtualYjsMovePlaceholder,
  createYjsNode,
  createYjsNodes,
  createYjsText,
  getYjsChildren,
  getYjsLength,
  getYjsNode,
  getYjsNodeIf,
  getYjsParent,
  getYjsTextContent,
  getYjsVisibleChildren,
  hideYjsNode,
  insertYjsChild,
  isVirtualYjsChild,
  removeYjsChild,
  removeYjsVirtualPlaceholderChild,
  replaceYjsChildren,
  setVirtualYjsMove,
  setVirtualYjsUnwrapMove,
} from './document'
import { pathsEqual } from './path'
import { isRecord } from './record'
import {
  createSplitElement,
  isNoopSlateOperationForYjs as isNoopOperationForYjs,
  replaceCompatibleYjsChildren,
  setYjsNodeAttributes,
} from './replacement'
import type { YjsTraceEntry, YjsTraceFallback } from './types'

export { isNoopSlateOperationForYjs } from './replacement'

const materializeEmptyYjsText = (
  root: Y.XmlElement,
  path: Path
): Y.XmlText | null => {
  const index = path.at(-1)

  if (index !== 0) {
    return null
  }

  const parentPath = path.slice(0, -1)
  const parent = getYjsNodeIf(root, parentPath)

  if (!(parent instanceof Y.XmlElement)) {
    return null
  }
  if (getYjsVisibleChildren(root, parent).length > 0) {
    return null
  }

  const text = createYjsText('', {})

  insertYjsChild(root, parent, 0, text)

  return text
}

const getYjsTextForInsert = (
  root: Y.XmlElement,
  path: Path
): Y.XmlText | null => {
  const target = getYjsNodeIf(root, path)

  if (target instanceof Y.XmlText) {
    return target
  }
  if (target !== null) {
    return null
  }

  return materializeEmptyYjsText(root, path)
}

type YjsTextPoint = {
  readonly childIndex: number
  readonly offset: number
  readonly parent: Y.XmlElement
}

const resolveYjsTextPoint = (
  root: Y.XmlElement,
  path: Path,
  offset: number
): YjsTextPoint | null => {
  const target = getYjsNode(root, path)

  if (!(target instanceof Y.XmlText)) {
    throw new Error('remove_text target is not a Y.XmlText.')
  }

  const { index, parent } = getYjsParent(root, path)
  const children = getYjsVisibleChildren(root, parent)
  let remainingOffset = offset

  for (let childIndex = index; childIndex < children.length; childIndex++) {
    const child = children[childIndex]

    if (!(child instanceof Y.XmlText)) {
      break
    }

    const length = getYjsLength(child)

    if (remainingOffset <= length) {
      return { childIndex, offset: remainingOffset, parent }
    }

    remainingOffset -= length
  }

  return null
}

const deleteYjsTextRange = (
  root: Y.XmlElement,
  path: Path,
  offset: number,
  length: number
): void => {
  const point = resolveYjsTextPoint(root, path, offset)

  if (point === null) {
    return
  }

  let childIndex = point.childIndex
  let deleteOffset = point.offset
  let remainingLength = length

  while (remainingLength > 0) {
    const child = getYjsVisibleChildren(root, point.parent)[childIndex]

    if (!(child instanceof Y.XmlText)) {
      break
    }

    const availableLength = getYjsLength(child) - deleteOffset
    const deleteLength = Math.min(availableLength, remainingLength)
    let removedEmptyText = false

    if (deleteLength > 0) {
      child.delete(deleteOffset, deleteLength)
      remainingLength -= deleteLength
      removedEmptyText = removeRedundantEmptyYjsText(
        root,
        point.parent,
        childIndex,
        child
      )
    }

    if (remainingLength > 0) {
      if (!removedEmptyText) {
        childIndex++
      }
      deleteOffset = 0
    }
  }
}

const isEmptyYjsText = (node: YjsNode): boolean =>
  node instanceof Y.XmlText && getYjsTextContent(node).length === 0

const removeRedundantEmptyYjsText = (
  root: Y.XmlElement,
  parent: Y.XmlElement,
  index: number,
  text: Y.XmlText
): boolean => {
  if (!isEmptyYjsText(text) || hasYjsAttributes(text)) {
    return false
  }
  if (getYjsVisibleChildren(root, parent).length <= 1) {
    return false
  }

  removeYjsChild(root, parent, index)

  return true
}

type YjsElementChildKind = 'element' | 'empty' | 'mixed' | 'text'

const getYjsElementChildKind = (
  root: Y.XmlElement,
  element: Y.XmlElement
): YjsElementChildKind => {
  let kind: YjsElementChildKind = 'empty'

  for (const child of getYjsVisibleChildren(root, element)) {
    const childKind = child instanceof Y.XmlText ? 'text' : 'element'

    if (kind === 'empty') {
      kind = childKind
      continue
    }

    if (kind !== childKind) {
      return 'mixed'
    }
  }

  return kind
}

const canMergeYjsElements = (
  root: Y.XmlElement,
  previous: Y.XmlElement,
  target: Y.XmlElement
): boolean => {
  if (getSlateYjsElementType(previous) !== getSlateYjsElementType(target)) {
    return false
  }

  const previousKind = getYjsElementChildKind(root, previous)
  const targetKind = getYjsElementChildKind(root, target)

  if (previousKind === 'mixed' || targetKind === 'mixed') {
    return false
  }

  return (
    previousKind === 'empty' ||
    targetKind === 'empty' ||
    previousKind === targetKind
  )
}

const getUnsupportedOperationType = (operation: unknown): string => {
  const operationType = isRecord(operation) ? operation.type : undefined

  return typeof operationType === 'string' ? operationType : 'unknown'
}

const unsupportedYjsOperation = (operation: never): never => {
  throw new Error(
    `Unsupported Yjs operation: ${getUnsupportedOperationType(operation)}`
  )
}

const operationTrace = (operation: Operation): YjsTraceEntry => ({
  mode: 'operation',
  operationType: operation.type,
})

const traceableFallback = (
  operation: Operation,
  fallback: YjsTraceFallback
): YjsTraceEntry => ({
  fallback,
  mode: 'traceable-fallback',
  operationType: operation.type,
})

const getYjsElementOperationTarget = (
  root: Y.XmlElement,
  path: Path,
  operationType: string
): Y.XmlElement => {
  const target = getYjsNode(root, path)

  if (!(target instanceof Y.XmlElement)) {
    throw new Error(`${operationType} target is not a Y.XmlElement.`)
  }

  return target
}

export const applySlateOperationToYjs = (
  root: Y.XmlElement,
  operation: Operation
): YjsTraceEntry | null => {
  if (isNoopOperationForYjs(operation)) {
    return null
  }

  switch (operation.type) {
    case 'insert_text': {
      const text = getYjsTextForInsert(root, operation.path)

      if (!(text instanceof Y.XmlText)) {
        throw new Error('insert_text target is not a Y.XmlText.')
      }

      text.insert(operation.offset, operation.text)

      return operationTrace(operation)
    }
    case 'remove_text': {
      deleteYjsTextRange(
        root,
        operation.path,
        operation.offset,
        operation.text.length
      )

      return operationTrace(operation)
    }
    case 'insert_node': {
      const { index, parent } = getYjsParent(root, operation.path)

      insertYjsChild(root, parent, index, createYjsNode(operation.node))

      return operationTrace(operation)
    }
    case 'remove_node': {
      const { index, parent } = getYjsParent(root, operation.path)
      const removalMode = removeYjsChild(root, parent, index, operation.node)

      if (removalMode === 'hidden') {
        return traceableFallback(operation, 'virtual-unwrap-wrapper-remove')
      }
      if (removalMode === 'hidden-parent') {
        return traceableFallback(operation, 'virtual-move-parent-remove')
      }

      return operationTrace(operation)
    }
    case 'split_node': {
      const target = getYjsNode(root, operation.path)
      const { index, parent } = getYjsParent(root, operation.path)

      if (target instanceof Y.XmlText) {
        const rightText = getYjsTextContent(target).slice(operation.position)

        if (rightText.length > 0) {
          target.delete(operation.position, rightText.length)
        }

        insertYjsChild(
          root,
          parent,
          index + 1,
          createYjsText(rightText, toYjsAttributeRecord(operation.properties))
        )

        return operationTrace(operation)
      }

      const children = getYjsChildren(target)
      const rightChildren = cloneVisibleYjsNodes(
        root,
        children.slice(operation.position)
      )
      const deleteCount = getYjsLength(target) - operation.position

      if (deleteCount > 0) {
        target.delete(operation.position, deleteCount)
      }

      insertYjsChild(
        root,
        parent,
        index + 1,
        createSplitElement(
          target,
          toYjsAttributeRecord(operation.properties),
          rightChildren
        )
      )

      return operationTrace(operation)
    }
    case 'merge_node': {
      const { index, parent } = getYjsParent(root, operation.path)

      if (index === 0) {
        throw new Error('Cannot merge the first Yjs child.')
      }

      const children = getYjsVisibleChildren(root, parent)
      const previous = children[index - 1]
      const target = children[index]

      if (previous instanceof Y.XmlText && !target) {
        return traceableFallback(operation, 'empty-text-merge-elided')
      }

      if (!previous || !target) {
        throw new Error('Cannot merge a missing Yjs node.')
      }

      if (previous instanceof Y.XmlText && target instanceof Y.XmlText) {
        return traceableFallback(operation, 'text-merge-preserve-yjs-boundary')
      }

      if (previous instanceof Y.XmlElement && target instanceof Y.XmlElement) {
        if (!canMergeYjsElements(root, previous, target)) {
          return traceableFallback(
            operation,
            'incompatible-structural-merge-elided'
          )
        }

        const previousHasVisibleChildren =
          getYjsVisibleChildren(root, previous).length > 0

        for (const moveTarget of getYjsVisibleChildren(root, target)) {
          if (previousHasVisibleChildren && isEmptyYjsText(moveTarget)) {
            continue
          }

          insertYjsChild(
            root,
            previous,
            getYjsLength(previous),
            createVirtualYjsMovePlaceholder(moveTarget)
          )
        }

        removeYjsVirtualPlaceholderChild(root, parent, index, target)
        hideYjsNode(target)

        return traceableFallback(operation, 'virtual-merge-ref')
      }

      throw new Error('Cannot merge Yjs nodes of different kinds.')
    }
    case 'replace_fragment': {
      const target = getYjsElementOperationTarget(
        root,
        operation.path,
        operation.type
      )

      const children = getYjsChildren(target)
      if (
        replaceCompatibleYjsChildren(
          children,
          operation.children,
          operation.newChildren
        )
      ) {
        return operationTrace(operation)
      }

      replaceYjsChildren(target, operation.newChildren)

      return traceableFallback(
        operation,
        'replace-fragment-scoped-replace-identity-risk'
      )
    }
    case 'set_selection':
      return null
    case 'set_node': {
      const node = getYjsNode(root, operation.path)

      setYjsNodeAttributes(
        node,
        toYjsAttributeRecord(operation.properties),
        toYjsAttributeRecord(operation.newProperties)
      )

      return operationTrace(operation)
    }
    case 'replace_children': {
      const target = getYjsElementOperationTarget(
        root,
        operation.path,
        operation.type
      )

      const existingChildren = getYjsVisibleChildren(root, target).slice(
        operation.index,
        operation.index + operation.children.length
      )

      if (
        replaceCompatibleYjsChildren(
          existingChildren,
          operation.children,
          operation.newChildren
        )
      ) {
        return operationTrace(operation)
      }

      const removalModes = operation.children.map((child) =>
        removeYjsChild(root, target, operation.index, child)
      )

      const newChildren = createYjsNodes(operation.newChildren)

      newChildren.forEach((child, offset) => {
        insertYjsChild(root, target, operation.index + offset, child)
      })

      if (removalModes.some((mode) => mode !== 'visible')) {
        return traceableFallback(operation, 'replace-children-virtual-removal')
      }

      return operationTrace(operation)
    }
    case 'move_node': {
      const target = getYjsNodeIf(root, operation.path)
      const sourceIndex = operation.path.at(-1)

      if (target === null) {
        return traceableFallback(operation, 'missing-move-source-elided')
      }

      const sourceParentPath = operation.path.slice(0, -1)
      const sourceParent = getYjsNodeIf(root, sourceParentPath)
      const newParentPath = operation.newPath.slice(0, -1)
      const newIndex = operation.newPath.at(-1)
      const newParent = getYjsNodeIf(root, newParentPath)

      if (
        sourceParent instanceof Y.XmlElement &&
        isVirtualYjsChild(target, sourceParent) &&
        pathsEqual(operation.newPath, sourceParentPath)
      ) {
        const { index: wrapperIndex, parent: wrapperParent } = getYjsParent(
          root,
          sourceParentPath
        )

        setVirtualYjsUnwrapMove(
          root,
          target,
          sourceParent,
          wrapperParent,
          wrapperIndex
        )

        return traceableFallback(operation, 'virtual-unwrap-ref')
      }

      if (!(newParent instanceof Y.XmlElement)) {
        return traceableFallback(operation, 'missing-move-destination-elided')
      }
      if (newIndex === undefined) {
        throw new Error('move_node destination is missing an index.')
      }

      const removeSourceVirtualPlaceholder = (): void => {
        if (
          sourceParent instanceof Y.XmlElement &&
          sourceParent !== newParent &&
          sourceIndex !== undefined
        ) {
          removeYjsVirtualPlaceholderChild(
            root,
            sourceParent,
            sourceIndex,
            target
          )
        }
      }

      if (
        sourceParent instanceof Y.XmlElement &&
        sourceParent === newParent &&
        sourceIndex !== undefined
      ) {
        removeYjsVirtualPlaceholderChild(
          root,
          sourceParent,
          sourceIndex,
          target
        )
      }
      const newParentChildren = getYjsVisibleChildren(root, newParent)
      const firstNewParentChild = newParentChildren[0]

      if (
        newIndex === 0 &&
        newParentChildren.length === 1 &&
        firstNewParentChild &&
        isEmptyYjsText(firstNewParentChild)
      ) {
        removeYjsChild(root, newParent, 0)
      }

      if (newIndex === 0 && getYjsLength(newParent) === 0) {
        setVirtualYjsMove(root, target, newParent)
        removeSourceVirtualPlaceholder()

        return traceableFallback(operation, 'virtual-move-ref')
      }

      insertYjsChild(
        root,
        newParent,
        newIndex,
        createVirtualYjsMovePlaceholder(target)
      )
      removeSourceVirtualPlaceholder()

      return traceableFallback(operation, 'virtual-move-placeholder')
    }
  }

  return unsupportedYjsOperation(operation)
}
