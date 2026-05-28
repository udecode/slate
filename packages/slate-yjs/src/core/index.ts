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
const DELETED_IF_EMPTY_ATTRIBUTE = 'if-empty'
const MOVE_REF_COUNTER_ATTRIBUTE = 'slate:move-ref-counter'
const MOVE_REF_ID_ATTRIBUTE = 'slate:move-ref-id'
const TEXT_LEAVES_ATTRIBUTE = 'slate:text-leaves'
const VERSION_ATTRIBUTE = 'slate:version'
const WRAPPED_SOURCE_ATTRIBUTE = 'slate:wrapped-source'
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
  attributes: Record<string, unknown>
  end: number
  path: number[]
  slateEnd: number
  slateStart: number
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

type YjsTextLeafDeltaEntry = {
  attributes?: Record<string, unknown>
  insert: string
}

type YjsReadOptions = {
  includeDeleted?: boolean
  mergeAdjacentTextContainers?: boolean
  preferDeltaMetadata?: boolean
  sharedRoot?: Y.XmlElement
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const hasOwn = (value: object, key: string) => Object.hasOwn(value, key)

const getTextAttributes = (text: Record<string, unknown>) => {
  const { text: _text, ...attributes } = text

  return attributes
}

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

const getNode = (
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

  return isRecord(node) ? node : null
}

const getTextNode = (
  value: Value,
  path: readonly number[]
): Record<string, unknown> | null => {
  const node = getNode(value, path)

  return TextApi.isText(node) ? node : null
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

const hasSlateText = (node: unknown): boolean => {
  if (!isRecord(node)) {
    return false
  }

  if (typeof node.text === 'string') {
    return node.text.length > 0
  }

  if (!Array.isArray(node.children)) {
    return false
  }

  return node.children.some((child) => hasSlateText(child))
}

const isYjsXmlElement = (value: unknown): value is Y.XmlElement =>
  value instanceof Y.XmlElement

const isYjsXmlText = (value: unknown): value is Y.XmlText =>
  value instanceof Y.XmlText

const hasVisibleYjsText = (node: Y.XmlElement | Y.XmlText): boolean => {
  if (isYjsXmlText(node)) {
    return node.length > 0
  }

  return node.toArray().some((child) => {
    if (!isYjsXmlElement(child) && !isYjsXmlText(child)) {
      return false
    }

    const deleted = child.getAttribute(DELETED_ATTRIBUTE)

    if (deleted === true || deleted === 'true') {
      return false
    }

    return hasVisibleYjsText(child)
  })
}

const isYjsDeleted = (node: Y.XmlElement | Y.XmlText) => {
  const value = node.getAttribute(DELETED_ATTRIBUTE)

  return (
    value === true ||
    value === 'true' ||
    (value === DELETED_IF_EMPTY_ATTRIBUTE && !hasVisibleYjsText(node))
  )
}

const getYjsAttributes = (node: Y.XmlElement | Y.XmlText) => {
  const attributes: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(node.getAttributes())) {
    if (
      key !== VERSION_ATTRIBUTE &&
      key !== DELETED_ATTRIBUTE &&
      key !== EMPTY_TEXT_ATTRIBUTES &&
      key !== MOVE_REF_COUNTER_ATTRIBUTE &&
      key !== MOVE_REF_ID_ATTRIBUTE &&
      key !== WRAPPED_SOURCE_ATTRIBUTE &&
      key !== TEXT_LEAVES_ATTRIBUTE
    ) {
      attributes[key] = clone(value)
    }
  }

  return attributes
}

const getNextMoveRefId = (sharedRoot: Y.XmlElement) => {
  const current = Number(
    sharedRoot.getAttribute(MOVE_REF_COUNTER_ATTRIBUTE) ?? 0
  )
  const next = Number.isFinite(current) ? current + 1 : 1

  sharedRoot.setAttribute(MOVE_REF_COUNTER_ATTRIBUTE, String(next))

  return `${sharedRoot.doc?.clientID ?? 'local'}:${next}`
}

const findYjsNodeByMoveRefId = (
  parent: Y.XmlElement,
  refId: string
): Y.XmlElement | Y.XmlText | null => {
  for (const child of parent.toArray()) {
    if (!isYjsXmlElement(child) && !isYjsXmlText(child)) {
      continue
    }
    if (child.getAttribute(MOVE_REF_ID_ATTRIBUTE) === refId) {
      return child
    }
    if (isYjsXmlElement(child)) {
      const match = findYjsNodeByMoveRefId(child, refId)

      if (match) {
        return match
      }
    }
  }

  return null
}

const getWrappedSourceNode = (
  parent: Y.XmlElement,
  options: YjsReadOptions = {}
) => {
  const refId = parent.getAttribute(WRAPPED_SOURCE_ATTRIBUTE)

  return typeof refId === 'string' && options.sharedRoot
    ? findYjsNodeByMoveRefId(options.sharedRoot, refId)
    : null
}

const getYjsChildEntriesForRead = (
  parent: Y.XmlElement,
  options: YjsReadOptions = {}
): Array<{
  child: Y.XmlElement | Y.XmlText
  includeDeleted: boolean
}> => {
  const wrappedSource = getWrappedSourceNode(parent, options)

  if (wrappedSource) {
    return [{ child: wrappedSource, includeDeleted: true }]
  }

  return parent
    .toArray()
    .filter(
      (child): child is Y.XmlElement | Y.XmlText =>
        isYjsXmlElement(child) || isYjsXmlText(child)
    )
    .map((child) => ({ child, includeDeleted: false }))
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

const createYjsTextLeafDelta = (
  leaves: Record<string, unknown>[]
): YjsTextLeafDeltaEntry[] =>
  leaves
    .filter((leaf) => typeof leaf.text === 'string' && leaf.text.length > 0)
    .map((leaf) => {
      const attributes = getNodeAttributes(leaf)

      return Object.keys(attributes).length > 0
        ? { insert: leaf.text as string, attributes }
        : { insert: leaf.text as string }
    })

const createYjsText = (leaves: Record<string, unknown>[]) => {
  const sharedText = new Y.XmlText()
  const delta = createYjsTextLeafDelta(leaves)

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

const getSlateText = (leaves: Record<string, unknown>[]) =>
  leaves
    .map((leaf) => (typeof leaf.text === 'string' ? leaf.text : ''))
    .join('')

const getCommonPrefixLength = (left: string, right: string) => {
  let offset = 0

  while (offset < left.length && offset < right.length) {
    if (left[offset] !== right[offset]) {
      break
    }
    offset++
  }

  return offset
}

const getCommonSuffixLength = (
  left: string,
  right: string,
  prefixLength: number
) => {
  let offset = 0
  const maxLength = Math.min(left.length, right.length) - prefixLength

  while (offset < maxLength) {
    if (left.at(-1 - offset) !== right.at(-1 - offset)) {
      break
    }
    offset++
  }

  return offset
}

const sliceTextLeaves = (
  leaves: Record<string, unknown>[],
  start: number,
  end: number
) => {
  const sliced: Record<string, unknown>[] = []
  let offset = 0

  for (const leaf of leaves) {
    const text = typeof leaf.text === 'string' ? leaf.text : ''
    const leafStart = offset
    const leafEnd = leafStart + text.length
    const sliceStart = Math.max(start, leafStart)
    const sliceEnd = Math.min(end, leafEnd)

    if (sliceStart < sliceEnd) {
      sliced.push({
        ...getNodeAttributes(leaf),
        text: text.slice(sliceStart - leafStart, sliceEnd - leafStart),
      })
    }

    offset = leafEnd
  }

  return sliced
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

const recordsEqual = (
  left: Record<string, unknown>,
  right: Record<string, unknown>
) => {
  const leftKeys = Object.keys(left)

  return (
    leftKeys.length === Object.keys(right).length &&
    leftKeys.every(
      (key) => hasOwn(right, key) && Object.is(left[key], right[key])
    )
  )
}

const metadataCrossesDeltaAttributeChanges = (
  deltaSpans: Array<{
    attributes: Record<string, unknown>
    end: number
    start: number
  }>,
  metadata: TextLeafMetadata[]
) => {
  let metadataOffset = 0
  let spanIndex = 0

  for (const entry of metadata) {
    const start = metadataOffset
    const end = start + entry.length

    metadataOffset = end

    while (
      spanIndex < deltaSpans.length &&
      deltaSpans[spanIndex]!.end <= start
    ) {
      spanIndex++
    }

    let cursor = spanIndex
    let attributes: Record<string, unknown> | null = null

    while (cursor < deltaSpans.length && deltaSpans[cursor]!.start < end) {
      const span = deltaSpans[cursor]!
      const sliceStart = Math.max(start, span.start)
      const sliceEnd = Math.min(end, span.end)

      if (sliceStart < sliceEnd) {
        if (attributes && !recordsEqual(attributes, span.attributes)) {
          return true
        }
        attributes = span.attributes
      }

      cursor++
    }
  }

  return false
}

const getMetadataControlledAttributeKeys = (
  deltaSpans: Array<{
    attributes: Record<string, unknown>
    end: number
    start: number
  }>,
  metadata: TextLeafMetadata[]
) => {
  const metadataKeys = new Set(
    metadata.flatMap((entry) =>
      entry.attributes ? Object.keys(entry.attributes) : []
    )
  )
  const deltaKeyCounts = new Map<string, number>()
  const metadataValueMismatches = new Set<string>()
  let metadataOffset = 0
  let nonEmptyEntries = 0
  let spanIndex = 0

  for (const entry of metadata) {
    const start = metadataOffset
    const end = start + entry.length

    metadataOffset = end

    if (entry.length === 0) {
      continue
    }

    nonEmptyEntries++

    while (
      spanIndex < deltaSpans.length &&
      deltaSpans[spanIndex]!.end <= start
    ) {
      spanIndex++
    }

    let cursor = spanIndex
    const deltaKeyCoverage = new Map<string, number>()
    const deltaKeyConflicts = new Set<string>()
    const deltaKeyValues = new Map<string, unknown>()

    while (cursor < deltaSpans.length && deltaSpans[cursor]!.start < end) {
      const span = deltaSpans[cursor]!
      const sliceStart = Math.max(start, span.start)
      const sliceEnd = Math.min(end, span.end)

      if (sliceStart < sliceEnd) {
        const length = sliceEnd - sliceStart

        for (const key of Object.keys(span.attributes)) {
          deltaKeyCoverage.set(key, (deltaKeyCoverage.get(key) ?? 0) + length)
          if (
            deltaKeyValues.has(key) &&
            !Object.is(deltaKeyValues.get(key), span.attributes[key])
          ) {
            deltaKeyConflicts.add(key)
          } else {
            deltaKeyValues.set(key, span.attributes[key])
          }
        }
      }

      cursor++
    }

    for (const [key, length] of deltaKeyCoverage) {
      if (length === entry.length && !deltaKeyConflicts.has(key)) {
        deltaKeyCounts.set(key, (deltaKeyCounts.get(key) ?? 0) + 1)

        if (
          entry.attributes &&
          hasOwn(entry.attributes, key) &&
          !Object.is(entry.attributes[key], deltaKeyValues.get(key))
        ) {
          metadataValueMismatches.add(key)
        }
      }
    }
  }

  return new Set(
    [...metadataKeys].filter(
      (key) =>
        deltaKeyCounts.get(key) === nonEmptyEntries &&
        !metadataValueMismatches.has(key)
    )
  )
}

const getDeltaControlledAttributeKeys = (
  deltaSpans: Array<{
    attributes: Record<string, unknown>
    end: number
    start: number
  }>,
  metadata: TextLeafMetadata[]
) => {
  const metadataKeyCounts = new Map<string, number>()
  const deltaKeyCounts = new Map<string, number>()
  let metadataOffset = 0
  let nonEmptyEntries = 0
  let spanIndex = 0

  for (const entry of metadata) {
    const start = metadataOffset
    const end = start + entry.length

    metadataOffset = end

    if (entry.length === 0) {
      continue
    }

    nonEmptyEntries++

    for (const key of Object.keys(entry.attributes ?? {})) {
      metadataKeyCounts.set(key, (metadataKeyCounts.get(key) ?? 0) + 1)
    }

    while (
      spanIndex < deltaSpans.length &&
      deltaSpans[spanIndex]!.end <= start
    ) {
      spanIndex++
    }

    let cursor = spanIndex
    const deltaKeys = new Set<string>()

    while (cursor < deltaSpans.length && deltaSpans[cursor]!.start < end) {
      const span = deltaSpans[cursor]!
      const sliceStart = Math.max(start, span.start)
      const sliceEnd = Math.min(end, span.end)

      if (sliceStart < sliceEnd) {
        for (const key of Object.keys(span.attributes)) {
          deltaKeys.add(key)
        }
      }

      cursor++
    }

    for (const key of deltaKeys) {
      deltaKeyCounts.set(key, (deltaKeyCounts.get(key) ?? 0) + 1)
    }
  }

  return new Set(
    [...metadataKeyCounts.entries()]
      .filter(([, count]) => count === nonEmptyEntries)
      .flatMap(([key]) => {
        const deltaCount = deltaKeyCounts.get(key) ?? 0

        return deltaCount < nonEmptyEntries &&
          (deltaCount > 0 || nonEmptyEntries > 1)
          ? [key]
          : []
      })
  )
}

const getNullMetadataFallbackAttributes = (
  metadataAttributes: Record<string, unknown>,
  deltaAttributes: Record<string, unknown>
) =>
  Object.fromEntries(
    Object.entries(metadataAttributes).filter(
      ([key, value]) => value === null && !hasOwn(deltaAttributes, key)
    )
  )

const getMetadataFallbackAttributes = (
  metadataAttributes: Record<string, unknown>,
  deltaAttributes: Record<string, unknown>,
  metadataControlledAttributeKeys: Set<string>
) =>
  Object.fromEntries(
    Object.entries(metadataAttributes).filter(
      ([key, value]) =>
        metadataControlledAttributeKeys.has(key) ||
        (value === null && !hasOwn(deltaAttributes, key))
    )
  )

const readYjsTextWithMetadata = (
  delta: YjsTextDeltaEntry[],
  metadata: TextLeafMetadata[],
  plainText: string,
  preferDeltaMetadata: boolean
): SlateTextLeafRecord[] => {
  const deltaSpans: Array<{
    attributes: Record<string, unknown>
    end: number
    start: number
    text: string
  }> = []
  let deltaOffset = 0

  for (const entry of delta) {
    if (typeof entry.insert !== 'string') {
      continue
    }

    const text = entry.insert
    const start = deltaOffset

    deltaOffset += text.length
    deltaSpans.push({
      attributes: isRecord(entry.attributes) ? clone(entry.attributes) : {},
      end: deltaOffset,
      start,
      text,
    })
  }

  const preferDeltaAttributes = metadataCrossesDeltaAttributeChanges(
    deltaSpans,
    metadata
  )
  const metadataControlledAttributeKeys = getMetadataControlledAttributeKeys(
    deltaSpans,
    metadata
  )
  const deltaControlledAttributeKeys = preferDeltaMetadata
    ? getDeltaControlledAttributeKeys(deltaSpans, metadata)
    : new Set<string>()
  const leaves: SlateTextLeafRecord[] = []
  let metadataOffset = 0
  let spanIndex = 0

  for (const entry of metadata) {
    const metadataAttributes = entry.attributes ? clone(entry.attributes) : {}
    const start = metadataOffset
    const end = start + entry.length

    metadataOffset = end

    if (entry.length === 0) {
      leaves.push({
        ...metadataAttributes,
        text: '',
      })
      continue
    }

    while (
      spanIndex < deltaSpans.length &&
      deltaSpans[spanIndex]!.end <= start
    ) {
      spanIndex++
    }

    let cursor = spanIndex
    const overlapSlices: Array<{
      attributes: Record<string, unknown>
      isPartialSpan: boolean
      text: string
    }> = []

    while (cursor < deltaSpans.length && deltaSpans[cursor]!.start < end) {
      const span = deltaSpans[cursor]!
      const sliceStart = Math.max(start, span.start)
      const sliceEnd = Math.min(end, span.end)

      if (sliceStart < sliceEnd) {
        overlapSlices.push({
          attributes: span.attributes,
          isPartialSpan: sliceStart !== span.start || sliceEnd !== span.end,
          text: span.text.slice(sliceStart - span.start, sliceEnd - span.start),
        })
      }

      cursor++
    }

    if (overlapSlices.length === 0) {
      leaves.push({
        ...metadataAttributes,
        text: plainText.slice(start, end),
      })
      continue
    }

    const metadataOnlyAttributes =
      !preferDeltaMetadata &&
      overlapSlices.length === 1 &&
      Object.keys(overlapSlices[0]!.attributes).length === 0 &&
      Object.keys(metadataAttributes).length > 0
    const useMetadataAttributes =
      !preferDeltaAttributes &&
      (metadata.length > 1 ||
        metadataOnlyAttributes ||
        overlapSlices.length > 1 ||
        overlapSlices.some((slice) => slice.isPartialSpan))

    if (useMetadataAttributes) {
      const deltaAttributes = Object.fromEntries(
        Object.entries(overlapSlices[0]?.attributes ?? {}).filter(
          ([key]) => !metadataControlledAttributeKeys.has(key)
        )
      )
      const controlledMetadataAttributes = preferDeltaMetadata
        ? Object.fromEntries(
            Object.entries(metadataAttributes).filter(([key]) =>
              metadataControlledAttributeKeys.has(key)
            )
          )
        : Object.fromEntries(
            Object.entries(metadataAttributes).filter(
              ([key]) => !deltaControlledAttributeKeys.has(key)
            )
          )
      const metadataFallbackAttributes = preferDeltaMetadata
        ? {
            ...controlledMetadataAttributes,
            ...getNullMetadataFallbackAttributes(
              metadataAttributes,
              deltaAttributes
            ),
          }
        : controlledMetadataAttributes

      leaves.push({
        ...metadataFallbackAttributes,
        ...deltaAttributes,
        text: plainText.slice(start, end),
      })
      continue
    }

    for (const slice of overlapSlices) {
      const deltaAttributes = Object.fromEntries(
        Object.entries(slice.attributes).filter(
          ([key]) => !metadataControlledAttributeKeys.has(key)
        )
      )
      const metadataFallbackAttributes = preferDeltaMetadata
        ? getMetadataFallbackAttributes(
            metadataAttributes,
            slice.attributes,
            metadataControlledAttributeKeys
          )
        : Object.fromEntries(
            Object.entries(metadataAttributes).filter(
              ([key]) =>
                !metadataControlledAttributeKeys.has(key) &&
                !deltaControlledAttributeKeys.has(key) &&
                !hasOwn(slice.attributes, key)
            )
          )

      leaves.push({
        ...metadataFallbackAttributes,
        ...deltaAttributes,
        text: slice.text,
      })
    }
  }

  return leaves
}

const readYjsText = (
  sharedText: Y.XmlText,
  options: YjsReadOptions = {}
): SlateTextLeafRecord[] => {
  const delta = sharedText.toDelta() as YjsTextDeltaEntry[]
  const plainText = getPlainTextFromDelta(delta)
  const metadata = sharedText.getAttribute(TEXT_LEAVES_ATTRIBUTE)

  if (isTextLeafMetadataList(metadata)) {
    const metadataLength = metadata.reduce(
      (sum, entry) => sum + entry.length,
      0
    )

    if (metadataLength === plainText.length) {
      return readYjsTextWithMetadata(
        delta,
        metadata,
        plainText,
        options.preferDeltaMetadata ?? true
      )
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

const getYjsTextReadOptions = (sharedRoot: Y.XmlElement): YjsReadOptions => ({
  preferDeltaMetadata: sharedRoot.getAttribute(VERSION_ATTRIBUTE) != null,
  sharedRoot,
})

const shouldMergeSlateTextLeaves = (left: Descendant, right: Descendant) =>
  TextApi.isText(left) &&
  TextApi.isText(right) &&
  TextApi.equals(left, right, { loose: true })

const shouldMergeYjsTextLeaf = (
  previous: YjsTextLeaf | undefined,
  next: SlateTextLeafRecord,
  sharedText: Y.XmlText,
  parentPath: number[]
) =>
  !!previous &&
  previous.sharedText !== sharedText &&
  PathApi.equals(previous.path.slice(0, -1), parentPath) &&
  TextApi.equals({ ...previous.attributes, text: previous.text }, next, {
    loose: true,
  })

const appendYjsReadChildren = (
  children: Descendant[],
  nextChildren: Descendant[]
) => {
  const first = nextChildren[0]
  const last = children.at(-1)

  if (first && last && shouldMergeSlateTextLeaves(last, first)) {
    children[children.length - 1] = {
      ...last,
      text: `${last.text}${first.text}`,
    }
    children.push(...nextChildren.slice(1))
    return
  }

  children.push(...nextChildren)
}

const readYjsNode = (
  node: Y.XmlElement | Y.XmlText,
  options: YjsReadOptions = {}
): Descendant[] => {
  if (isYjsDeleted(node) && options.includeDeleted !== true) {
    return []
  }

  if (isYjsXmlText(node)) {
    return readYjsText(node, options) as Descendant[]
  }

  const children: Descendant[] = []

  const childOptions = { ...options, includeDeleted: false }

  for (const { child, includeDeleted } of getYjsChildEntriesForRead(
    node,
    options
  )) {
    const nextChildren = readYjsNode(child, {
      ...childOptions,
      includeDeleted,
    })

    if (options.mergeAdjacentTextContainers === true) {
      appendYjsReadChildren(children, nextChildren)
    } else {
      children.push(...nextChildren)
    }
  }

  const attributes = getYjsAttributes(node)

  return [
    {
      ...attributes,
      type: typeof attributes.type === 'string' ? attributes.type : 'paragraph',
      children: children.length > 0 ? children : [{ text: '' }],
    } as Descendant,
  ]
}

const readSlateValueFromYjsWithOptions = (
  sharedRoot: Y.XmlElement,
  options: { mergeAdjacentTextContainers?: boolean } = {}
): Value | null => {
  if (sharedRoot.length === 0) {
    return null
  }

  const readOptions = {
    ...getYjsTextReadOptions(sharedRoot),
    ...options,
  }

  return normalizeValue(
    sharedRoot
      .toArray()
      .flatMap((child) =>
        isYjsXmlElement(child) || isYjsXmlText(child)
          ? readYjsNode(child, readOptions)
          : []
      ) as Value
  )
}

export const readSlateValueFromYjs = (sharedRoot: Y.XmlElement): Value | null =>
  readSlateValueFromYjsWithOptions(sharedRoot, {
    mergeAdjacentTextContainers: true,
  })

const readSlateValueFromYjsForHistoryRepair = (
  sharedRoot: Y.XmlElement
): Value | null =>
  readSlateValueFromYjsWithOptions(sharedRoot, {
    mergeAdjacentTextContainers: false,
  })

const getYjsTextLeaves = (
  sharedRoot: Y.XmlElement,
  options: { mergeAdjacentTextContainers?: boolean } = {}
): YjsTextLeaf[] => {
  const leaves: YjsTextLeaf[] = []
  const readOptions = getYjsTextReadOptions(sharedRoot)
  const mergeAdjacentTextContainers =
    options.mergeAdjacentTextContainers ?? false

  const visitChildren = (parent: Y.XmlElement, path: number[]) => {
    let slateIndex = 0

    for (const { child, includeDeleted } of getYjsChildEntriesForRead(
      parent,
      readOptions
    )) {
      if (
        isYjsXmlText(child) &&
        isYjsDeleted(child) &&
        includeDeleted !== true
      ) {
        continue
      }

      if (isYjsXmlText(child)) {
        let offset = 0
        const textLeaves = readYjsText(child, readOptions)

        textLeaves.forEach((leaf) => {
          const text = leaf.text
          const start = offset
          const previous = leaves.at(-1)

          offset += text.length
          if (
            mergeAdjacentTextContainers &&
            previous &&
            shouldMergeYjsTextLeaf(previous, leaf, child, path)
          ) {
            leaves.push({
              attributes: getTextAttributes(leaf),
              end: offset,
              path: [...previous.path],
              sharedText: child,
              slateEnd: previous.slateEnd + text.length,
              slateStart: previous.slateEnd,
              start,
              text,
            })
            return
          }

          leaves.push({
            attributes: getTextAttributes(leaf),
            end: offset,
            path: [...path, slateIndex],
            sharedText: child,
            slateEnd: text.length,
            slateStart: 0,
            start,
            text,
          })
          slateIndex++
        })
        continue
      }

      if (isYjsXmlElement(child)) {
        if (isYjsDeleted(child) && includeDeleted !== true) {
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
      attributes: {},
      end: 0,
      path: [0, 0],
      sharedText: new Y.XmlText(),
      slateEnd: 0,
      slateStart: 0,
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
  const readOptions = getYjsTextReadOptions(sharedRoot)

  const visit = (parent: Y.XmlElement) => {
    for (const { child, includeDeleted } of getYjsChildEntriesForRead(
      parent,
      readOptions
    )) {
      if (isYjsXmlText(child)) {
        if (isYjsDeleted(child) && includeDeleted !== true) {
          continue
        }
        textNodes.push(child)
      } else if (isYjsXmlElement(child)) {
        if (isYjsDeleted(child) && includeDeleted !== true) {
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
  value: Value,
  options: { syncDeltaAttributes?: boolean } = {}
) => {
  const textNodes = getYjsTextNodes(sharedRoot)
  const textGroups = getSlateTextGroups(value)

  textNodes.forEach((textNode, index) => {
    const group = textGroups[index]

    if (group) {
      if (options.syncDeltaAttributes) {
        setYjsTextLeaves(textNode, group)
      } else {
        textNode.setAttribute(
          TEXT_LEAVES_ATTRIBUTE,
          createTextLeafMetadata(group)
        )
      }
    }
  })
}

const pointToYjsTextPosition = (
  sharedRoot: Y.XmlElement,
  point: Range['anchor']
) => {
  const leaf = getYjsTextLeaves(sharedRoot, {
    mergeAdjacentTextContainers: true,
  }).find(
    (entry) =>
      PathApi.equals(entry.path, point.path) &&
      point.offset >= entry.slateStart &&
      point.offset <= entry.slateEnd
  )

  if (!leaf) {
    throw new Error(`Cannot map Slate point at ${point.path.join('.')} to Yjs`)
  }
  if (point.offset < 0) {
    throw new Error(`Cannot map Slate point with offset ${point.offset} to Yjs`)
  }

  return {
    index: leaf.start + point.offset - leaf.slateStart,
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
    this.textLeaves = getYjsTextLeaves(this.sharedRoot, {
      mergeAdjacentTextContainers: true,
    })
  }

  slatePointToYjs(point: Range['anchor']) {
    const leaf = this.textLeaves.find(
      (entry) =>
        PathApi.equals(entry.path, point.path) &&
        point.offset >= entry.slateStart &&
        point.offset <= entry.slateEnd
    )

    if (!leaf) {
      throw new Error(
        `Cannot map Slate point at ${point.path.join('.')} to Yjs`
      )
    }
    if (point.offset < 0) {
      throw new Error(
        `Cannot map Slate point with offset ${point.offset} to Yjs`
      )
    }

    return {
      index: leaf.start + point.offset - leaf.slateStart,
      leaf,
      sharedText: leaf.sharedText,
    }
  }

  slateRangeToYjs(_value: Value, range: Range): SlateYjsRelativeRange {
    const anchor = this.slatePointToYjs(range.anchor)
    const focus = this.slatePointToYjs(range.focus)
    const isCollapsed =
      PathApi.equals(range.anchor.path, range.focus.path) &&
      range.anchor.offset === range.focus.offset
    const anchorLeafIndex = anchor.leaf.path.at(-1)
    const collapsedAssoc =
      isCollapsed &&
      typeof anchorLeafIndex === 'number' &&
      anchorLeafIndex > 0 &&
      anchor.leaf.text.length > 0 &&
      range.anchor.offset === 0
        ? 1
        : 0

    return {
      anchor: encodeRelativePosition(
        Y.createRelativePositionFromTypeIndex(
          anchor.sharedText,
          anchor.index,
          isCollapsed ? collapsedAssoc : 0
        )
      ),
      focus: encodeRelativePosition(
        Y.createRelativePositionFromTypeIndex(
          focus.sharedText,
          focus.index,
          isCollapsed ? collapsedAssoc : -1
        )
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

    if (assoc === 0) {
      const emptyLeafAtIndex = leaves.find(
        (leaf) => leaf.text.length === 0 && leaf.start === boundedIndex
      )

      if (emptyLeafAtIndex) {
        return {
          path: [...emptyLeafAtIndex.path],
          offset: emptyLeafAtIndex.slateStart,
        }
      }
    }

    if (assoc > 0) {
      for (let i = 0; i < leaves.length; i++) {
        const leaf = leaves[i]!
        const isLast = i === leaves.length - 1
        const next = leaves[i + 1]

        if (
          leaf.text.length === 0 &&
          !isLast &&
          boundedIndex === leaf.start &&
          next?.start === boundedIndex
        ) {
          continue
        }

        if (
          boundedIndex >= leaf.start &&
          (boundedIndex < leaf.end || isLast || leaf.text.length === 0)
        ) {
          return {
            path: [...leaf.path],
            offset: Math.max(0, leaf.slateStart + boundedIndex - leaf.start),
          }
        }
      }
    }

    if (assoc < 0) {
      for (let i = leaves.length - 1; i >= 0; i--) {
        const leaf = leaves[i]!

        if (boundedIndex >= leaf.start && boundedIndex <= leaf.end) {
          return {
            path: [...leaf.path],
            offset: Math.min(
              leaf.slateEnd,
              leaf.slateStart + boundedIndex - leaf.start
            ),
          }
        }
      }
    }

    for (const leaf of leaves) {
      if (boundedIndex >= leaf.start && boundedIndex <= leaf.end) {
        return {
          path: [...leaf.path],
          offset: Math.max(0, leaf.slateStart + boundedIndex - leaf.start),
        }
      }
    }

    const last = leaves.at(-1)

    return last ? { path: [...last.path], offset: last.slateEnd } : null
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
  slateIndex: number,
  options: YjsReadOptions = {}
): Y.XmlElement | Y.XmlText | null => {
  const wrappedSource = getWrappedSourceNode(parent, options)

  if (wrappedSource) {
    if (isYjsXmlText(wrappedSource)) {
      const leafCount = readYjsText(wrappedSource, options).length

      return slateIndex >= 0 && slateIndex < leafCount ? wrappedSource : null
    }

    return slateIndex === 0 ? wrappedSource : null
  }

  let currentSlateIndex = 0

  for (const child of parent.toArray()) {
    if (isYjsXmlText(child)) {
      if (isYjsDeleted(child)) {
        continue
      }
      const leafCount = readYjsText(child, options).length

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
  const readOptions = getYjsTextReadOptions(sharedRoot)

  for (const index of path) {
    if (!isYjsXmlElement(node)) {
      return null
    }

    const child = getYjsChildForSlateIndex(node, index, readOptions)

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
  length: number,
  options: YjsReadOptions = {}
): Array<Y.XmlElement | Y.XmlText> => {
  const wrappedSource = getWrappedSourceNode(parent, options)

  if (wrappedSource) {
    if (isYjsXmlText(wrappedSource)) {
      const leafCount = readYjsText(wrappedSource, options).length

      return index < leafCount && index + length > 0 ? [wrappedSource] : []
    }

    return index <= 0 && index + length > 0 ? [wrappedSource] : []
  }

  const children: Array<Y.XmlElement | Y.XmlText> = []
  let currentSlateIndex = 0

  for (const child of parent.toArray()) {
    if (isYjsXmlText(child)) {
      if (isYjsDeleted(child)) {
        continue
      }

      const leafCount = readYjsText(child, options).length

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
  slateIndex: number,
  options: YjsReadOptions = {}
) => {
  if (getWrappedSourceNode(parent, options)) {
    return slateIndex <= 0 ? 0 : parent.length
  }

  let currentSlateIndex = 0
  let yjsIndex = 0

  for (const child of parent.toArray()) {
    if (isYjsXmlText(child)) {
      if (isYjsDeleted(child)) {
        yjsIndex++
        continue
      }

      const leafCount = readYjsText(child, options).length

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

const applyTextReplaceChildrenToYjs = (
  sharedText: Y.XmlText,
  operation: Extract<Operation, { type: 'replace_children' }>,
  options: YjsReadOptions
) => {
  if (
    operation.children.length === 0 ||
    operation.newChildren.length === 0 ||
    !operation.children.every((child) => TextApi.isText(child)) ||
    !operation.newChildren.every((child) => TextApi.isText(child))
  ) {
    return false
  }

  const oldLeaves = operation.children as Record<string, unknown>[]
  const newLeaves = operation.newChildren as Record<string, unknown>[]
  const oldText = getSlateText(oldLeaves)
  const newText = getSlateText(newLeaves)
  const currentText = getSlateText(readYjsText(sharedText, options))

  if (currentText !== oldText) {
    return false
  }

  const prefixLength = getCommonPrefixLength(oldText, newText)
  const suffixLength = getCommonSuffixLength(oldText, newText, prefixLength)
  const removedLength = oldText.length - prefixLength - suffixLength
  const insertedLeaves = sliceTextLeaves(
    newLeaves,
    prefixLength,
    newText.length - suffixLength
  )

  if (removedLength > 0) {
    sharedText.delete(prefixLength, removedLength)
  }

  let insertOffset = prefixLength

  for (const leaf of insertedLeaves) {
    const text = typeof leaf.text === 'string' ? leaf.text : ''

    if (text.length === 0) {
      continue
    }

    sharedText.insert(insertOffset, text, getNodeAttributes(leaf))
    insertOffset += text.length
  }

  if (newText.length === 0) {
    sharedText.setAttribute(
      EMPTY_TEXT_ATTRIBUTES,
      getNodeAttributes(newLeaves[0] ?? { text: '' })
    )
  } else {
    sharedText.removeAttribute(EMPTY_TEXT_ATTRIBUTES)
  }
  sharedText.setAttribute(
    TEXT_LEAVES_ATTRIBUTE,
    createTextLeafMetadata(newLeaves)
  )

  return true
}

const applyReplaceChildrenToYjs = (
  sharedRoot: Y.XmlElement,
  operation: Extract<Operation, { type: 'replace_children' }>
) => {
  const parent = getYjsParentAtPath(sharedRoot, operation.path)
  const readOptions = getYjsTextReadOptions(sharedRoot)

  if (!parent) {
    return false
  }

  const replacedChildren = getYjsChildrenForSlateRange(
    parent,
    operation.index,
    operation.children.length,
    readOptions
  )

  if (replacedChildren.length !== operation.children.length) {
    return false
  }

  if (
    replacedChildren.length === 1 &&
    isYjsXmlText(replacedChildren[0]) &&
    applyTextReplaceChildrenToYjs(replacedChildren[0], operation, readOptions)
  ) {
    return true
  }

  for (const child of replacedChildren) {
    child.setAttribute(DELETED_ATTRIBUTE, 'true')
  }

  if (operation.newChildren.length > 0) {
    parent.insert(
      getYjsInsertIndexForSlateIndex(parent, operation.index, readOptions),
      slateNodesToYjsChildren(operation.newChildren as Descendant[])
    )
  }

  return true
}

const applyReplaceFragmentToYjs = (
  sharedRoot: Y.XmlElement,
  operation: Extract<Operation, { type: 'replace_fragment' }>
) =>
  applyReplaceChildrenToYjs(sharedRoot, {
    ...operation,
    index: 0,
    type: 'replace_children',
  })

const getYjsTextDeltaAttributeKeys = (
  delta: YjsTextDeltaEntry[],
  start: number,
  end: number
) => {
  const keys = new Set<string>()
  let offset = 0

  for (const entry of delta) {
    if (typeof entry.insert !== 'string') {
      continue
    }

    const entryStart = offset
    const entryEnd = offset + entry.insert.length

    if (start < entryEnd && entryStart < end && isRecord(entry.attributes)) {
      for (const key of Object.keys(entry.attributes)) {
        keys.add(key)
      }
    }

    offset = entryEnd
  }

  return keys
}

const syncYjsTextDeltaAttributes = (
  sharedText: Y.XmlText,
  currentDelta: YjsTextDeltaEntry[],
  nextDelta: YjsTextLeafDeltaEntry[]
) => {
  let offset = 0

  for (const entry of nextDelta) {
    const length = entry.insert.length
    const nextAttributes = entry.attributes ?? {}
    const keys = getYjsTextDeltaAttributeKeys(
      currentDelta,
      offset,
      offset + length
    )

    for (const key of Object.keys(nextAttributes)) {
      keys.add(key)
    }

    const attributes: Record<string, unknown> = {}

    for (const key of keys) {
      attributes[key] = hasOwn(nextAttributes, key) ? nextAttributes[key] : null
    }

    if (Object.keys(attributes).length > 0) {
      sharedText.format(offset, length, attributes)
    }

    offset += length
  }
}

const setYjsTextLeaves = (
  sharedText: Y.XmlText,
  leaves: Record<string, unknown>[]
) => {
  const nextDelta = createYjsTextLeafDelta(leaves)
  const nextText = leaves
    .map((leaf) => (typeof leaf.text === 'string' ? leaf.text : ''))
    .join('')
  const currentDelta = sharedText.toDelta() as YjsTextDeltaEntry[]
  const currentText = getPlainTextFromDelta(currentDelta)

  if (currentText === nextText) {
    syncYjsTextDeltaAttributes(sharedText, currentDelta, nextDelta)
  } else {
    if (sharedText.length > 0) {
      sharedText.delete(0, sharedText.length)
    }
    if (nextText.length > 0) {
      sharedText.applyDelta(nextDelta, { sanitize: false })
    }
  }

  if (nextText.length === 0) {
    sharedText.setAttribute(
      EMPTY_TEXT_ATTRIBUTES,
      getNodeAttributes(leaves[0] ?? { text: '' })
    )
  } else {
    sharedText.removeAttribute(EMPTY_TEXT_ATTRIBUTES)
  }
  sharedText.setAttribute(TEXT_LEAVES_ATTRIBUTE, createTextLeafMetadata(leaves))
}

const getYjsTextLeafIndex = (
  sharedRoot: Y.XmlElement,
  sharedText: Y.XmlText,
  path: number[]
) => {
  const leaves = getYjsTextLeaves(sharedRoot).filter(
    (leaf) => leaf.sharedText === sharedText
  )

  return leaves.findIndex((leaf) => PathApi.equals(leaf.path, path))
}

const applyTextSplitNodeToYjs = (
  sharedRoot: Y.XmlElement,
  operation: Extract<Operation, { type: 'split_node' }>
) => {
  const readOptions = getYjsTextReadOptions(sharedRoot)
  const leaf = getYjsTextLeaves(sharedRoot).find((entry) =>
    PathApi.equals(entry.path, operation.path)
  )

  if (
    !leaf ||
    operation.position < 0 ||
    operation.position > leaf.text.length
  ) {
    return false
  }

  const leaves = readYjsText(leaf.sharedText, readOptions)
  const leafIndex = getYjsTextLeafIndex(
    sharedRoot,
    leaf.sharedText,
    operation.path
  )

  if (leafIndex === -1) {
    return false
  }

  const textLeaf = leaves[leafIndex]

  if (!textLeaf || typeof textLeaf.text !== 'string') {
    return false
  }

  leaves.splice(
    leafIndex,
    1,
    {
      ...textLeaf,
      text: textLeaf.text.slice(0, operation.position),
    },
    {
      ...(operation.properties as Record<string, unknown>),
      text: textLeaf.text.slice(operation.position),
    }
  )
  setYjsTextLeaves(leaf.sharedText, leaves)

  return true
}

const cloneYjsChild = (
  child: Y.XmlElement | Y.XmlText,
  options: YjsReadOptions = {}
) => {
  if (isYjsXmlText(child)) {
    return createYjsText(readYjsText(child, options))
  }

  const node = readYjsNode(child, options)[0]

  return node && isRecord(node)
    ? createYjsElement(node)
    : createYjsText([{ text: '' }])
}

const getVisibleYjsChildren = (parent: Y.XmlElement) =>
  parent
    .toArray()
    .filter(
      (child): child is Y.XmlElement | Y.XmlText =>
        (isYjsXmlElement(child) || isYjsXmlText(child)) && !isYjsDeleted(child)
    )

const pruneYjsNodeIfEmpty = (node: Y.XmlElement | Y.XmlText) => {
  if (isYjsXmlText(node)) {
    if (node.length > 0) {
      node.delete(0, node.length)
    }
    node.setAttribute(DELETED_ATTRIBUTE, DELETED_IF_EMPTY_ATTRIBUTE)
    node.setAttribute(
      TEXT_LEAVES_ATTRIBUTE,
      createTextLeafMetadata([{ text: '' }])
    )
    return
  }

  for (const child of getVisibleYjsChildren(node)) {
    pruneYjsNodeIfEmpty(child)
  }

  node.setAttribute(DELETED_ATTRIBUTE, DELETED_IF_EMPTY_ATTRIBUTE)
}

const appendYjsChildren = (
  parent: Y.XmlElement,
  children: Array<Y.XmlElement | Y.XmlText>,
  options: YjsReadOptions = {}
) => {
  for (const child of children) {
    parent.insert(parent.length, [cloneYjsChild(child, options)])
  }
}

const applyTextMergeNodeToYjs = (
  sharedRoot: Y.XmlElement,
  operation: Extract<Operation, { type: 'merge_node' }>
) => {
  const readOptions = getYjsTextReadOptions(sharedRoot)
  const leaf = getYjsTextLeaves(sharedRoot).find((entry) =>
    PathApi.equals(entry.path, operation.path)
  )

  if (!leaf) {
    return false
  }

  const slateIndex = operation.path.at(-1)
  const previousPath =
    slateIndex === undefined || slateIndex <= 0
      ? null
      : [...operation.path.slice(0, -1), slateIndex - 1]
  const previousSharedLeaf = previousPath
    ? getYjsTextLeaves(sharedRoot).find((entry) =>
        PathApi.equals(entry.path, previousPath)
      )
    : null

  if (previousSharedLeaf && previousSharedLeaf.sharedText !== leaf.sharedText) {
    if (
      !PathApi.equals(
        previousPath!.slice(0, -1),
        operation.path.slice(0, -1)
      ) ||
      operation.position !== previousSharedLeaf.text.length
    ) {
      return false
    }

    if (leaf.text.length === 0) {
      leaf.sharedText.setAttribute(DELETED_ATTRIBUTE, 'true')
    }

    return true
  }

  const leaves = readYjsText(leaf.sharedText, readOptions)
  const leafIndex = getYjsTextLeafIndex(
    sharedRoot,
    leaf.sharedText,
    operation.path
  )

  if (leafIndex <= 0) {
    return false
  }

  const previousLeaf = leaves[leafIndex - 1]
  const currentLeaf = leaves[leafIndex]

  if (!previousLeaf || !currentLeaf) {
    return false
  }

  leaves.splice(leafIndex - 1, 2, {
    ...previousLeaf,
    text: `${previousLeaf.text}${currentLeaf.text}`,
  })
  setYjsTextLeaves(leaf.sharedText, leaves)

  return true
}

const applyElementMergeNodeToYjs = (
  sharedRoot: Y.XmlElement,
  operation: Extract<Operation, { type: 'merge_node' }>
) => {
  const parentPath = operation.path.slice(0, -1)
  const slateIndex = operation.path.at(-1)
  const parent = getYjsParentAtPath(sharedRoot, parentPath)
  const readOptions = getYjsTextReadOptions(sharedRoot)

  if (!parent || slateIndex === undefined || slateIndex <= 0) {
    return false
  }

  const current = getYjsChildForSlateIndex(parent, slateIndex, readOptions)
  const previous = getYjsChildForSlateIndex(parent, slateIndex - 1, readOptions)

  if (!isYjsXmlElement(current) || !isYjsXmlElement(previous)) {
    return false
  }

  appendYjsChildren(previous, getVisibleYjsChildren(current), readOptions)
  current.setAttribute(DELETED_ATTRIBUTE, 'true')

  return true
}

const applyTextRemoveNodeToYjs = (
  sharedRoot: Y.XmlElement,
  operation: Extract<Operation, { type: 'remove_node' }>
) => {
  const readOptions = getYjsTextReadOptions(sharedRoot)
  const leaf = getYjsTextLeaves(sharedRoot).find((entry) =>
    PathApi.equals(entry.path, operation.path)
  )

  if (!leaf) {
    return false
  }

  const leaves = readYjsText(leaf.sharedText, readOptions)
  const leafIndex = getYjsTextLeafIndex(
    sharedRoot,
    leaf.sharedText,
    operation.path
  )
  const textLeaf = leaves[leafIndex]

  if (leafIndex === -1 || !textLeaf) {
    return false
  }

  if (leaf.text.length > 0) {
    leaf.sharedText.delete(leaf.start, leaf.text.length)
  }
  leaves.splice(leafIndex, 1)

  if (leaves.length > 0) {
    leaf.sharedText.setAttribute(
      TEXT_LEAVES_ATTRIBUTE,
      createTextLeafMetadata(leaves)
    )
  } else {
    leaf.sharedText.setAttribute(
      DELETED_ATTRIBUTE,
      hasSlateText(operation.node) ? 'true' : DELETED_IF_EMPTY_ATTRIBUTE
    )
  }

  return true
}

const applyRemoveNodeToYjs = (
  sharedRoot: Y.XmlElement,
  operation: Extract<Operation, { type: 'remove_node' }>
) => {
  const node = getYjsNodeAtPath(sharedRoot, operation.path)

  if (isYjsXmlText(node)) {
    return applyTextRemoveNodeToYjs(sharedRoot, operation)
  }
  if (isYjsXmlElement(node)) {
    pruneYjsNodeIfEmpty(node)
    return true
  }

  return false
}

const applyMoveNodeToYjs = (
  sharedRoot: Y.XmlElement,
  operation: Extract<Operation, { type: 'move_node' }>
) => {
  const readOptions = getYjsTextReadOptions(sharedRoot)

  if (PathApi.equals(operation.path, operation.newPath)) {
    return true
  }
  if (operation.path.length === 0 || operation.newPath.length === 0) {
    return false
  }
  if (PathApi.isAncestor(operation.path, operation.newPath)) {
    return false
  }

  const current = getYjsNodeAtPath(sharedRoot, operation.path)

  if (!current) {
    return false
  }

  const node = readYjsNode(current, readOptions)[0]
  const sameParentForwardMove =
    operation.path.length === operation.newPath.length &&
    operation.path.at(-1) != null &&
    operation.newPath.at(-1) != null &&
    PathApi.equals(
      operation.path.slice(0, -1),
      operation.newPath.slice(0, -1)
    ) &&
    operation.path.at(-1)! < operation.newPath.at(-1)!
  const truePath = sameParentForwardMove
    ? [...operation.newPath.slice(0, -1), operation.newPath.at(-1)! + 1]
    : PathApi.transform(operation.newPath, {
        node: node ?? { text: '' },
        path: operation.path,
        type: 'remove_node',
      })

  if (!truePath) {
    return false
  }

  const destinationParentPath = truePath.slice(0, -1)
  const destinationIndex = truePath.at(-1)
  const destinationParent = getYjsParentAtPath(
    sharedRoot,
    destinationParentPath
  )

  if (!destinationParent || destinationIndex === undefined) {
    return false
  }

  if (
    isYjsXmlElement(destinationParent) &&
    operation.newPath.length === operation.path.length + 1 &&
    destinationIndex === 0 &&
    getVisibleYjsChildren(destinationParent).length === 0
  ) {
    const refId = getNextMoveRefId(sharedRoot)

    current.setAttribute(MOVE_REF_ID_ATTRIBUTE, refId)
    destinationParent.setAttribute(WRAPPED_SOURCE_ATTRIBUTE, refId)
    current.setAttribute(DELETED_ATTRIBUTE, 'true')

    return true
  }

  destinationParent.insert(
    getYjsInsertIndexForSlateIndex(
      destinationParent,
      destinationIndex,
      readOptions
    ),
    [cloneYjsChild(current, readOptions)]
  )
  current.setAttribute(DELETED_ATTRIBUTE, 'true')

  return true
}

const applyMergeNodeToYjs = (
  sharedRoot: Y.XmlElement,
  operation: Extract<Operation, { type: 'merge_node' }>
) => {
  const node = getYjsNodeAtPath(sharedRoot, operation.path)

  if (isYjsXmlText(node)) {
    return applyTextMergeNodeToYjs(sharedRoot, operation)
  }

  return applyElementMergeNodeToYjs(sharedRoot, operation)
}

const splitYjsTextAtLeafIndex = (
  sharedText: Y.XmlText,
  leafIndex: number,
  options: { preferDeltaMetadata?: boolean } = {}
) => {
  const leaves = readYjsText(sharedText, options)
  const before = leaves.slice(0, leafIndex)
  const after = leaves.slice(leafIndex)
  const beforeTextLength = before.reduce(
    (length, leaf) => length + leaf.text.length,
    0
  )

  if (beforeTextLength < sharedText.length) {
    sharedText.delete(beforeTextLength, sharedText.length - beforeTextLength)
  }
  setYjsTextLeaves(sharedText, before.length > 0 ? before : [{ text: '' }])

  return createYjsText(after.length > 0 ? after : [{ text: '' }])
}

const splitYjsElementChildren = (
  element: Y.XmlElement,
  slatePosition: number,
  options: { preferDeltaMetadata?: boolean } = {}
) => {
  const rightChildren: Array<Y.XmlElement | Y.XmlText> = []
  const rawChildren = element.toArray()
  let slateIndex = 0
  const rawIndexesToDelete: number[] = []

  for (let rawIndex = 0; rawIndex < rawChildren.length; rawIndex++) {
    const child = rawChildren[rawIndex]

    if (!isYjsXmlElement(child) && !isYjsXmlText(child)) {
      continue
    }
    if (isYjsDeleted(child)) {
      continue
    }

    if (isYjsXmlText(child)) {
      const leafCount = readYjsText(child, options).length

      if (slatePosition <= slateIndex) {
        rightChildren.push(cloneYjsChild(child, options))
        rawIndexesToDelete.push(rawIndex)
      } else if (slatePosition < slateIndex + leafCount) {
        rightChildren.push(
          splitYjsTextAtLeafIndex(child, slatePosition - slateIndex, options)
        )
      }

      slateIndex += leafCount
      continue
    }

    if (slateIndex >= slatePosition) {
      rightChildren.push(cloneYjsChild(child, options))
      rawIndexesToDelete.push(rawIndex)
    }

    slateIndex++
  }

  for (let index = rawIndexesToDelete.length - 1; index >= 0; index--) {
    element.delete(rawIndexesToDelete[index]!, 1)
  }

  return rightChildren.length > 0
    ? rightChildren
    : [createYjsText([{ text: '' }])]
}

const applyElementSplitNodeToYjs = (
  sharedRoot: Y.XmlElement,
  operation: Extract<Operation, { type: 'split_node' }>
) => {
  const readOptions = getYjsTextReadOptions(sharedRoot)
  const node = getYjsNodeAtPath(sharedRoot, operation.path)
  const parentPath = operation.path.slice(0, -1)
  const parent = getYjsParentAtPath(sharedRoot, parentPath)
  const slateIndex = operation.path.at(-1)

  if (!isYjsXmlElement(node) || !parent || slateIndex === undefined) {
    return false
  }

  const rightChildren = splitYjsElementChildren(
    node,
    operation.position,
    readOptions
  )
  const nextNode = new Y.XmlElement(ELEMENT_NODE_NAME)
  const attributes = getYjsAttributes(node)
  const nextAttributes = {
    ...attributes,
    ...(operation.properties as Record<string, unknown>),
  }

  if (typeof nextAttributes.type !== 'string') {
    nextAttributes.type =
      typeof attributes.type === 'string' ? attributes.type : 'paragraph'
  }

  for (const [key, value] of Object.entries(nextAttributes)) {
    nextNode.setAttribute(key, clone(value) as string)
  }

  nextNode.insert(0, rightChildren)
  parent.insert(
    getYjsInsertIndexForSlateIndex(parent, slateIndex + 1, readOptions),
    [nextNode]
  )

  return true
}

const applySplitNodeToYjs = (
  sharedRoot: Y.XmlElement,
  operation: Extract<Operation, { type: 'split_node' }>
) => {
  const node = getYjsNodeAtPath(sharedRoot, operation.path)

  if (isYjsXmlText(node)) {
    return applyTextSplitNodeToYjs(sharedRoot, operation)
  }

  return applyElementSplitNodeToYjs(sharedRoot, operation)
}

const SLATE_YJS_OPERATION_TYPES = {
  insert_node: true,
  insert_text: true,
  merge_node: true,
  move_node: true,
  remove_node: true,
  remove_text: true,
  replace_children: true,
  replace_fragment: true,
  set_node: true,
  set_selection: true,
  split_node: true,
} satisfies Record<Operation['type'], true>

const applySlateOperationsToYjs = (
  sharedRoot: Y.XmlElement,
  operations: readonly Operation[],
  nextValue: Value
) => {
  const shouldBackfillDeltaAttributes =
    sharedRoot.getAttribute(VERSION_ATTRIBUTE) == null

  for (const operation of operations) {
    if (SLATE_YJS_OPERATION_TYPES[operation.type] !== true) {
      return false
    }

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
        const readOptions = getYjsTextReadOptions(sharedRoot)

        if (!parent || slateIndex === undefined) {
          return false
        }

        parent.insert(
          getYjsInsertIndexForSlateIndex(parent, slateIndex, readOptions),
          slateNodesToYjsChildren([operation.node as Descendant])
        )
        break
      }
      case 'merge_node': {
        if (!applyMergeNodeToYjs(sharedRoot, operation)) {
          return false
        }
        break
      }
      case 'move_node': {
        if (!applyMoveNodeToYjs(sharedRoot, operation)) {
          return false
        }
        break
      }
      case 'remove_node': {
        if (!applyRemoveNodeToYjs(sharedRoot, operation)) {
          return false
        }
        break
      }
      case 'replace_children': {
        if (!applyReplaceChildrenToYjs(sharedRoot, operation)) {
          return false
        }
        break
      }
      case 'replace_fragment': {
        if (!applyReplaceFragmentToYjs(sharedRoot, operation)) {
          return false
        }
        break
      }
      case 'split_node': {
        if (!applySplitNodeToYjs(sharedRoot, operation)) {
          return false
        }
        break
      }
      default: {
        const exhaustive: never = operation

        return exhaustive
      }
    }
  }

  syncYjsTextMetadataFromValue(sharedRoot, nextValue, {
    syncDeltaAttributes: shouldBackfillDeltaAttributes,
  })
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
          attributes: getTextAttributes(child),
          end: text.length,
          path: childPath,
          slateEnd: text.length,
          slateStart: 0,
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

const repairTextMergeHistoryOperation = (
  operation: Extract<Operation, { type: 'merge_node' }>,
  value: Value
) => {
  const node = getTextNode(value, operation.path)

  if (!node) {
    return true
  }

  const slateIndex = operation.path.at(-1)

  if (slateIndex === undefined || slateIndex <= 0) {
    return true
  }

  const previousNode = getTextNode(value, [
    ...operation.path.slice(0, -1),
    slateIndex - 1,
  ])
  const previousText =
    typeof previousNode?.text === 'string' ? previousNode.text : null

  if (previousText == null) {
    return true
  }

  operation.position = previousText.length

  return true
}

const operationPropertyMatchesNode = (
  node: Record<string, unknown>,
  key: string,
  expected: unknown
) => {
  if (!Object.hasOwn(node, key)) {
    return expected == null
  }

  return jsonEqual(node[key], expected)
}

const isStaleSetNodeHistoryOperation = (
  operation: Extract<Operation, { type: 'set_node' }>,
  value: Value,
  mode: TextHistoryReplayMode
) => {
  const replayOperation =
    mode === 'undo'
      ? (OperationApi.inverse(operation) as Extract<
          Operation,
          { type: 'set_node' }
        >)
      : operation
  const node = getNode(value, replayOperation.path)

  if (!node) {
    return true
  }

  return Object.entries(replayOperation.properties).some(([key, expected]) => {
    return !operationPropertyMatchesNode(node, key, expected)
  })
}

const getOnlyTextDescendant = (
  node: unknown,
  path: number[] = []
): { path: number[]; text: string } | null => {
  if (!isRecord(node)) {
    return null
  }

  if (typeof node.text === 'string') {
    return { path, text: node.text }
  }

  if (!Array.isArray(node.children)) {
    return null
  }

  let textDescendant: { path: number[]; text: string } | null = null

  for (const [index, child] of node.children.entries()) {
    const next = getOnlyTextDescendant(child, [...path, index])

    if (!next || next.text.length === 0) {
      continue
    }
    if (textDescendant) {
      return null
    }

    textDescendant = next
  }

  return textDescendant
}

const repairRemoveNodeHistoryOperation = (
  operation: Extract<Operation, { type: 'remove_node' }>,
  value: Value,
  mode: TextHistoryReplayMode
): Operation => {
  if (mode !== 'undo') {
    return operation
  }

  const removedText = getOnlyTextDescendant(operation.node)

  if (!removedText) {
    return operation
  }

  const path = [...operation.path, ...removedText.path]
  const node = getTextNode(value, path)

  if (!node || typeof node.text !== 'string') {
    return operation
  }

  return {
    path,
    offset: 0,
    text: removedText.text,
    type: 'remove_text',
  }
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

    if (batch.operations) {
      batch.operations = batch.operations.map((operation) =>
        operation.type === 'remove_node'
          ? repairRemoveNodeHistoryOperation(operation, value, mode)
          : operation
      )
    }

    for (const operation of batch.operations ?? []) {
      if (
        operation.type === 'merge_node' &&
        !repairTextMergeHistoryOperation(operation, value)
      ) {
        keepBatch = false
        break
      }

      if (
        operation.type === 'set_node' &&
        isStaleSetNodeHistoryOperation(operation, value, mode)
      ) {
        keepBatch = false
        break
      }

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
              repairHistoryTextOperations(
                context.editor,
                readSlateValueFromYjsForHistoryRepair(this.sharedRoot) ??
                  children
              )
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

    let selectionAfter = commit.selectionAfter

    if (commit.tags.includes('historic')) {
      const sharedValue = readSlateValueFromYjs(this.sharedRoot)

      if (sharedValue && !jsonEqual(sharedValue, children)) {
        this.replaceEditorValue(sharedValue, commit.selectionAfter)
        selectionAfter = getEditorSnapshot(this.editor).selection
      }
    }

    this.exports++
    this.exportSelection(selectionAfter)
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

      if (!sharedValue) {
        return false
      }

      if (!jsonEqual(sharedValue, children)) {
        this.replaceEditorValue(
          sharedValue,
          getEditorSnapshot(this.editor!).selection
        )
      }

      return true
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
