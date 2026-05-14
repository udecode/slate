import {
  type Descendant,
  type Operation,
  OperationApi,
  type Path,
  PathApi,
  type Point,
  type Range,
  type Editor as SlateEditor,
  TextApi,
  type Value,
} from 'slate'
import { Editor } from 'slate/internal'
import * as Y from 'yjs'

import type {
  EncodedYRelativePosition,
  YjsApplyEventsInput,
  YjsEncodeCommitInput,
  YjsPointMappingInput,
  YjsPointOptions,
  YjsRelativeRange,
} from './types'

export const SLATE_YJS_VALUE_ATTRIBUTE = 'slate:value'
export const SLATE_YJS_OPERATIONS_ATTRIBUTE = 'slate:operations'
export const SLATE_YJS_VERSION_ATTRIBUTE = 'slate:version'

export const remoteYjsUpdateOptions = {
  metadata: {
    collab: { origin: 'remote', saveToHistory: false },
    history: { mode: 'skip' },
    selection: { dom: 'preserve', focus: false, scroll: false },
  },
  tag: ['collaboration', 'remote-import'],
} as const

type TextSpan = {
  end: number
  path: Path
  start: number
  text: string
}

const emptyParagraph = (): Descendant => ({
  type: 'paragraph',
  children: [{ text: '' }],
})

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const normalizeSlateValue = (value: unknown): Value => {
  if (!Array.isArray(value) || value.length === 0) {
    return [emptyParagraph()] as Value
  }

  return clone(value) as Value
}

const valueFromInput = (input: YjsPointMappingInput): Value =>
  Array.isArray(input) ? input : Editor.getSnapshot(input).children

const collectTextSpans = (value: Value): TextSpan[] => {
  const spans: TextSpan[] = []
  let offset = 0

  const visit = (node: Descendant, path: Path) => {
    if (TextApi.isText(node)) {
      const text = node.text
      const start = offset
      offset += text.length
      spans.push({ end: offset, path, start, text })

      return
    }

    node.children.forEach((child, index) => {
      visit(child as Descendant, [...path, index])
    })
  }

  value.forEach((node, index) => {
    visit(node as Descendant, [index])
  })

  if (spans.length === 0) {
    spans.push({ end: 0, path: [0, 0], start: 0, text: '' })
  }

  return spans
}

export const slateValueToYText = (value: Value): string =>
  collectTextSpans(value)
    .map((span) => span.text)
    .join('')

const getTextAtPath = (value: Value, path: Path): { text: string } | null => {
  let node: unknown = { children: value }

  for (const index of path) {
    if (
      node &&
      typeof node === 'object' &&
      'children' in node &&
      Array.isArray((node as { children: unknown[] }).children)
    ) {
      node = (node as { children: unknown[] }).children[index]
    } else {
      return null
    }
  }

  return TextApi.isText(node) ? node : null
}

const setTextAtPath = (value: Value, path: Path, text: string) => {
  const node = getTextAtPath(value, path)

  if (node) {
    node.text = text
  }
}

const valueWithLinearText = (value: Value, text: string): Value => {
  const nextValue = clone(value)
  const spans = collectTextSpans(nextValue)
  let offset = 0

  spans.forEach((span, index) => {
    const length =
      index === spans.length - 1 ? text.length - offset : span.text.length
    const nextText = text.slice(offset, offset + Math.max(0, length))

    setTextAtPath(nextValue, span.path, nextText)
    offset += Math.max(0, length)
  })

  return nextValue
}

export const isSlateRangeInValue = (
  value: Value,
  range: Range | null
): range is Range => {
  if (!range) {
    return false
  }

  for (const point of [range.anchor, range.focus]) {
    const text = getTextAtPath(value, point.path)

    if (!text || point.offset < 0 || point.offset > text.text.length) {
      return false
    }
  }

  return true
}

export const slatePointToTextOffset = (value: Value, point: Point): number => {
  const spans = collectTextSpans(value)
  const span = spans.find((candidate) =>
    PathApi.equals(candidate.path, point.path)
  )

  if (!span) {
    throw new Error(`Cannot map Slate point at ${point.path.join('.')} to Yjs`)
  }

  if (point.offset < 0 || point.offset > span.text.length) {
    throw new Error(`Cannot map Slate point with offset ${point.offset} to Yjs`)
  }

  return span.start + point.offset
}

export const textOffsetToSlatePoint = (
  value: Value,
  offset: number,
  assoc = 0
): Point | null => {
  const spans = collectTextSpans(value)

  if (spans.length === 0) {
    return null
  }

  const clampedOffset = Math.max(0, Math.min(offset, spans.at(-1)?.end ?? 0))

  if (assoc < 0) {
    for (let index = spans.length - 1; index >= 0; index--) {
      const span = spans[index]!

      if (clampedOffset >= span.start && clampedOffset <= span.end) {
        return {
          path: [...span.path],
          offset: Math.min(span.text.length, clampedOffset - span.start),
        }
      }
    }
  }

  for (const span of spans) {
    if (clampedOffset >= span.start && clampedOffset <= span.end) {
      return {
        path: [...span.path],
        offset: Math.max(0, clampedOffset - span.start),
      }
    }
  }

  const last = spans.at(-1)

  return last ? { path: [...last.path], offset: last.text.length } : null
}

export const encodeYRelativePosition = (
  position: Y.RelativePosition
): EncodedYRelativePosition => Array.from(Y.encodeRelativePosition(position))

export const decodeYRelativePosition = (
  position: EncodedYRelativePosition
): Y.RelativePosition => Y.decodeRelativePosition(Uint8Array.from(position))

export const slatePointToYRelativePosition = (
  sharedRoot: Y.XmlText,
  input: YjsPointMappingInput,
  point: Point,
  options: YjsPointOptions = {}
): Y.RelativePosition => {
  const offset = slatePointToTextOffset(valueFromInput(input), point)

  return Y.createRelativePositionFromTypeIndex(
    sharedRoot,
    Math.min(offset, sharedRoot.length),
    options.assoc ?? 0
  )
}

export const yRelativePositionToSlatePoint = (
  sharedRoot: Y.XmlText,
  input: YjsPointMappingInput,
  position: Y.RelativePosition
): Point | null => {
  const doc = sharedRoot.doc

  if (!doc) {
    throw new Error(
      'Cannot resolve a Yjs relative position before sharedRoot is attached to a Y.Doc'
    )
  }

  const absolute = Y.createAbsolutePositionFromRelativePosition(position, doc)

  if (!absolute || absolute.type !== sharedRoot) {
    return null
  }

  return textOffsetToSlatePoint(
    valueFromInput(input),
    absolute.index,
    absolute.assoc
  )
}

export const slateRangeToYRelativeRange = (
  sharedRoot: Y.XmlText,
  input: YjsPointMappingInput,
  range: Range
): YjsRelativeRange => ({
  anchor: slatePointToYRelativePosition(sharedRoot, input, range.anchor, {
    assoc: 0,
  }),
  focus: slatePointToYRelativePosition(sharedRoot, input, range.focus, {
    assoc: -1,
  }),
})

export const yRelativeRangeToSlateRange = (
  sharedRoot: Y.XmlText,
  input: YjsPointMappingInput,
  range: YjsRelativeRange
): Range | null => {
  const anchor = yRelativePositionToSlatePoint(sharedRoot, input, range.anchor)
  const focus = yRelativePositionToSlatePoint(sharedRoot, input, range.focus)

  return anchor && focus ? { anchor, focus } : null
}

const replaceYTextContent = (sharedRoot: Y.XmlText, next: string) => {
  const current = sharedRoot.toString()

  if (current === next) {
    return
  }

  let prefix = 0
  while (
    prefix < current.length &&
    prefix < next.length &&
    current[prefix] === next[prefix]
  ) {
    prefix++
  }

  let suffix = 0
  while (
    suffix < current.length - prefix &&
    suffix < next.length - prefix &&
    current.at(-1 - suffix) === next.at(-1 - suffix)
  ) {
    suffix++
  }

  const deleteLength = current.length - prefix - suffix
  const insertText = next.slice(prefix, next.length - suffix)

  if (deleteLength > 0) {
    sharedRoot.delete(prefix, deleteLength)
  }
  if (insertText.length > 0) {
    sharedRoot.insert(prefix, insertText)
  }
}

export const writeSlateValueToYjs = (sharedRoot: Y.XmlText, value: Value) => {
  const normalized = normalizeSlateValue(value)
  replaceYTextContent(sharedRoot, slateValueToYText(normalized))
  sharedRoot.setAttribute(SLATE_YJS_VALUE_ATTRIBUTE, normalized)
  sharedRoot.setAttribute(
    SLATE_YJS_VERSION_ATTRIBUTE,
    Number(sharedRoot.getAttribute(SLATE_YJS_VERSION_ATTRIBUTE) ?? 0) + 1
  )
}

export const readSlateValueFromYjs = (sharedRoot: Y.XmlText): Value | null => {
  const stored = sharedRoot.getAttribute(SLATE_YJS_VALUE_ATTRIBUTE)

  if (stored) {
    const normalized = normalizeSlateValue(stored)
    const text = sharedRoot.toString()

    return slateValueToYText(normalized) === text
      ? normalized
      : valueWithLinearText(normalized, text)
  }

  if (sharedRoot.length === 0) {
    return null
  }

  return [
    {
      type: 'paragraph',
      children: [{ text: sharedRoot.toString() }],
    },
  ] as Value
}

export const readSlateOperationsFromYjs = (
  sharedRoot: Y.XmlText
): Operation[] => {
  const operations = sharedRoot.getAttribute(SLATE_YJS_OPERATIONS_ATTRIBUTE)

  return OperationApi.isOperationList(operations)
    ? (clone(operations) as Operation[])
    : []
}

export const encodeSlateCommitToYjs = ({
  editor,
  operations,
  origin,
  sharedRoot,
}: YjsEncodeCommitInput) => {
  const doc = sharedRoot.doc
  const value = Editor.getSnapshot(editor).children

  if (!doc) {
    throw new Error(
      'Cannot encode Slate commits before sharedRoot is attached to a Y.Doc'
    )
  }

  doc.transact(() => {
    writeSlateValueToYjs(sharedRoot, value)
    sharedRoot.setAttribute(SLATE_YJS_OPERATIONS_ATTRIBUTE, clone(operations))
  }, origin)
}

export const reconcileYjsSnapshot = (
  editor: SlateEditor,
  sharedRoot: Y.XmlText
) => {
  const value = readSlateValueFromYjs(sharedRoot)

  if (!value) {
    return false
  }

  const snapshot = Editor.getSnapshot(editor)
  const selection = isSlateRangeInValue(value, snapshot.selection)
    ? snapshot.selection
    : null

  editor.update((tx) => {
    tx.value.replace({
      children: value,
      marks: snapshot.marks,
      selection,
    })
  }, remoteYjsUpdateOptions)

  return true
}

export const applyYjsEventsToEditor = ({
  editor,
  events = [],
  sharedRoot,
}: YjsApplyEventsInput) => {
  for (const event of events) {
    void event.delta
  }

  const operations = readSlateOperationsFromYjs(sharedRoot)

  if (operations.length > 0) {
    try {
      editor.update((tx) => {
        tx.operations.replay(operations)
      }, remoteYjsUpdateOptions)

      const remoteValue = readSlateValueFromYjs(sharedRoot)

      if (
        remoteValue &&
        JSON.stringify(Editor.getSnapshot(editor).children) !==
          JSON.stringify(remoteValue)
      ) {
        return reconcileYjsSnapshot(editor, sharedRoot)
      }

      return true
    } catch {
      return reconcileYjsSnapshot(editor, sharedRoot)
    }
  }

  return reconcileYjsSnapshot(editor, sharedRoot)
}

export const applyYjsSnapshotToEditor = reconcileYjsSnapshot
