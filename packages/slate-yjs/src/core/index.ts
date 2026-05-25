import {
  type Descendant,
  defineEditorExtension,
  type Editor,
  type EditorCommit,
  type EditorExtension,
  type EditorExtensionRuntimeState,
  type EditorUpdateOptions,
  type Operation,
  OperationApi,
  PathApi,
  type Range,
  type Selection,
  TextApi,
  type Value,
} from 'slate'
import * as Y from 'yjs'

const ELEMENT_NODE_NAME = 'slate-element'
const EMPTY_TEXT_ATTRIBUTES = 'slate:empty-text-attributes'
const DELETED_ATTRIBUTE = 'slate:deleted'
const TEXT_LEAVES_ATTRIBUTE = 'slate:text-leaves'
const VERSION_ATTRIBUTE = 'slate:version'
const STACK_OPERATIONS = 'slate-yjs-operations'
const STACK_SELECTION_BEFORE = 'slate-yjs-selection-before'

export const REMOTE_IMPORT_OPTIONS = {
  metadata: {
    collab: { origin: 'remote', saveToHistory: false },
    history: { mode: 'skip' },
    selection: { dom: 'preserve', focus: false, scroll: false },
  },
  tag: ['collaboration', 'remote-import'],
} satisfies EditorUpdateOptions

export type SlateYjsConnection = 'connected' | 'disconnected' | 'paused'

export type SlateYjsAwareness = {
  clientID: number
  getStates: () => Map<number, Record<string, unknown>>
  off: (event: 'change', listener: () => void) => void
  on: (event: 'change', listener: () => void) => void
  setLocalStateField: (field: string, value: unknown) => void
}

export type SlateYjsState = {
  connection: SlateYjsConnection
  exports: number
  imports: number
  revision: number
}

export type SlateYjsRemoteCursorState = {
  clientId: number
  data: unknown
  range: Range | null
  user: unknown
}

export type SlateYjsStateApi = {
  controller: () => SlateYjsController
  getRemoteCursorStates: () => SlateYjsRemoteCursorState[]
  getState: () => SlateYjsState
  subscribe: (listener: () => void) => () => void
}

export type SlateYjsTxApi = {
  connect: () => void
  disconnect: () => void
  exportSelection: (selection?: Selection) => void
  pause: () => void
  reconcile: () => void
  redo: () => boolean
  resume: () => void
  sync: () => void
  undo: () => boolean
}

export type SlateYjsController = SlateYjsTxApi & {
  extension: EditorExtension
  getRemoteCursorStates: () => SlateYjsRemoteCursorState[]
  getState: () => SlateYjsState
  subscribe: (listener: () => void) => () => void
}

export type SlateYjsOptions = {
  awareness?: SlateYjsAwareness | null
  awarenessField?: string
  autoConnect?: boolean
  cursorDataField?: string
  origin?: unknown
  sharedRoot: Y.XmlElement
  undoManager?: Y.UndoManager
}

export type SlateYjsRelativePoint = readonly number[]

export type SlateYjsRelativeRange = {
  anchor: SlateYjsRelativePoint
  focus: SlateYjsRelativePoint
}

declare module 'slate' {
  interface EditorStateExtensionGroups<V extends Value = Value> {
    yjs: SlateYjsStateApi
  }

  interface EditorTxExtensionGroups<V extends Value = Value> {
    yjs: SlateYjsTxApi
  }
}

type TextLeaf = {
  end: number
  path: number[]
  start: number
  text: string
}

type YjsTextLeaf = TextLeaf & {
  sharedText: Y.XmlText
}

type TextLeafMetadata = {
  attributes?: Record<string, unknown>
  length: number
}

type SlateTextLeafRecord = Record<string, unknown> & {
  text: string
}

type YjsTextDeltaEntry = {
  attributes?: unknown
  insert?: unknown
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const hasOwn = (value: object, key: string) => Object.hasOwn(value, key)

const defaultValue = (): Value => [
  { type: 'paragraph', children: [{ text: '' }] },
]

const normalizeValue = (value: Value | null): Value => {
  if (Array.isArray(value) && value.length > 0) {
    return clone(value) as Value
  }

  return defaultValue()
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const getEditorSnapshot = (editor: Editor) =>
  editor.read((state) => ({
    children: clone(state.value.get().roots.main ?? defaultValue()) as Value,
    marks: state.marks.get(),
    selection: clone(state.selection.get()) as Selection,
  }))

const getTextNode = (
  value: Value,
  path: readonly number[]
): Record<string, unknown> | null => {
  let node: unknown = { children: value }

  for (const index of path) {
    if (!isRecord(node) || !Array.isArray(node.children)) {
      return null
    }

    node = node.children[index]
  }

  return TextApi.isText(node) ? (node as Record<string, unknown>) : null
}

const getNodeAttributes = (node: Record<string, unknown>) => {
  const attributes: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(node)) {
    if (key !== 'children' && key !== 'text' && value !== undefined) {
      attributes[key] = clone(value)
    }
  }

  return attributes
}

const isYjsXmlElement = (value: unknown): value is Y.XmlElement =>
  value instanceof Y.XmlElement

const isYjsXmlText = (value: unknown): value is Y.XmlText =>
  value instanceof Y.XmlText

const isYjsDeleted = (node: Y.XmlElement | Y.XmlText) => {
  const value = node.getAttribute(DELETED_ATTRIBUTE)

  return value === true || value === 'true'
}

const getYjsAttributes = (node: Y.XmlElement | Y.XmlText) => {
  const attributes: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(node.getAttributes())) {
    if (
      key !== VERSION_ATTRIBUTE &&
      key !== DELETED_ATTRIBUTE &&
      key !== EMPTY_TEXT_ATTRIBUTES &&
      key !== TEXT_LEAVES_ATTRIBUTE
    ) {
      attributes[key] = clone(value)
    }
  }

  return attributes
}

const createTextLeafMetadata = (
  leaves: Record<string, unknown>[]
): TextLeafMetadata[] =>
  leaves.map((leaf) => {
    const attributes = getNodeAttributes(leaf)

    return {
      ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
      length: typeof leaf.text === 'string' ? leaf.text.length : 0,
    }
  })

const createYjsText = (leaves: Record<string, unknown>[]) => {
  const sharedText = new Y.XmlText()
  const delta = leaves
    .filter((leaf) => typeof leaf.text === 'string' && leaf.text.length > 0)
    .map((leaf) => {
      const attributes = getNodeAttributes(leaf)

      return Object.keys(attributes).length > 0
        ? { insert: leaf.text as string, attributes }
        : { insert: leaf.text as string }
    })

  if (delta.length > 0) {
    sharedText.applyDelta(delta, { sanitize: false })
  } else {
    sharedText.setAttribute(
      EMPTY_TEXT_ATTRIBUTES,
      getNodeAttributes(leaves[0] ?? { text: '' })
    )
  }
  sharedText.setAttribute(TEXT_LEAVES_ATTRIBUTE, createTextLeafMetadata(leaves))

  return sharedText
}

const createYjsElement = (node: Record<string, unknown>) => {
  const sharedElement = new Y.XmlElement(ELEMENT_NODE_NAME)

  for (const [key, value] of Object.entries(getNodeAttributes(node))) {
    sharedElement.setAttribute(key, value as string)
  }

  const children = Array.isArray(node.children)
    ? slateNodesToYjsChildren(node.children as Descendant[])
    : [createYjsText([{ text: '' }])]

  if (children.length > 0) {
    sharedElement.insert(0, children)
  }

  return sharedElement
}

const slateNodesToYjsChildren = (nodes: Descendant[]) => {
  const children: Array<Y.XmlElement | Y.XmlText> = []
  let pendingTextLeaves: Record<string, unknown>[] = []

  const flushTextLeaves = () => {
    if (pendingTextLeaves.length === 0) {
      return
    }

    children.push(createYjsText(pendingTextLeaves))
    pendingTextLeaves = []
  }

  for (const node of nodes) {
    if (TextApi.isText(node)) {
      pendingTextLeaves.push(node as Record<string, unknown>)
      continue
    }

    flushTextLeaves()
    children.push(createYjsElement(node as Record<string, unknown>))
  }

  flushTextLeaves()

  return children
}

const replaceYjsChildren = (
  sharedRoot: Y.XmlElement,
  children: Array<Y.XmlElement | Y.XmlText>
) => {
  if (sharedRoot.length > 0) {
    sharedRoot.delete(0, sharedRoot.length)
  }
  if (children.length > 0) {
    sharedRoot.insert(0, children)
  }
}

const writeSlateValueToYjsUnchecked = (
  sharedRoot: Y.XmlElement,
  value: Value
): void => {
  const nextValue = normalizeValue(value)

  replaceYjsChildren(sharedRoot, slateNodesToYjsChildren(nextValue))
  sharedRoot.setAttribute(
    VERSION_ATTRIBUTE,
    String(Number(sharedRoot.getAttribute(VERSION_ATTRIBUTE) ?? 0) + 1)
  )
}

export const writeSlateValueToYjs = (
  sharedRoot: Y.XmlElement,
  value: Value
): void => {
  if (sharedRoot.doc) {
    sharedRoot.doc.transact(() => {
      writeSlateValueToYjsUnchecked(sharedRoot, value)
    })
  } else {
    writeSlateValueToYjsUnchecked(sharedRoot, value)
  }
}

const getPlainTextFromDelta = (delta: YjsTextDeltaEntry[]) =>
  delta
    .flatMap((entry) =>
      typeof entry.insert === 'string' ? [entry.insert] : []
    )
    .join('')

const isTextLeafMetadataList = (value: unknown): value is TextLeafMetadata[] =>
  Array.isArray(value) &&
  value.every(
    (entry) =>
      isRecord(entry) &&
      typeof entry.length === 'number' &&
      entry.length >= 0 &&
      (entry.attributes === undefined || isRecord(entry.attributes))
  )

const readYjsText = (sharedText: Y.XmlText): SlateTextLeafRecord[] => {
  const delta = sharedText.toDelta() as YjsTextDeltaEntry[]
  const plainText = getPlainTextFromDelta(delta)
  const metadata = sharedText.getAttribute(TEXT_LEAVES_ATTRIBUTE)

  if (isTextLeafMetadataList(metadata)) {
    const metadataLength = metadata.reduce(
      (sum, entry) => sum + entry.length,
      0
    )

    if (metadataLength === plainText.length) {
      let offset = 0

      return metadata.map((entry) => {
        const text = plainText.slice(offset, offset + entry.length)

        offset += entry.length

        return {
          ...(entry.attributes ? clone(entry.attributes) : {}),
          text,
        }
      })
    }
  }

  const leaves = delta.flatMap((entry) =>
    typeof entry.insert === 'string'
      ? [
          {
            ...(isRecord(entry.attributes) ? clone(entry.attributes) : {}),
            text: entry.insert,
          },
        ]
      : []
  )

  if (leaves.length > 0) {
    return leaves
  }

  const attributes = sharedText.getAttribute(EMPTY_TEXT_ATTRIBUTES)

  return [
    {
      ...(isRecord(attributes) ? clone(attributes) : {}),
      text: '',
    },
  ]
}

const readYjsNode = (node: Y.XmlElement | Y.XmlText): Descendant[] => {
  if (isYjsDeleted(node)) {
    return []
  }

  if (isYjsXmlText(node)) {
    return readYjsText(node) as Descendant[]
  }

  const children = node
    .toArray()
    .flatMap((child) =>
      isYjsXmlElement(child) || isYjsXmlText(child) ? readYjsNode(child) : []
    )
  const attributes = getYjsAttributes(node)

  return [
    {
      ...attributes,
      type: typeof attributes.type === 'string' ? attributes.type : 'paragraph',
      children: children.length > 0 ? children : [{ text: '' }],
    } as Descendant,
  ]
}

export const readSlateValueFromYjs = (
  sharedRoot: Y.XmlElement
): Value | null => {
  if (sharedRoot.length === 0) {
    return null
  }

  return normalizeValue(
    sharedRoot
      .toArray()
      .flatMap((child) =>
        isYjsXmlElement(child) || isYjsXmlText(child) ? readYjsNode(child) : []
      ) as Value
  )
}

const getYjsTextLeaves = (sharedRoot: Y.XmlElement): YjsTextLeaf[] => {
  const leaves: YjsTextLeaf[] = []

  const visitChildren = (parent: Y.XmlElement, path: number[]) => {
    let slateIndex = 0

    for (const child of parent.toArray()) {
      if (isYjsXmlText(child) && isYjsDeleted(child)) {
        continue
      }

      if (isYjsXmlText(child)) {
        let offset = 0
        const textLeaves = readYjsText(child)

        textLeaves.forEach((leaf) => {
          const text = leaf.text
          const start = offset

          offset += text.length
          leaves.push({
            end: offset,
            path: [...path, slateIndex],
            sharedText: child,
            start,
            text,
          })
          slateIndex++
        })
        continue
      }

      if (isYjsXmlElement(child)) {
        if (isYjsDeleted(child)) {
          continue
        }
        visitChildren(child, [...path, slateIndex])
        slateIndex++
      }
    }
  }

  visitChildren(sharedRoot, [])

  if (leaves.length === 0) {
    leaves.push({
      end: 0,
      path: [0, 0],
      sharedText: new Y.XmlText(),
      start: 0,
      text: '',
    })
  }

  return leaves
}

const getSlateTextGroups = (nodes: Descendant[]) => {
  const groups: Record<string, unknown>[][] = []

  const visit = (children: Descendant[]) => {
    let pendingTextLeaves: Record<string, unknown>[] = []

    const flush = () => {
      if (pendingTextLeaves.length > 0) {
        groups.push(pendingTextLeaves)
        pendingTextLeaves = []
      }
    }

    for (const child of children) {
      if (TextApi.isText(child)) {
        pendingTextLeaves.push(child as Record<string, unknown>)
        continue
      }

      flush()
      if (isRecord(child) && Array.isArray(child.children)) {
        visit(child.children as Descendant[])
      }
    }

    flush()
  }

  visit(nodes)

  return groups
}

const getYjsTextNodes = (sharedRoot: Y.XmlElement) => {
  const textNodes: Y.XmlText[] = []

  const visit = (parent: Y.XmlElement) => {
    for (const child of parent.toArray()) {
      if (isYjsXmlText(child)) {
        if (isYjsDeleted(child)) {
          continue
        }
        textNodes.push(child)
      } else if (isYjsXmlElement(child)) {
        if (isYjsDeleted(child)) {
          continue
        }
        visit(child)
      }
    }
  }

  visit(sharedRoot)

  return textNodes
}

const syncYjsTextMetadataFromValue = (
  sharedRoot: Y.XmlElement,
  value: Value
) => {
  const textNodes = getYjsTextNodes(sharedRoot)
  const textGroups = getSlateTextGroups(value)

  textNodes.forEach((textNode, index) => {
    const group = textGroups[index]

    if (group) {
      textNode.setAttribute(
        TEXT_LEAVES_ATTRIBUTE,
        createTextLeafMetadata(group)
      )
    }
  })
}

const pointToYjsTextPosition = (
  sharedRoot: Y.XmlElement,
  point: Range['anchor']
) => {
  const leaf = getYjsTextLeaves(sharedRoot).find((entry) =>
    PathApi.equals(entry.path, point.path)
  )

  if (!leaf) {
    throw new Error(`Cannot map Slate point at ${point.path.join('.')} to Yjs`)
  }
  if (point.offset < 0 || point.offset > leaf.text.length) {
    throw new Error(`Cannot map Slate point with offset ${point.offset} to Yjs`)
  }

  return {
    index: leaf.start + point.offset,
    sharedText: leaf.sharedText,
  }
}

const encodeRelativePosition = (position: Y.RelativePosition): number[] =>
  Array.from(Y.encodeRelativePosition(position))

const decodeRelativePosition = (
  position: SlateYjsRelativePoint
): Y.RelativePosition => Y.decodeRelativePosition(Uint8Array.from(position))

class SlateYjsSelectionBinding {
  private readonly sharedRoot: Y.XmlElement
  private textLeaves: YjsTextLeaf[] = []

  constructor(sharedRoot: Y.XmlElement) {
    this.sharedRoot = sharedRoot
    this.rebuild()
  }

  rebuild() {
    this.textLeaves = getYjsTextLeaves(this.sharedRoot)
  }

  slatePointToYjs(point: Range['anchor']) {
    const leaf = this.textLeaves.find((entry) =>
      PathApi.equals(entry.path, point.path)
    )

    if (!leaf) {
      throw new Error(
        `Cannot map Slate point at ${point.path.join('.')} to Yjs`
      )
    }
    if (point.offset < 0 || point.offset > leaf.text.length) {
      throw new Error(
        `Cannot map Slate point with offset ${point.offset} to Yjs`
      )
    }

    return {
      index: leaf.start + point.offset,
      sharedText: leaf.sharedText,
    }
  }

  slateRangeToYjs(_value: Value, range: Range): SlateYjsRelativeRange {
    const anchor = this.slatePointToYjs(range.anchor)
    const focus = this.slatePointToYjs(range.focus)

    return {
      anchor: encodeRelativePosition(
        Y.createRelativePositionFromTypeIndex(
          anchor.sharedText,
          anchor.index,
          0
        )
      ),
      focus: encodeRelativePosition(
        Y.createRelativePositionFromTypeIndex(focus.sharedText, focus.index, -1)
      ),
    }
  }

  textPositionToSlatePoint(
    sharedText: Y.XmlText,
    index: number,
    assoc = 0
  ): Range['anchor'] | null {
    const leaves = this.textLeaves.filter(
      (entry) => entry.sharedText === sharedText
    )
    const boundedIndex = Math.max(0, Math.min(index, leaves.at(-1)?.end ?? 0))

    if (assoc < 0) {
      for (let i = leaves.length - 1; i >= 0; i--) {
        const leaf = leaves[i]!

        if (boundedIndex >= leaf.start && boundedIndex <= leaf.end) {
          return {
            path: [...leaf.path],
            offset: Math.min(leaf.text.length, boundedIndex - leaf.start),
          }
        }
      }
    }

    for (const leaf of leaves) {
      if (boundedIndex >= leaf.start && boundedIndex <= leaf.end) {
        return {
          path: [...leaf.path],
          offset: Math.max(0, boundedIndex - leaf.start),
        }
      }
    }

    const last = leaves.at(-1)

    return last ? { path: [...last.path], offset: last.text.length } : null
  }

  yjsRangeToSlate(_value: Value, range: SlateYjsRelativeRange): Range | null {
    const doc = this.sharedRoot.doc

    if (!doc) {
      return null
    }

    const anchor = Y.createAbsolutePositionFromRelativePosition(
      decodeRelativePosition(range.anchor),
      doc
    )
    const focus = Y.createAbsolutePositionFromRelativePosition(
      decodeRelativePosition(range.focus),
      doc
    )

    if (!anchor || !focus) {
      return null
    }
    if (!isYjsXmlText(anchor.type) || !isYjsXmlText(focus.type)) {
      return null
    }

    const anchorPoint = this.textPositionToSlatePoint(
      anchor.type,
      anchor.index,
      anchor.assoc
    )
    const focusPoint = this.textPositionToSlatePoint(
      focus.type,
      focus.index,
      focus.assoc
    )

    return anchorPoint && focusPoint
      ? { anchor: anchorPoint, focus: focusPoint }
      : null
  }
}

export const slateRangeToYjsRelativeRange = (
  sharedRoot: Y.XmlElement,
  value: Value,
  range: Range
): SlateYjsRelativeRange => {
  return new SlateYjsSelectionBinding(sharedRoot).slateRangeToYjs(value, range)
}

export const yjsRelativeRangeToSlateRange = (
  sharedRoot: Y.XmlElement,
  value: Value,
  range: SlateYjsRelativeRange
): Range | null => {
  return new SlateYjsSelectionBinding(sharedRoot).yjsRangeToSlate(value, range)
}

const getYjsChildForSlateIndex = (
  parent: Y.XmlElement,
  slateIndex: number
): Y.XmlElement | Y.XmlText | null => {
  let currentSlateIndex = 0

  for (const child of parent.toArray()) {
    if (isYjsXmlText(child)) {
      if (isYjsDeleted(child)) {
        continue
      }
      const leafCount = readYjsText(child).length

      if (
        slateIndex >= currentSlateIndex &&
        slateIndex < currentSlateIndex + leafCount
      ) {
        return child
      }

      currentSlateIndex += leafCount
      continue
    }

    if (isYjsXmlElement(child)) {
      if (isYjsDeleted(child)) {
        continue
      }
      if (currentSlateIndex === slateIndex) {
        return child
      }

      currentSlateIndex++
    }
  }

  return null
}

const getYjsNodeAtPath = (
  sharedRoot: Y.XmlElement,
  path: readonly number[]
): Y.XmlElement | Y.XmlText | null => {
  let node: Y.XmlElement | Y.XmlText = sharedRoot

  for (const index of path) {
    if (!isYjsXmlElement(node)) {
      return null
    }

    const child = getYjsChildForSlateIndex(node, index)

    if (!child) {
      return null
    }

    node = child
  }

  return node === sharedRoot ? null : node
}

const getYjsChildrenForSlateRange = (
  parent: Y.XmlElement,
  index: number,
  length: number
): Array<Y.XmlElement | Y.XmlText> => {
  const children: Array<Y.XmlElement | Y.XmlText> = []
  let currentSlateIndex = 0

  for (const child of parent.toArray()) {
    if (isYjsXmlText(child)) {
      if (isYjsDeleted(child)) {
        continue
      }

      const leafCount = readYjsText(child).length

      if (
        index < currentSlateIndex + leafCount &&
        currentSlateIndex < index + length
      ) {
        children.push(child)
      }

      currentSlateIndex += leafCount
      continue
    }

    if (isYjsXmlElement(child)) {
      if (isYjsDeleted(child)) {
        continue
      }

      if (currentSlateIndex >= index && currentSlateIndex < index + length) {
        children.push(child)
      }

      currentSlateIndex++
    }
  }

  return children
}

const getYjsParentAtPath = (
  sharedRoot: Y.XmlElement,
  path: readonly number[]
): Y.XmlElement | null => {
  if (path.length === 0) {
    return sharedRoot
  }

  const node = getYjsNodeAtPath(sharedRoot, path)

  return isYjsXmlElement(node) ? node : null
}

const getYjsInsertIndexForSlateIndex = (
  parent: Y.XmlElement,
  slateIndex: number
) => {
  let currentSlateIndex = 0
  let yjsIndex = 0

  for (const child of parent.toArray()) {
    if (isYjsXmlText(child)) {
      if (isYjsDeleted(child)) {
        yjsIndex++
        continue
      }

      const leafCount = readYjsText(child).length

      if (slateIndex <= currentSlateIndex + leafCount - 1) {
        return yjsIndex
      }

      currentSlateIndex += leafCount
      yjsIndex++
      continue
    }

    if (isYjsXmlElement(child)) {
      if (isYjsDeleted(child)) {
        yjsIndex++
        continue
      }

      if (slateIndex <= currentSlateIndex) {
        return yjsIndex
      }

      currentSlateIndex++
      yjsIndex++
    }
  }

  return yjsIndex
}

const applyTextPropertiesToYjs = (
  sharedRoot: Y.XmlElement,
  path: number[],
  properties: Record<string, unknown>,
  newProperties: Record<string, unknown>
) => {
  const leaf = getYjsTextLeaves(sharedRoot).find((entry) =>
    PathApi.equals(entry.path, path)
  )

  if (!leaf) {
    return false
  }

  const attributes: Record<string, unknown> = {}

  for (const key of new Set([
    ...Object.keys(properties),
    ...Object.keys(newProperties),
  ])) {
    attributes[key] = hasOwn(newProperties, key) ? newProperties[key] : null
  }

  leaf.sharedText.format(leaf.start, leaf.text.length, attributes)

  return true
}

const applyElementPropertiesToYjs = (
  sharedRoot: Y.XmlElement,
  path: number[],
  properties: Record<string, unknown>,
  newProperties: Record<string, unknown>
) => {
  const node = getYjsNodeAtPath(sharedRoot, path)

  if (!isYjsXmlElement(node)) {
    return false
  }

  for (const key of new Set([
    ...Object.keys(properties),
    ...Object.keys(newProperties),
  ])) {
    if (hasOwn(newProperties, key)) {
      node.setAttribute(key, clone(newProperties[key]) as string)
    } else {
      node.removeAttribute(key)
    }
  }

  return true
}

const applyReplaceChildrenToYjs = (
  sharedRoot: Y.XmlElement,
  operation: Extract<Operation, { type: 'replace_children' }>
) => {
  const parent = getYjsParentAtPath(sharedRoot, operation.path)

  if (!parent) {
    return false
  }

  const replacedChildren = getYjsChildrenForSlateRange(
    parent,
    operation.index,
    operation.children.length
  )

  if (replacedChildren.length !== operation.children.length) {
    return false
  }

  for (const child of replacedChildren) {
    child.setAttribute(DELETED_ATTRIBUTE, true)
  }

  if (operation.newChildren.length > 0) {
    parent.insert(
      getYjsInsertIndexForSlateIndex(parent, operation.index),
      slateNodesToYjsChildren(operation.newChildren as Descendant[])
    )
  }

  return true
}

const applySlateOperationsToYjs = (
  sharedRoot: Y.XmlElement,
  operations: readonly Operation[],
  nextValue: Value
) => {
  for (const operation of operations) {
    switch (operation.type) {
      case 'insert_text': {
        const position = pointToYjsTextPosition(sharedRoot, {
          path: operation.path,
          offset: operation.offset,
        })
        const textNode = getTextNode(nextValue, operation.path)
        const attributes = textNode ? getNodeAttributes(textNode) : {}

        position.sharedText.insert(
          position.index,
          operation.text,
          Object.keys(attributes).length > 0 ? attributes : undefined
        )
        break
      }
      case 'remove_text': {
        const position = pointToYjsTextPosition(sharedRoot, {
          path: operation.path,
          offset: operation.offset,
        })

        position.sharedText.delete(position.index, operation.text.length)
        break
      }
      case 'set_node': {
        const properties = operation.properties as Record<string, unknown>
        const newProperties = operation.newProperties as Record<string, unknown>
        const textNode = getTextNode(nextValue, operation.path)
        const applied = textNode
          ? applyTextPropertiesToYjs(
              sharedRoot,
              operation.path,
              properties,
              newProperties
            )
          : applyElementPropertiesToYjs(
              sharedRoot,
              operation.path,
              properties,
              newProperties
            )

        if (!applied) {
          return false
        }
        break
      }
      case 'set_selection':
        break
      case 'insert_node': {
        const parentPath = operation.path.slice(0, -1)
        const slateIndex = operation.path.at(-1)
        const parent = getYjsParentAtPath(sharedRoot, parentPath)

        if (!parent || slateIndex === undefined) {
          return false
        }

        parent.insert(
          getYjsInsertIndexForSlateIndex(parent, slateIndex),
          slateNodesToYjsChildren([operation.node as Descendant])
        )
        break
      }
      case 'replace_children': {
        if (!applyReplaceChildrenToYjs(sharedRoot, operation)) {
          return false
        }
        break
      }
      default:
        return false
    }
  }

  syncYjsTextMetadataFromValue(sharedRoot, nextValue)
  sharedRoot.setAttribute(
    VERSION_ATTRIBUTE,
    String(Number(sharedRoot.getAttribute(VERSION_ATTRIBUTE) ?? 0) + 1)
  )

  return true
}

const tryApplySlateOperationsToYjs = (
  sharedRoot: Y.XmlElement,
  operations: readonly Operation[],
  nextValue: Value
) => {
  try {
    return applySlateOperationsToYjs(sharedRoot, operations, nextValue)
  } catch {
    return false
  }
}

const normalizeComparableJson = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(normalizeComparableJson)
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizeComparableJson(value[key])])
    )
  }

  return value
}

const jsonEqual = (left: unknown, right: unknown) =>
  JSON.stringify(normalizeComparableJson(left)) ===
  JSON.stringify(normalizeComparableJson(right))

const getSlateTextLeaves = (value: Value): TextLeaf[] => {
  const leaves: TextLeaf[] = []

  const visit = (children: Descendant[], path: number[]) => {
    children.forEach((child, index) => {
      const childPath = [...path, index]

      if (TextApi.isText(child)) {
        const text = child.text

        leaves.push({
          end: text.length,
          path: childPath,
          start: 0,
          text,
        })
        return
      }

      if (isRecord(child) && Array.isArray(child.children)) {
        visit(child.children as Descendant[], childPath)
      }
    })
  }

  visit(value as Descendant[], [])

  return leaves
}

const getTextDiffOperation = ({
  nextText,
  path,
  previousText,
}: {
  nextText: string
  path: number[]
  previousText: string
}): Operation[] => {
  let start = 0

  while (
    start < previousText.length &&
    start < nextText.length &&
    previousText[start] === nextText[start]
  ) {
    start++
  }

  let previousEnd = previousText.length
  let nextEnd = nextText.length

  while (
    previousEnd > start &&
    nextEnd > start &&
    previousText[previousEnd - 1] === nextText[nextEnd - 1]
  ) {
    previousEnd--
    nextEnd--
  }

  const removedText = previousText.slice(start, previousEnd)
  const insertedText = nextText.slice(start, nextEnd)
  const operations: Operation[] = []

  if (removedText.length > 0) {
    operations.push({
      offset: start,
      path,
      text: removedText,
      type: 'remove_text',
    })
  }
  if (insertedText.length > 0) {
    operations.push({
      offset: start,
      path,
      text: insertedText,
      type: 'insert_text',
    })
  }

  return operations
}

const createRemoteTextReplayOperations = (
  previousValue: Value,
  nextValue: Value
): Operation[] | null => {
  const previousLeaves = getSlateTextLeaves(previousValue)
  const nextLeaves = getSlateTextLeaves(nextValue)

  if (previousLeaves.length !== nextLeaves.length) {
    return null
  }

  let changedLeaf: {
    next: TextLeaf
    previous: TextLeaf
  } | null = null

  for (let index = 0; index < previousLeaves.length; index++) {
    const previous = previousLeaves[index]!
    const next = nextLeaves[index]!

    if (!PathApi.equals(previous.path, next.path)) {
      return null
    }

    const previousNode = getTextNode(previousValue, previous.path)
    const nextNode = getTextNode(nextValue, next.path)

    if (
      !previousNode ||
      !nextNode ||
      !jsonEqual(getNodeAttributes(previousNode), getNodeAttributes(nextNode))
    ) {
      return null
    }

    if (previous.text === next.text) {
      continue
    }

    if (changedLeaf) {
      return null
    }

    changedLeaf = { next, previous }
  }

  if (!changedLeaf) {
    return []
  }

  return getTextDiffOperation({
    nextText: changedLeaf.next.text,
    path: changedLeaf.previous.path,
    previousText: changedLeaf.previous.text,
  })
}

const findNearestTextOffset = (
  text: string,
  search: string,
  preferredOffset: number
) => {
  if (search.length === 0) {
    return null
  }

  let bestOffset: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  let offset = text.indexOf(search)

  while (offset !== -1) {
    const distance = Math.abs(offset - preferredOffset)

    if (distance < bestDistance) {
      bestDistance = distance
      bestOffset = offset
    }

    offset = text.indexOf(search, offset + 1)
  }

  return bestOffset
}

type HistoryStack = Array<{
  operations?: Operation[]
}>

type TextHistoryReplayMode = 'redo' | 'undo'

const repairTextMatchOperation = (
  operation: Operation & { offset: number; text: string },
  text: string
) => {
  if (text.slice(operation.offset).startsWith(operation.text)) {
    return true
  }

  const nextOffset = findNearestTextOffset(
    text,
    operation.text,
    operation.offset
  )

  if (nextOffset === null) {
    return false
  }

  operation.offset = nextOffset

  return true
}

const repairHistoryStackTextOperations = (
  stack: HistoryStack | undefined,
  value: Value,
  mode: TextHistoryReplayMode
) => {
  if (!stack) {
    return
  }

  for (let index = stack.length - 1; index >= 0; index--) {
    const batch = stack[index]!
    let keepBatch = true

    for (const operation of batch.operations ?? []) {
      if (
        operation.type !== 'insert_text' &&
        operation.type !== 'remove_text'
      ) {
        continue
      }

      const node = getTextNode(value, operation.path)
      const text = typeof node?.text === 'string' ? node.text : null

      if (text == null) {
        keepBatch = false
        break
      }

      const replaysAsTextRemoval =
        (mode === 'undo' && operation.type === 'insert_text') ||
        (mode === 'redo' && operation.type === 'remove_text')

      if (replaysAsTextRemoval) {
        keepBatch = repairTextMatchOperation(operation, text)

        if (!keepBatch) {
          break
        }

        continue
      }

      if (operation.offset > text.length) {
        keepBatch = false
        break
      }
    }

    if (!keepBatch) {
      stack.splice(index, 1)
    }
  }
}

const repairHistoryTextOperations = (editor: Editor, value: Value) => {
  const history = editor.read(
    (state) =>
      (
        state as typeof state & {
          history?: {
            redos?: () => HistoryStack
            undos?: () => HistoryStack
          }
        }
      ).history
  )

  repairHistoryStackTextOperations(history?.undos?.(), value, 'undo')
  repairHistoryStackTextOperations(history?.redos?.(), value, 'redo')
}

type YjsHistoryStackItem = {
  meta: Map<unknown, unknown>
}

type YjsUndoManagerStacks = Y.UndoManager & {
  redoStack?: YjsHistoryStackItem[]
  undoStack?: YjsHistoryStackItem[]
}

type YjsHistoryDirection = 'redo' | 'undo'

const getStackItemOperations = (stackItem: YjsHistoryStackItem | undefined) => {
  const operations = stackItem?.meta.get(STACK_OPERATIONS)

  return Array.isArray(operations) ? (operations as Operation[]) : null
}

const invertOperations = (operations: readonly Operation[]) =>
  operations.map(OperationApi.inverse).reverse()

const stackItemMatchesHistoricCommit = (
  stackItem: YjsHistoryStackItem | undefined,
  operations: readonly Operation[],
  direction: YjsHistoryDirection
) => {
  const stackOperations = getStackItemOperations(stackItem)

  if (!stackOperations) {
    return false
  }

  return jsonEqual(
    direction === 'undo' ? invertOperations(stackOperations) : stackOperations,
    operations
  )
}

const isSelectionOnlyOperations = (operations: readonly Operation[]) =>
  operations.length > 0 &&
  operations.every((operation) => operation.type === 'set_selection')

class SlateYjsControllerImpl implements SlateYjsController {
  awareness: SlateYjsAwareness | null
  awarenessField: string
  cursorDataField: string
  editor: Editor | null = null
  extension: EditorExtension
  origin: unknown
  sharedRoot: Y.XmlElement
  undoManager: Y.UndoManager

  private applyingRemote = false
  private awarenessListener: (() => void) | null = null
  private connection: SlateYjsConnection = 'disconnected'
  private exports = 0
  private imports = 0
  private readonly listeners = new Set<() => void>()
  private readonly bootstrapOrigin = Symbol('slate-yjs-bootstrap')
  private pendingHistoryOperations: Operation[] | null = null
  private localSelectionRange: SlateYjsRelativeRange | null = null
  private pendingUndoSelectionBefore: SlateYjsRelativeRange | null = null
  private readonly selectionBinding: SlateYjsSelectionBinding
  private syncingSlateHistoryToYjs = false
  private observeYjsEvents:
    | ((
        events: Y.YEvent<Y.AbstractType<unknown>>[],
        transaction: Y.Transaction
      ) => void)
    | null = null
  private remoteCursorSnapshot: SlateYjsRemoteCursorState[] = []
  private remoteCursorSnapshotRevision = -1
  private revision = 0
  private runtimeState: EditorExtensionRuntimeState<SlateYjsState> | null = null
  private stateSnapshot: SlateYjsState = {
    connection: 'disconnected',
    exports: 0,
    imports: 0,
    revision: 0,
  }

  constructor(options: SlateYjsOptions) {
    this.sharedRoot = options.sharedRoot
    this.selectionBinding = new SlateYjsSelectionBinding(this.sharedRoot)
    this.awareness = options.awareness ?? null
    this.awarenessField = options.awarenessField ?? 'selection'
    this.cursorDataField = options.cursorDataField ?? 'user'
    this.origin = options.origin ?? Symbol('slate-yjs-local-origin')
    this.undoManager =
      options.undoManager ??
      new Y.UndoManager(this.sharedRoot, {
        trackedOrigins: new Set([this.origin]),
      })
    this.extension = defineEditorExtension({
      name: 'slate-yjs',
      setup: (context) => {
        if (this.editor && this.editor !== context.editor) {
          throw new Error(
            'Create a separate slate-yjs extension for each editor.'
          )
        }

        this.editor = context.editor
        this.runtimeState = context.runtimeState(this.getState())

        this.undoManager.on('stack-item-added', this.handleStackItemAdded)
        this.undoManager.on('stack-item-updated', this.handleStackItemAdded)
        this.undoManager.on('stack-item-popped', this.handleStackItemPopped)

        if (options.autoConnect === true) {
          queueMicrotask(() => {
            if (this.editor && !context.signal.aborted) {
              this.connect()
            }
          })
        }

        return {
          cleanup: () => {
            this.undoManager.off('stack-item-added', this.handleStackItemAdded)
            this.undoManager.off(
              'stack-item-updated',
              this.handleStackItemAdded
            )
            this.undoManager.off(
              'stack-item-popped',
              this.handleStackItemPopped
            )
            this.disconnect()
            this.editor = null
            this.runtimeState = null
          },
          onCommit: ({ commit, snapshot }) => {
            const children = snapshot.children as Value

            if (commit.metadata.collab?.origin === 'remote') {
              repairHistoryTextOperations(context.editor, children)
            }

            this.handleCommit(commit, children)
          },
          state: {
            yjs: () => ({
              controller: () => this,
              getRemoteCursorStates: () => this.getRemoteCursorStates(),
              getState: () => this.getState(),
              subscribe: (listener: () => void) => this.subscribe(listener),
            }),
          },
          tx: {
            yjs: () => ({
              connect: () => this.connect(),
              disconnect: () => this.disconnect(),
              exportSelection: (selection?: Selection) =>
                this.exportSelection(selection),
              pause: () => this.pause(),
              reconcile: () => this.reconcile(),
              redo: () => this.deferHistoryPop(() => this.redo()),
              resume: () => this.resume(),
              sync: () => this.sync(),
              undo: () => this.deferHistoryPop(() => this.undo()),
            }),
          },
        }
      },
    })
  }

  connect() {
    const editor = this.requireEditor()

    if (this.connection === 'connected') {
      return
    }

    this.assertAttached()
    if (readSlateValueFromYjs(this.sharedRoot)) {
      this.importRemoteSnapshot()
    } else {
      const snapshot = getEditorSnapshot(editor)
      this.writeLocalSnapshot(snapshot.children, [], null, false)
    }

    this.observeYjsEvents = (_events, transaction) => {
      if (this.syncingSlateHistoryToYjs) {
        return
      }
      if (
        transaction.origin !== this.origin &&
        transaction.origin !== this.bootstrapOrigin
      ) {
        this.importRemote()
      }
    }
    this.sharedRoot.observeDeep(this.observeYjsEvents)

    if (this.awareness) {
      this.awarenessListener = () => {
        this.notify()
      }
      this.awareness.on('change', this.awarenessListener)
    }

    this.setConnection('connected')
    this.exportSelection()
  }

  disconnect() {
    if (this.connection === 'disconnected') {
      return
    }

    if (this.observeYjsEvents) {
      this.sharedRoot.unobserveDeep(this.observeYjsEvents)
      this.observeYjsEvents = null
    }
    if (this.awareness && this.awarenessListener) {
      this.awareness.off('change', this.awarenessListener)
      this.awarenessListener = null
    }

    this.awareness?.setLocalStateField(this.awarenessField, null)
    this.setConnection('disconnected')
  }

  exportSelection(
    selection = this.editor ? getEditorSnapshot(this.editor).selection : null
  ) {
    if (!this.editor || this.connection !== 'connected') {
      return
    }

    const value = getEditorSnapshot(this.editor).children
    const relativeRange = this.updateLocalSelectionRange(selection, value)

    if (!this.awareness) {
      return
    }

    if (!selection || !relativeRange) {
      this.awareness.setLocalStateField(this.awarenessField, null)
      return
    }

    this.awareness.setLocalStateField(this.awarenessField, relativeRange)
  }

  getRemoteCursorStates(): SlateYjsRemoteCursorState[] {
    if (this.remoteCursorSnapshotRevision === this.revision) {
      return this.remoteCursorSnapshot
    }

    this.remoteCursorSnapshot = this.readRemoteCursorStates()
    this.remoteCursorSnapshotRevision = this.revision

    return this.remoteCursorSnapshot
  }

  private readRemoteCursorStates(): SlateYjsRemoteCursorState[] {
    if (!this.awareness || !this.editor) {
      return []
    }

    const value =
      readSlateValueFromYjs(this.sharedRoot) ??
      getEditorSnapshot(this.editor).children
    const states: SlateYjsRemoteCursorState[] = []

    this.selectionBinding.rebuild()

    for (const [clientId, state] of this.awareness.getStates()) {
      if (clientId === this.awareness.clientID) {
        continue
      }

      const relativeRange = state[this.awarenessField]
      const range =
        isRelativeRange(relativeRange) && this.sharedRoot.doc
          ? this.selectionBinding.yjsRangeToSlate(value, relativeRange)
          : null

      states.push({
        clientId,
        data: state[this.cursorDataField] ?? null,
        range,
        user: state.user ?? null,
      })
    }

    return states
  }

  getState() {
    return this.stateSnapshot
  }

  pause() {
    if (this.connection === 'connected') {
      this.setConnection('paused')
    }
  }

  reconcile() {
    this.importRemoteSnapshot()
  }

  redo() {
    this.undoManager.redo()
    return true
  }

  resume() {
    if (this.connection !== 'paused') {
      return
    }

    this.setConnection('connected')
    this.importRemoteSnapshot()
    this.exportSelection()
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  sync() {
    this.importRemoteSnapshot()
  }

  undo() {
    this.undoManager.undo()
    return true
  }

  private assertAttached() {
    if (!this.sharedRoot.doc) {
      throw new Error('slate-yjs requires sharedRoot to be attached to a Y.Doc')
    }
  }

  private handleCommit(commit: EditorCommit, children: Value) {
    if (
      !this.editor ||
      this.applyingRemote ||
      this.connection !== 'connected'
    ) {
      return
    }
    if (commit.tags.includes('skip-collab')) {
      return
    }
    if (
      commit.tags.includes('collaboration') ||
      commit.metadata.collab?.origin === 'remote'
    ) {
      return
    }

    if (isSelectionOnlyOperations(commit.operations)) {
      this.exportSelection(commit.selectionAfter)
      this.notify()
      return
    }

    if (this.syncHistoricCommitToYjs(commit, children)) {
      this.exports++
      this.exportSelection(commit.selectionAfter)
      this.writeRuntimeState()
      this.notify()
      return
    }

    if (commit.operations.length === 0) {
      const sharedValue = readSlateValueFromYjs(this.sharedRoot)

      if (!jsonEqual(sharedValue, children)) {
        this.writeLocalSnapshot(children, [], commit.selectionBefore)
        this.exports++
        this.exportSelection(commit.selectionAfter)
        this.writeRuntimeState()
        this.notify()
        return
      }

      if (commit.selectionChanged) {
        this.exportSelection(commit.selectionAfter)
        this.notify()
      }
      return
    }

    this.writeLocalSnapshot(children, commit.operations, commit.selectionBefore)
    this.exports++
    this.exportSelection(commit.selectionAfter)
    this.writeRuntimeState()
    this.notify()
  }

  private importRemote() {
    if (!this.editor || this.connection !== 'connected') {
      return
    }

    this.applyingRemote = true
    try {
      this.importRemoteSnapshot()
      this.imports++
    } finally {
      this.applyingRemote = false
    }

    this.exportSelection()
    this.writeRuntimeState()
    this.notify()
  }

  private importRemoteSnapshot() {
    if (!this.editor) {
      return
    }

    const nextValue = readSlateValueFromYjs(this.sharedRoot)

    if (!nextValue) {
      return
    }

    const snapshot = getEditorSnapshot(this.editor)

    if (jsonEqual(snapshot.children, nextValue)) {
      return
    }

    this.replaceEditorValue(nextValue, snapshot.selection)
  }

  private notify() {
    this.revision++
    this.writeRuntimeState()

    for (const listener of this.listeners) {
      listener()
    }
  }

  private replaceEditorValue(nextValue: Value, selection: Selection) {
    if (!this.editor) {
      return
    }

    const snapshot = getEditorSnapshot(this.editor)
    const remoteOperations = createRemoteTextReplayOperations(
      snapshot.children,
      nextValue
    )
    this.selectionBinding.rebuild()
    const relativeSelection = this.localSelectionRange
      ? this.selectionBinding.yjsRangeToSlate(
          nextValue,
          this.localSelectionRange
        )
      : null
    const nextSelection =
      relativeSelection ?? clampSelectionToValue(nextValue, selection)
    const marks = snapshot.marks

    if (remoteOperations && remoteOperations.length > 0) {
      this.editor.update((tx) => {
        tx.operations.replay(remoteOperations)
        tx.selection.set(nextSelection)
      }, REMOTE_IMPORT_OPTIONS)
      return
    }

    this.editor.update((tx) => {
      tx.value.replace({
        children: clone(nextValue) as Value,
        marks,
        selection: nextSelection,
      })
    }, REMOTE_IMPORT_OPTIONS)
  }

  private requireEditor() {
    if (!this.editor) {
      throw new Error(
        'Extend an editor with createYjsExtension(...) before connecting slate-yjs.'
      )
    }

    return this.editor
  }

  private deferHistoryPop(callback: () => boolean) {
    queueMicrotask(callback)

    return true
  }

  private restoreRelativeSelection(relativeSelection: SlateYjsRelativeRange) {
    if (!this.editor) {
      return
    }

    const value = getEditorSnapshot(this.editor).children
    this.selectionBinding.rebuild()
    const selection = this.selectionBinding.yjsRangeToSlate(
      value,
      relativeSelection
    )

    if (!selection) {
      return
    }

    this.editor.update(
      (tx) => {
        tx.selection.set(selection)
      },
      {
        metadata: {
          collab: { origin: 'remote', saveToHistory: false },
          history: { mode: 'skip' },
          selection: { dom: 'preserve', focus: false, scroll: false },
        },
        tag: ['collaboration', 'remote-selection'],
      }
    )
  }

  private syncAfterHistoryPop(relativeSelection: unknown) {
    if (!this.editor || this.connection !== 'connected') {
      return
    }

    this.applyingRemote = true
    try {
      this.importRemoteSnapshot()
    } finally {
      this.applyingRemote = false
    }

    if (isRelativeRange(relativeSelection)) {
      this.restoreRelativeSelection(relativeSelection)
    }

    this.exportSelection()
    this.writeRuntimeState()
    this.notify()
  }

  private syncHistoricCommitToYjs(commit: EditorCommit, children: Value) {
    if (!commit.tags.includes('historic') || commit.operations.length === 0) {
      return false
    }

    const undoManager = this.undoManager as YjsUndoManagerStacks

    if (
      stackItemMatchesHistoricCommit(
        undoManager.undoStack?.at(-1),
        commit.operations,
        'undo'
      )
    ) {
      return this.applyYjsHistory('undo', children)
    }

    if (
      stackItemMatchesHistoricCommit(
        undoManager.redoStack?.at(-1),
        commit.operations,
        'redo'
      )
    ) {
      return this.applyYjsHistory('redo', children)
    }

    return false
  }

  private applyYjsHistory(direction: YjsHistoryDirection, children: Value) {
    this.syncingSlateHistoryToYjs = true

    try {
      if (direction === 'undo') {
        this.undoManager.undo()
      } else {
        this.undoManager.redo()
      }

      const sharedValue = readSlateValueFromYjs(this.sharedRoot)

      if (jsonEqual(sharedValue, children)) {
        return true
      }

      if (direction === 'undo') {
        this.undoManager.redo()
      } else {
        this.undoManager.undo()
      }

      return false
    } finally {
      this.syncingSlateHistoryToYjs = false
    }
  }

  private setConnection(connection: SlateYjsConnection) {
    if (this.connection === connection) {
      return
    }

    this.connection = connection
    this.writeRuntimeState()
    this.notify()
  }

  private updateLocalSelectionRange(selection: Selection, value: Value) {
    if (!selection) {
      this.localSelectionRange = null
      return null
    }

    try {
      this.selectionBinding.rebuild()
      this.localSelectionRange = this.selectionBinding.slateRangeToYjs(
        value,
        selection
      )
    } catch {
      this.localSelectionRange = null
    }

    return this.localSelectionRange
  }

  private writeLocalSnapshot(
    children: Value,
    operations: readonly Operation[] = [],
    selectionBefore: Selection = null,
    trackUndo = true
  ) {
    const doc = this.sharedRoot.doc
    const write = () => {
      this.pendingUndoSelectionBefore = selectionBefore
        ? this.captureRelativeSelection(selectionBefore)
        : null
      this.pendingHistoryOperations =
        operations.length > 0 ? clone([...operations]) : null

      if (
        operations.length === 0 ||
        !tryApplySlateOperationsToYjs(this.sharedRoot, operations, children)
      ) {
        writeSlateValueToYjsUnchecked(this.sharedRoot, children)
      }
    }
    const clearPendingHistory = () => {
      this.pendingUndoSelectionBefore = null
      this.pendingHistoryOperations = null
    }

    if (!doc) {
      try {
        write()
      } finally {
        clearPendingHistory()
      }
      return
    }

    try {
      doc.transact(write, trackUndo ? this.origin : this.bootstrapOrigin)
    } finally {
      clearPendingHistory()
    }
  }

  private captureRelativeSelection(selection: Range) {
    const value = readSlateValueFromYjs(this.sharedRoot)

    if (!value) {
      return null
    }

    try {
      this.selectionBinding.rebuild()
      return this.selectionBinding.slateRangeToYjs(value, selection)
    } catch {
      return null
    }
  }

  private writeRuntimeState() {
    const nextState = {
      connection: this.connection,
      exports: this.exports,
      imports: this.imports,
      revision: this.revision,
    } satisfies SlateYjsState

    if (
      nextState.connection !== this.stateSnapshot.connection ||
      nextState.exports !== this.stateSnapshot.exports ||
      nextState.imports !== this.stateSnapshot.imports ||
      nextState.revision !== this.stateSnapshot.revision
    ) {
      this.stateSnapshot = nextState
      this.runtimeState?.set(nextState)
    }
  }

  private readonly handleStackItemAdded = ({
    stackItem,
  }: {
    stackItem: { meta: Map<unknown, unknown> }
  }) => {
    if (
      this.pendingUndoSelectionBefore &&
      !stackItem.meta.has(STACK_SELECTION_BEFORE)
    ) {
      stackItem.meta.set(
        STACK_SELECTION_BEFORE,
        this.pendingUndoSelectionBefore
      )
    }
    if (this.pendingHistoryOperations) {
      const operations = getStackItemOperations(stackItem) ?? []

      stackItem.meta.set(STACK_OPERATIONS, [
        ...clone(operations),
        ...clone(this.pendingHistoryOperations),
      ])
    }
  }

  private readonly handleStackItemPopped = ({
    stackItem,
  }: {
    stackItem: { meta: Map<unknown, unknown> }
  }) => {
    if (this.syncingSlateHistoryToYjs) {
      return
    }

    const relativeSelection = stackItem.meta.get(STACK_SELECTION_BEFORE)

    queueMicrotask(() => {
      this.syncAfterHistoryPop(relativeSelection)
    })
  }
}

const isRelativeRange = (value: unknown): value is SlateYjsRelativeRange =>
  isRecord(value) && Array.isArray(value.anchor) && Array.isArray(value.focus)

const clampPointToValue = (
  value: Value,
  point: Range['anchor']
): Range['anchor'] | null => {
  const node = getTextNode(value, point.path)

  if (!node || typeof node.text !== 'string') {
    return null
  }

  return {
    path: [...point.path],
    offset: Math.max(0, Math.min(point.offset, node.text.length)),
  }
}

const clampSelectionToValue = (
  value: Value,
  selection: Selection
): Selection => {
  if (!selection) {
    return null
  }

  const anchor = clampPointToValue(value, selection.anchor)
  const focus = clampPointToValue(value, selection.focus)

  return anchor && focus ? { anchor, focus } : null
}

export const createYjsController = (
  options: SlateYjsOptions
): SlateYjsController => new SlateYjsControllerImpl(options)

export const createYjsExtension = (options: SlateYjsOptions): EditorExtension =>
  createYjsController(options).extension
