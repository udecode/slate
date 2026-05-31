import { NodeApi, PathApi, type Point, type Range } from 'slate'
import { DOMCoverage } from 'slate-dom/internal'

import type { ReactRuntimeEditor } from '../plugin/react-editor'
import { Editor } from './runtime-editor-api'

type VerticalExtensionEvent = Pick<
  KeyboardEvent,
  'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'
>

export const getPlainVerticalExtensionReverse = (
  event: VerticalExtensionEvent
) => {
  if (event.altKey || event.ctrlKey || event.metaKey || !event.shiftKey) {
    return null
  }

  if (event.key === 'ArrowUp') {
    return true
  }

  if (event.key === 'ArrowDown') {
    return false
  }

  return null
}

type PlainVerticalDOMCoverageExtension = {
  reverse: boolean
  target: Point
}

type ResolvedDOMPoint = [globalThis.Node, number]

const VERTICAL_LINE_EDGE_TOLERANCE = 2

const getUsableRects = (range: globalThis.Range) =>
  Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 || rect.height > 0
  )

const getRenderedLineHostFromDOMPoint = (domPoint: ResolvedDOMPoint) => {
  const [node] = domPoint
  const element =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement

  const textHost =
    element?.closest<HTMLElement>('[data-slate-node="text"]') ?? null

  return (
    textHost?.closest<HTMLElement>(
      '[data-slate-node="element"][data-slate-path]'
    ) ?? textHost
  )
}

const getPointProbeRect = (domPoint: ResolvedDOMPoint) => {
  const [node, offset] = domPoint

  if (node.nodeType !== Node.TEXT_NODE) {
    return node instanceof Element ? node.getBoundingClientRect() : null
  }

  if (!node.ownerDocument) {
    return null
  }

  const text = node.textContent ?? ''
  const range = node.ownerDocument.createRange()
  const start =
    offset >= text.length ? Math.max(0, text.length - 1) : Math.max(0, offset)
  const end =
    offset >= text.length
      ? text.length
      : Math.min(text.length, Math.max(offset + 1, 1))

  if (end <= start) {
    return null
  }

  range.setStart(node, start)
  range.setEnd(node, end)

  return getUsableRects(range)[0] ?? range.getBoundingClientRect()
}

const isLeavingRenderedLine = ({
  editor,
  point,
  reverse,
}: {
  editor: ReactRuntimeEditor
  point: Point
  reverse: boolean
}) => {
  try {
    const domPoint = editor.api.dom.resolveDOMPoint(point)

    if (!domPoint) {
      return true
    }

    const lineHost = getRenderedLineHostFromDOMPoint(domPoint)

    if (!lineHost) {
      return true
    }

    const range = lineHost.ownerDocument.createRange()
    range.selectNodeContents(lineHost)
    const lineRects = getUsableRects(range)

    if (lineRects.length <= 1) {
      return true
    }

    const pointRect = getPointProbeRect(domPoint)

    if (!pointRect) {
      return true
    }

    const pointMiddle = pointRect.top + pointRect.height / 2
    const firstLine = lineRects[0]
    const lastLine = lineRects.at(-1)

    if (!firstLine || !lastLine) {
      return true
    }

    return reverse
      ? pointMiddle <= firstLine.bottom + VERTICAL_LINE_EDGE_TOLERANCE
      : pointMiddle >= lastLine.top - VERTICAL_LINE_EDGE_TOLERANCE
  } catch {
    return true
  }
}

const isSameBlockPoint = ({
  editor,
  left,
  right,
}: {
  editor: ReactRuntimeEditor
  left: Point
  right: Point
}) => {
  const leftBlock = Editor.above(editor, {
    at: left,
    match: (node) => NodeApi.isElement(node) && Editor.isBlock(editor, node),
  })
  const rightBlock = Editor.above(editor, {
    at: right,
    match: (node) => NodeApi.isElement(node) && Editor.isBlock(editor, node),
  })

  return (
    !!leftBlock && !!rightBlock && PathApi.equals(leftBlock[1], rightBlock[1])
  )
}

const getUnselectedMaterializeBoundariesForRange = ({
  editor,
  range,
  selectedBoundaryIds,
}: {
  editor: ReactRuntimeEditor
  range: Range
  selectedBoundaryIds: Set<string>
}) =>
  DOMCoverage.getBoundariesForRange(editor, range).filter(
    (boundary) =>
      boundary.selectionPolicy === 'materialize' &&
      !selectedBoundaryIds.has(boundary.boundaryId)
  )

export const getPlainVerticalDOMCoverageExtension = ({
  editor,
  event,
  selection = editor.read((state) => state.selection.get()),
}: {
  editor: ReactRuntimeEditor
  event: VerticalExtensionEvent
  selection?: Range | null
}): PlainVerticalDOMCoverageExtension | null => {
  const reverse = getPlainVerticalExtensionReverse(event)

  if (reverse === null || !selection) {
    return null
  }

  const nextFocus = reverse
    ? Editor.before(editor, selection.focus, { unit: 'line' })
    : Editor.after(editor, selection.focus, { unit: 'line' })

  if (!nextFocus) {
    return null
  }

  const selectedBoundaryIds = new Set(
    DOMCoverage.getBoundariesForRange(editor, selection).map(
      (boundary) => boundary.boundaryId
    )
  )
  const focusMovementRange = {
    anchor: selection.focus,
    focus: nextFocus,
  }

  if (
    getUnselectedMaterializeBoundariesForRange({
      editor,
      range: focusMovementRange,
      selectedBoundaryIds,
    }).length > 0
  ) {
    return { reverse, target: nextFocus }
  }

  if (
    !isSameBlockPoint({ editor, left: selection.focus, right: nextFocus }) ||
    !isLeavingRenderedLine({ editor, point: selection.focus, reverse })
  ) {
    return null
  }

  const boundaryFocus = reverse
    ? Editor.before(editor, nextFocus, { unit: 'line' })
    : Editor.after(editor, nextFocus, { unit: 'line' })

  if (!boundaryFocus) {
    return null
  }

  const boundaryMovementRange = {
    anchor: nextFocus,
    focus: boundaryFocus,
  }

  return getUnselectedMaterializeBoundariesForRange({
    editor,
    range: boundaryMovementRange,
    selectedBoundaryIds,
  }).length > 0
    ? { reverse, target: boundaryFocus }
    : null
}

export const shouldModelOwnPlainVerticalDOMCoverageExtension = ({
  editor,
  event,
  selection,
}: {
  editor: ReactRuntimeEditor
  event: VerticalExtensionEvent
  selection?: Range | null
}) =>
  getPlainVerticalDOMCoverageExtension({
    editor,
    event,
    selection,
  }) !== null
