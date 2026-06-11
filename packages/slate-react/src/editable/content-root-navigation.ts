import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  type Descendant,
  type Element,
  NodeApi,
  type Path,
  PathApi,
  type Point,
  type Range,
  RangeApi,
  type RootKey,
} from 'slate'
import { Hotkeys } from 'slate-dom'
import { EDITOR_TO_ROOT_VIEW_EDITORS } from 'slate-dom/internal'
import { scheduleSlateReactFocus } from '../hooks/focus-scheduler'
import type { ReactRuntimeEditor } from '../plugin/react-editor'
import {
  createSlateViewBoundaryGraph,
  getSlateBoundaryPoint,
  getSlateDescendantAtPath,
  getSlatePointRoot,
  getSlateRootBoundaryPoint,
  getSlateViewBoundaryPointRoot,
  resolveSlateViewBoundarySegmentEndpoint,
  rootSlatePoint,
  SlateViewBoundaryGraph,
  type SlateViewBoundaryGraphModel,
  type SlateViewBoundaryGraphNodeInput,
  type SlateViewBoundaryPoint,
  sameSlateRootPoint,
} from '../view-boundary-graph'
import {
  createSlateViewSelection,
  readSlateViewSelection,
  type SlateViewSelection,
  writeSlateViewSelection,
} from '../view-selection'
import type { EditableCommand } from './editable-command-types'
import { Editor, getEditorExtensionRegistry } from './runtime-editor-api'

type ContentRootNavigationDirection = 'backward' | 'forward'
type ContentRootNavigationAxis = 'horizontal' | 'line' | 'vertical' | 'word'

type ContentRootNavigationAction =
  | {
      direction: ContentRootNavigationDirection
      kind: 'document-boundary'
    }
  | {
      kind: 'enter'
    }
  | {
      axis: ContentRootNavigationAxis
      direction: ContentRootNavigationDirection
      kind: 'move'
    }

type ContentRootViewSelectionAction =
  | {
      axis: ContentRootNavigationAxis
      direction: ContentRootNavigationDirection
      kind: 'move'
    }
  | {
      direction: ContentRootNavigationDirection
      kind: 'document-boundary'
    }

type SelectionMoveCommand = Extract<EditableCommand, { kind: 'move-selection' }>

export type ContentRootOwner = {
  childRoot: RootKey
  ownerPath: Path
  ownerRoot: RootKey
}

type ContentRootAdjacentBoundary = {
  path: Path
  point: Point
}

type ContentRootNavigationTarget = {
  owner?: ContentRootOwner
  point: Point
  root: RootKey
}

export type ContentRootNavigationResult = {
  handled: boolean
  target?: ContentRootNavigationTarget
}

type ContentRootNavigationEditor = Pick<
  ReactRuntimeEditor,
  'api' | 'read' | 'update'
>

const isRootKey = (value: unknown): value is RootKey =>
  typeof value === 'string' && value.length > 0

const getChildRoot = (element: Element, slot: string): RootKey | null => {
  const childRoots = (element as { childRoots?: unknown }).childRoots

  if (
    typeof childRoots !== 'object' ||
    childRoots === null ||
    !Object.hasOwn(childRoots, slot)
  ) {
    return null
  }

  const childRoot = (childRoots as Record<string, unknown>)[slot]

  return isRootKey(childRoot) ? childRoot : null
}

const isPointInPath = (point: Point, path: Path) =>
  PathApi.equals(point.path, path) || PathApi.isDescendant(point.path, path)

const rootedRange = (point: Point, root: RootKey): Range => {
  const rooted = rootSlatePoint(point, root)

  return {
    anchor: rooted,
    focus: rooted,
  }
}

const hasContentRootElementSpec = (editor: ContentRootNavigationEditor) => {
  const registry = getEditorExtensionRegistry(editor as ReactRuntimeEditor)

  for (const registration of registry.elementSpecs.values()) {
    if (registration.spec.contentRoot?.slot) {
      return true
    }
  }

  return false
}

const getRegisteredRootViewEditor = (
  editor: ReactRuntimeEditor,
  root: RootKey
): ReactRuntimeEditor | null => {
  const viewEditors = EDITOR_TO_ROOT_VIEW_EDITORS.get(editor as any)

  if (!viewEditors) {
    return null
  }

  for (const viewEditor of viewEditors) {
    if (viewEditor.read((state) => state.view.root()) === root) {
      return viewEditor as ReactRuntimeEditor
    }
  }

  return null
}

export const findContentRootOwners = (
  editor: ContentRootNavigationEditor
): ContentRootOwner[] =>
  editor.read((state) => {
    const owners: ContentRootOwner[] = []
    const { roots } = state.value.get()

    const visit = (node: Descendant, ownerRoot: RootKey, ownerPath: Path) => {
      if (!NodeApi.isElement(node)) {
        return
      }

      const slot = state.schema.getElementSpec(node.type)?.contentRoot?.slot
      const childRoot = slot ? getChildRoot(node, slot) : null

      if (childRoot) {
        owners.push({
          childRoot,
          ownerPath: [...ownerPath],
          ownerRoot,
        })
      }

      node.children.forEach((child, index) => {
        visit(child, ownerRoot, ownerPath.concat(index))
      })
    }

    for (const [ownerRoot, children] of Object.entries(roots)) {
      children.forEach((child, index) => {
        visit(child, ownerRoot, [index])
      })
    }

    return owners
  })

const isKnownContentRootOwner = (
  owners: readonly ContentRootOwner[],
  owner: ContentRootOwner | null | undefined
): owner is ContentRootOwner =>
  !!owner &&
  owners.some(
    (candidate) =>
      candidate.childRoot === owner.childRoot &&
      candidate.ownerRoot === owner.ownerRoot &&
      PathApi.equals(candidate.ownerPath, owner.ownerPath)
  )

const getContentRootOwnerKey = (owner: ContentRootOwner) =>
  `${owner.ownerRoot}\u0000${owner.ownerPath.join('.')}\u0000${owner.childRoot}`

const isSameContentRootOwner = (
  left: ContentRootOwner | null | undefined,
  right: ContentRootOwner | null | undefined
) =>
  (!left && !right) ||
  Boolean(
    left &&
      right &&
      left.childRoot === right.childRoot &&
      left.ownerRoot === right.ownerRoot &&
      PathApi.equals(left.ownerPath, right.ownerPath)
  )

const getOwnerForCurrentViewEditor = ({
  editor,
  getContentRootOwnerViewEditor,
  owners,
}: {
  editor: ContentRootNavigationEditor
  getContentRootOwnerViewEditor?: (
    owner: ContentRootOwner
  ) => ReactRuntimeEditor | null
  owners: readonly ContentRootOwner[]
}): ContentRootOwner | null => {
  if (!getContentRootOwnerViewEditor) {
    return null
  }

  const viewEditor = editor as ReactRuntimeEditor

  return (
    owners.find(
      (owner) => getContentRootOwnerViewEditor(owner) === viewEditor
    ) ?? null
  )
}

const getOwnerForRoot = ({
  currentRoot,
  getActiveContentRootOwner,
  owners,
}: {
  currentRoot: RootKey
  getActiveContentRootOwner?: (root: RootKey) => ContentRootOwner | null
  owners: readonly ContentRootOwner[]
}): ContentRootOwner | null => {
  const activeOwner = getActiveContentRootOwner?.(currentRoot)

  return isKnownContentRootOwner(owners, activeOwner)
    ? activeOwner
    : (owners.find((owner) => owner.childRoot === currentRoot) ?? null)
}

const getTopLevelOwner = (
  owners: readonly ContentRootOwner[],
  root: RootKey,
  path: Path
) =>
  owners.find(
    (owner) =>
      owner.ownerRoot === root &&
      owner.ownerPath.length === path.length &&
      PathApi.equals(owner.ownerPath, path)
  ) ?? null

const hasNestedOwner = (
  owners: readonly ContentRootOwner[],
  root: RootKey,
  path: Path
) =>
  owners.some(
    (owner) =>
      owner.ownerRoot === root &&
      owner.ownerPath.length > path.length &&
      PathApi.isAncestor(path, owner.ownerPath)
  )

export const createContentRootProjectionGraph = (
  editor: ContentRootNavigationEditor,
  owners: readonly ContentRootOwner[]
) =>
  editor.read((state) => {
    const nodes: SlateViewBoundaryGraphNodeInput[] = []
    const { roots } = state.value.get()

    const appendRoot = (
      root: RootKey,
      owner: ContentRootOwner | null,
      ownerStack: ReadonlySet<string>
    ) => {
      const children = roots[root] ?? []

      const appendNode = (node: Descendant, path: Path) => {
        const childOwner = getTopLevelOwner(owners, root, path)

        if (childOwner) {
          const ownerKey = getContentRootOwnerKey(childOwner)

          if (!ownerStack.has(ownerKey)) {
            appendRoot(
              childOwner.childRoot,
              childOwner,
              new Set([...ownerStack, ownerKey])
            )
            return
          }
        }

        if (NodeApi.isElement(node) && hasNestedOwner(owners, root, path)) {
          node.children.forEach((child, index) => {
            appendNode(child, path.concat(index))
          })
          return
        }

        nodes.push({
          ...(owner ? { owner } : {}),
          path,
          root,
        })
      }

      children.forEach((child, index) => {
        appendNode(child, [index])
      })
    }

    appendRoot('main', null, new Set())

    return createSlateViewBoundaryGraph(nodes)
  })

const toProjectedPoint = ({
  owner,
  point,
  root,
}: {
  owner: ContentRootOwner | null | undefined
  point: Point
  root: RootKey
}): SlateViewBoundaryPoint => ({
  ...(owner ? { owner } : {}),
  point: rootSlatePoint(point, root),
})

const collapseNativeSelectionForProjectedSelection = (
  editor: ReactRuntimeEditor,
  selection: Range | null
) => {
  if (!selection) {
    return
  }

  const domApi = editor.api.dom

  if (!domApi) {
    return
  }

  let document: Document

  try {
    document = domApi.getWindow().document
  } catch {
    return
  }

  const domSelection = document.getSelection()

  if (!domSelection) {
    return
  }

  const clear = () => {
    domSelection.removeAllRanges()
  }

  clear()
  document.defaultView?.queueMicrotask(clear)
  document.defaultView?.requestAnimationFrame(clear)
}

const collapseModelSelectionForProjectedSelection = (
  editor: ReactRuntimeEditor,
  selection: Range | null
) => {
  if (!selection) {
    return
  }

  const range = {
    anchor: selection.anchor,
    focus: selection.anchor,
  }

  if (RangeApi.equals(selection, range)) {
    return
  }

  editor.update((tx) => {
    tx.selection.set(range)
  })
}

const getSiblingBoundary = ({
  children,
  ownerPath,
  side,
}: {
  children: readonly Descendant[]
  ownerPath: Path
  side: 'after' | 'before'
}): ContentRootAdjacentBoundary | null => {
  if (ownerPath.length === 0) {
    return null
  }

  const siblingPath =
    side === 'before'
      ? PathApi.hasPrevious(ownerPath)
        ? PathApi.previous(ownerPath)
        : null
      : PathApi.next(ownerPath)

  if (!siblingPath) {
    return null
  }

  const sibling = getSlateDescendantAtPath(children, siblingPath)

  if (!sibling) {
    return null
  }

  const point = getSlateBoundaryPoint(
    sibling,
    siblingPath,
    side === 'before' ? 'end' : 'start'
  )

  return point
    ? {
        path: siblingPath,
        point,
      }
    : null
}

const getSiblingBoundaryPoint = ({
  children,
  ownerPath,
  side,
}: {
  children: readonly Descendant[]
  ownerPath: Path
  side: 'after' | 'before'
}): Point | null =>
  getSiblingBoundary({
    children,
    ownerPath,
    side,
  })?.point ?? null

const getOwnerBoundaryPoint = (
  editor: ContentRootNavigationEditor,
  owner: ContentRootOwner,
  direction: ContentRootNavigationDirection
): Point | null =>
  editor.read((state) => {
    const children = state.value.get().roots[owner.ownerRoot]
    const ownerNode =
      children && getSlateDescendantAtPath(children, owner.ownerPath)

    if (!children || !ownerNode) {
      return null
    }

    const siblingPoint = getSiblingBoundaryPoint({
      children,
      ownerPath: owner.ownerPath,
      side: direction === 'forward' ? 'before' : 'after',
    })

    if (siblingPoint) {
      return siblingPoint
    }

    return getSlateBoundaryPoint(
      ownerNode,
      owner.ownerPath,
      direction === 'forward' ? 'start' : 'end'
    )
  })

const getOwnerAdjacentBoundary = (
  editor: ContentRootNavigationEditor,
  owner: ContentRootOwner,
  direction: ContentRootNavigationDirection
): ContentRootAdjacentBoundary | null =>
  editor.read((state) => {
    const children = state.value.get().roots[owner.ownerRoot]

    return children
      ? getSiblingBoundary({
          children,
          ownerPath: owner.ownerPath,
          side: direction === 'forward' ? 'before' : 'after',
        })
      : null
  })

const getOwnerSelfBoundaryPoint = (
  editor: ContentRootNavigationEditor,
  owner: ContentRootOwner,
  edge: 'end' | 'start'
): Point | null =>
  editor.read((state) => {
    const children = state.value.get().roots[owner.ownerRoot]
    const ownerNode =
      children && getSlateDescendantAtPath(children, owner.ownerPath)

    return ownerNode
      ? getSlateBoundaryPoint(ownerNode, owner.ownerPath, edge)
      : null
  })

const getExitBoundaryPoint = (
  editor: ContentRootNavigationEditor,
  owner: ContentRootOwner,
  direction: ContentRootNavigationDirection
): Point | null =>
  editor.read((state) => {
    const children = state.value.get().roots[owner.ownerRoot]
    const ownerNode =
      children && getSlateDescendantAtPath(children, owner.ownerPath)

    if (!children || !ownerNode) {
      return null
    }

    const siblingPoint = getSiblingBoundaryPoint({
      children,
      ownerPath: owner.ownerPath,
      side: direction === 'forward' ? 'after' : 'before',
    })

    if (siblingPoint) {
      return siblingPoint
    }

    return getSlateBoundaryPoint(
      ownerNode,
      owner.ownerPath,
      direction === 'forward' ? 'end' : 'start'
    )
  })

const getRootBoundaryNavigationTarget = ({
  direction,
  editor,
  owner,
}: {
  direction: ContentRootNavigationDirection
  editor: ContentRootNavigationEditor
  owner: ContentRootOwner
}): ContentRootNavigationTarget | null => {
  const point = editor.read((state) =>
    getSlateRootBoundaryPoint(
      state.value.get().roots[owner.childRoot] ?? [],
      direction === 'forward' ? 'start' : 'end'
    )
  )

  return point
    ? {
        owner,
        point,
        root: owner.childRoot,
      }
    : null
}

const getDocumentDirection = ({
  event,
  isRTL,
}: {
  event: ReactKeyboardEvent<HTMLDivElement>
  isRTL: boolean
}): ContentRootNavigationDirection | null => {
  const { nativeEvent } = event

  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
    return null
  }

  if (Hotkeys.isMoveBackward(nativeEvent)) {
    return isRTL ? 'forward' : 'backward'
  }

  if (Hotkeys.isMoveForward(nativeEvent)) {
    return isRTL ? 'backward' : 'forward'
  }

  if (Hotkeys.isDeleteBackward(nativeEvent)) {
    return 'backward'
  }

  if (Hotkeys.isDeleteForward(nativeEvent)) {
    return 'forward'
  }

  return null
}

const getWordDirection = ({
  event,
  isRTL,
}: {
  event: ReactKeyboardEvent<HTMLDivElement>
  isRTL: boolean
}): ContentRootNavigationDirection | null => {
  const { nativeEvent } = event

  if (Hotkeys.isMoveWordBackward(nativeEvent)) {
    return isRTL ? 'forward' : 'backward'
  }

  if (Hotkeys.isMoveWordForward(nativeEvent)) {
    return isRTL ? 'backward' : 'forward'
  }

  return null
}

const isPlainContentRootEvent = (event: ReactKeyboardEvent<HTMLDivElement>) =>
  !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey

const isEnterIntoContentRoot = (event: ReactKeyboardEvent<HTMLDivElement>) => {
  const { nativeEvent } = event

  return isPlainContentRootEvent(event) && Hotkeys.isSplitBlock(nativeEvent)
}

const getContentRootNavigationAction = ({
  event,
  isRTL,
}: {
  event: ReactKeyboardEvent<HTMLDivElement>
  isRTL: boolean
}): ContentRootNavigationAction | null => {
  if (event.metaKey && !event.shiftKey && !event.altKey && !event.ctrlKey) {
    if (event.key === 'ArrowUp') {
      return { direction: 'backward', kind: 'document-boundary' }
    }

    if (event.key === 'ArrowDown') {
      return { direction: 'forward', kind: 'document-boundary' }
    }
  }

  if (isEnterIntoContentRoot(event)) {
    return { kind: 'enter' }
  }

  const wordDirection = getWordDirection({ event, isRTL })

  if (wordDirection) {
    return { axis: 'word', direction: wordDirection, kind: 'move' }
  }

  const direction = getDocumentDirection({ event, isRTL })

  if (direction) {
    return { axis: 'horizontal', direction, kind: 'move' }
  }

  if (!isPlainContentRootEvent(event)) {
    return null
  }

  if (event.key === 'ArrowUp') {
    return { axis: 'vertical', direction: 'backward', kind: 'move' }
  }

  if (event.key === 'ArrowDown') {
    return { axis: 'vertical', direction: 'forward', kind: 'move' }
  }

  return null
}

const getDocumentBoundaryNavigationTarget = ({
  currentRoot,
  direction,
  editor,
  getActiveContentRootOwner,
  owners,
}: {
  currentRoot: RootKey
  direction: ContentRootNavigationDirection
  editor: ContentRootNavigationEditor
  getActiveContentRootOwner?: (root: RootKey) => ContentRootOwner | null
  owners: ContentRootOwner[]
}): ContentRootNavigationTarget | null => {
  const activeOwner = getActiveContentRootOwner?.(currentRoot)
  const ownerForCurrentRoot = isKnownContentRootOwner(owners, activeOwner)
    ? activeOwner
    : owners.find((owner) => owner.childRoot === currentRoot)
  const targetRoot = ownerForCurrentRoot?.ownerRoot ?? currentRoot
  const point = editor.read((state) =>
    getSlateRootBoundaryPoint(
      state.value.get().roots[targetRoot] ?? [],
      direction === 'forward' ? 'end' : 'start'
    )
  )

  return point ? { point, root: targetRoot } : null
}

const getRootViewEditor = ({
  editor,
  getMountedViewEditor,
  root,
}: {
  editor: ContentRootNavigationEditor
  getMountedViewEditor?: (root: RootKey) => ReactRuntimeEditor | null
  root: RootKey
}): ReactRuntimeEditor | null =>
  getMountedViewEditor?.(root) ??
  getRegisteredRootViewEditor(editor as ReactRuntimeEditor, root) ??
  (editor.read((state) => state.view.root()) === root
    ? (editor as ReactRuntimeEditor)
    : null)

const getProjectedPointViewEditor = ({
  editor,
  getContentRootOwnerViewEditor,
  getMountedViewEditor,
  owner,
  root,
}: {
  editor: ContentRootNavigationEditor
  getContentRootOwnerViewEditor?: (
    owner: ContentRootOwner
  ) => ReactRuntimeEditor | null
  getMountedViewEditor?: (root: RootKey) => ReactRuntimeEditor | null
  owner: ContentRootOwner | null | undefined
  root: RootKey
}): ReactRuntimeEditor | null =>
  (owner ? getContentRootOwnerViewEditor?.(owner) : null) ??
  getRootViewEditor({
    editor,
    getMountedViewEditor,
    root,
  }) ??
  (editor as ReactRuntimeEditor)

const hasUsableRect = (rect: DOMRect | null): rect is DOMRect =>
  !!rect &&
  Number.isFinite(rect.left) &&
  Number.isFinite(rect.right) &&
  Number.isFinite(rect.top) &&
  Number.isFinite(rect.bottom) &&
  (rect.left !== 0 || rect.right !== 0 || rect.top !== 0 || rect.bottom !== 0)

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

const resolveUsableRangeRect = (
  editor: ReactRuntimeEditor,
  range: Range
): DOMRect | null => {
  const domRange = editor.api.dom.resolveDOMRange(range)
  const clientRect = Array.from(domRange?.getClientRects() ?? [])[0] ?? null
  const boundingRect = domRange?.getBoundingClientRect() ?? null
  const domPointRect = RangeApi.isCollapsed(range)
    ? (() => {
        const domPoint = editor.api.dom.resolveDOMPoint(range.anchor)
        const domNode = domPoint?.[0]
        const element =
          domNode?.nodeType === Node.ELEMENT_NODE
            ? (domNode as HTMLElement)
            : ((domNode?.parentElement as HTMLElement | null) ?? null)

        return element?.getBoundingClientRect() ?? null
      })()
    : null

  return hasUsableRect(clientRect)
    ? clientRect
    : hasUsableRect(boundingRect)
      ? boundingRect
      : hasUsableRect(domPointRect)
        ? domPointRect
        : null
}

const VISUAL_LINE_TOLERANCE = 2

const getPathElement = (
  editor: ReactRuntimeEditor,
  path: Path
): HTMLElement | null => {
  const node = editor.read((state) => {
    try {
      return state.nodes.get(path)[0] as Descendant
    } catch {
      return null
    }
  })

  return node ? editor.api.dom.resolveDOMNode(node as any) : null
}

const getSlateLineRects = (element: HTMLElement): DOMRect[] => {
  const rects: DOMRect[] = []
  const strings = Array.from(
    element.querySelectorAll('[data-slate-string], [data-slate-zero-width]')
  )

  for (const string of strings) {
    const clientRects = Array.from(string.getClientRects()).filter(
      hasUsableRect
    )

    if (clientRects.length > 0) {
      rects.push(...clientRects)
      continue
    }

    const rect = string.getBoundingClientRect()

    if (hasUsableRect(rect)) {
      rects.push(rect)
    }
  }

  return rects
}

const isPointOnVisualBoundaryLine = ({
  container,
  direction,
  editor,
  point,
  root,
}: {
  container: HTMLElement
  direction: ContentRootNavigationDirection
  editor: ReactRuntimeEditor
  point: Point
  root: RootKey
}): boolean => {
  const sourceRect = resolveUsableRangeRect(editor, rootedRange(point, root))

  if (!hasUsableRect(sourceRect)) {
    return false
  }

  const lineRects = getSlateLineRects(container)

  if (lineRects.length === 0) {
    return false
  }

  if (direction === 'forward') {
    const lastLineTop = Math.max(...lineRects.map((rect) => rect.top))

    return sourceRect.top >= lastLineTop - VISUAL_LINE_TOLERANCE
  }

  const firstLineBottom = Math.min(...lineRects.map((rect) => rect.bottom))

  return sourceRect.bottom <= firstLineBottom + VISUAL_LINE_TOLERANCE
}

const getUsableDOMRangeRect = (range: globalThis.Range): DOMRect | null => {
  const clientRect = Array.from(range.getClientRects())[0] ?? null
  const boundingRect = range.getBoundingClientRect()

  return hasUsableRect(clientRect)
    ? clientRect
    : hasUsableRect(boundingRect)
      ? boundingRect
      : null
}

const getCollapsedTextOffsetRect = (
  document: Document,
  textNode: Node,
  offset: number
): { distanceX: (x: number) => number; offset: number } | null => {
  const textLength = textNode.textContent?.length ?? 0
  const safeOffset = Math.max(0, Math.min(offset, textLength))
  const range = document.createRange()

  range.setStart(textNode, safeOffset)
  range.collapse(true)

  const rect = getUsableDOMRangeRect(range)

  if (rect) {
    return {
      distanceX: (x) => Math.abs(rect.left - x),
      offset: safeOffset,
    }
  }

  if (textLength === 0) {
    return null
  }

  const probeStart =
    safeOffset >= textLength ? Math.max(0, textLength - 1) : safeOffset
  const probeEnd = Math.min(textLength, probeStart + 1)

  if (probeEnd <= probeStart) {
    return null
  }

  const probeRange = document.createRange()

  probeRange.setStart(textNode, probeStart)
  probeRange.setEnd(textNode, probeEnd)

  const probeRect = getUsableDOMRangeRect(probeRange)

  if (!probeRect) {
    return null
  }

  return {
    distanceX: (x) =>
      Math.abs(
        safeOffset >= textLength ? probeRect.right - x : probeRect.left - x
      ),
    offset: safeOffset,
  }
}

const resolvePointFromDOMRange = (
  editor: ReactRuntimeEditor,
  domRange: globalThis.Range
): Point | null => {
  const range = editor.api.dom.resolveSlateRange(domRange, {
    exactMatch: false,
  })

  return range && RangeApi.isCollapsed(range) ? range.anchor : null
}

const getPointNearCoordinatesFromSlateDOM = (
  editor: ReactRuntimeEditor,
  x: number,
  y: number
): Point | null => {
  const editorElement = editor.api.dom.resolveDOMNode(editor)

  if (!editorElement) {
    return null
  }

  const strings = Array.from(
    editorElement.querySelectorAll(
      '[data-slate-string], [data-slate-zero-width]'
    )
  )
  const bestString = strings
    .map((element) => {
      const rect = element.getBoundingClientRect()
      const verticalDistance =
        y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0

      return { element, rect, verticalDistance }
    })
    .sort((left, right) => {
      if (left.verticalDistance !== right.verticalDistance) {
        return left.verticalDistance - right.verticalDistance
      }

      return (
        Math.abs(left.rect.left + left.rect.width / 2 - x) -
        Math.abs(right.rect.left + right.rect.width / 2 - x)
      )
    })[0]?.element
  const textNode = Array.from(bestString?.childNodes ?? []).find(
    (node) => node.nodeType === Node.TEXT_NODE
  )

  if (!textNode) {
    return null
  }

  const { document } = editor.api.dom.getWindow()
  const textLength = textNode.textContent?.length ?? 0
  let bestOffset = bestString?.hasAttribute('data-slate-zero-width') ? 1 : 0
  let bestDistance = Number.POSITIVE_INFINITY

  for (let offset = 0; offset <= textLength; offset++) {
    const candidate = getCollapsedTextOffsetRect(document, textNode, offset)
    const distance = candidate?.distanceX(x) ?? Number.POSITIVE_INFINITY

    if (distance < bestDistance) {
      bestDistance = distance
      bestOffset = candidate?.offset ?? bestOffset
    }
  }

  const range = document.createRange()

  range.setStart(textNode, Math.max(0, Math.min(bestOffset, textLength)))
  range.collapse(true)

  return resolvePointFromDOMRange(editor, range)
}

const getPointAtCoordinates = (
  editor: ReactRuntimeEditor,
  x: number,
  y: number
): Point | null => {
  const { document } = editor.api.dom.getWindow()
  let domRange: globalThis.Range | null = null

  if (document.caretRangeFromPoint) {
    domRange = document.caretRangeFromPoint(x, y)
  } else {
    const position = document.caretPositionFromPoint(x, y)

    if (position) {
      domRange = document.createRange()
      domRange.setStart(position.offsetNode, position.offset)
      domRange.setEnd(position.offsetNode, position.offset)
    }
  }

  return (
    (domRange ? resolvePointFromDOMRange(editor, domRange) : null) ??
    getPointNearCoordinatesFromSlateDOM(editor, x, y)
  )
}

const resolveVerticalNavigationPoint = ({
  currentRoot,
  direction,
  fallbackPoint,
  point,
  sourceEditor,
  targetEditor,
  targetRoot,
}: {
  currentRoot: RootKey
  direction: ContentRootNavigationDirection
  fallbackPoint: Point
  point: Point
  sourceEditor: ReactRuntimeEditor
  targetEditor: ReactRuntimeEditor
  targetRoot: RootKey
}): Point | null => {
  const sourceRect = resolveUsableRangeRect(
    sourceEditor,
    rootedRange(point, currentRoot)
  )
  const fallbackRect = resolveUsableRangeRect(
    targetEditor,
    rootedRange(fallbackPoint, targetRoot)
  )
  const targetElement = targetEditor.api.dom.resolveDOMNode(targetEditor)

  if (!hasUsableRect(sourceRect) || !targetElement) {
    return null
  }

  const targetRect = targetElement.getBoundingClientRect()
  const x = clamp(sourceRect.left, targetRect.left + 1, targetRect.right - 1)
  const yRect = hasUsableRect(fallbackRect) ? fallbackRect : targetRect
  const y =
    direction === 'forward'
      ? yRect.top + Math.min(Math.max(yRect.height / 2, 1), 4)
      : yRect.bottom - Math.min(Math.max(yRect.height / 2, 1), 4)
  const targetPoint = getPointAtCoordinates(targetEditor, x, y)

  if (!targetPoint) {
    const emptyFallback = targetEditor.read((state) => {
      const [node] = state.nodes.get(fallbackPoint.path)

      return NodeApi.isText(node) && node.text.length === 0
    })

    return emptyFallback ? fallbackPoint : null
  }

  if ((targetPoint.root ?? targetRoot) !== targetRoot) {
    return null
  }

  return targetPoint
}

const getVerticalNavigationTarget = ({
  currentRoot,
  direction,
  editor,
  getActiveContentRootOwner,
  getContentRootOwnerViewEditor,
  getMountedViewEditor,
  owners,
  point,
}: {
  currentRoot: RootKey
  direction: ContentRootNavigationDirection
  editor: ContentRootNavigationEditor
  getActiveContentRootOwner?: (root: RootKey) => ContentRootOwner | null
  getContentRootOwnerViewEditor?: (
    owner: ContentRootOwner
  ) => ReactRuntimeEditor | null
  getMountedViewEditor?: (root: RootKey) => ReactRuntimeEditor | null
  owners: ContentRootOwner[]
  point: Point
}): ContentRootNavigationTarget | null => {
  const activeOwner = getActiveContentRootOwner?.(currentRoot)
  const ownerForCurrentRoot = isKnownContentRootOwner(owners, activeOwner)
    ? activeOwner
    : owners.find((owner) => owner.childRoot === currentRoot)

  if (ownerForCurrentRoot) {
    const sourceEditor = getProjectedPointViewEditor({
      editor,
      getContentRootOwnerViewEditor,
      getMountedViewEditor,
      owner: ownerForCurrentRoot,
      root: currentRoot,
    })
    const rootEdge = editor.read((state) =>
      getSlateRootBoundaryPoint(
        state.value.get().roots[currentRoot] ?? [],
        direction === 'forward' ? 'end' : 'start'
      )
    )
    const atModelBoundary =
      rootEdge && sameSlateRootPoint(point, rootEdge, currentRoot)
    const sourceElement =
      sourceEditor?.api.dom?.resolveDOMNode?.(sourceEditor) ?? null
    const atVisualBoundary =
      !!sourceEditor &&
      !!sourceElement &&
      isPointOnVisualBoundaryLine({
        container: sourceElement,
        direction,
        editor: sourceEditor,
        point,
        root: currentRoot,
      })
    const atTerminalBlock = isPointInRootTerminalBlock({
      direction,
      editor,
      point,
      root: currentRoot,
    })
    const exitPoint =
      atModelBoundary || atVisualBoundary
        ? getExitBoundaryPoint(editor, ownerForCurrentRoot, direction)
        : null

    if (!exitPoint) {
      return null
    }

    const targetEditor = getRootViewEditor({
      editor,
      getMountedViewEditor,
      root: ownerForCurrentRoot.ownerRoot,
    })
    const targetPoint =
      sourceEditor && targetEditor
        ? resolveVerticalNavigationPoint({
            currentRoot,
            direction,
            fallbackPoint: exitPoint,
            point,
            sourceEditor,
            targetEditor,
            targetRoot: ownerForCurrentRoot.ownerRoot,
          })
        : null
    const resolvedTargetPoint =
      targetPoint ?? (atTerminalBlock ? exitPoint : null)

    return resolvedTargetPoint
      ? {
          point: resolvedTargetPoint,
          root: ownerForCurrentRoot.ownerRoot,
        }
      : null
  }

  for (const owner of owners) {
    if (owner.ownerRoot !== currentRoot) {
      continue
    }

    const sourceEditor = getRootViewEditor({
      editor,
      getMountedViewEditor,
      root: currentRoot,
    })
    const targetEditor =
      getContentRootOwnerViewEditor?.(owner) ??
      getRootViewEditor({
        editor,
        getMountedViewEditor,
        root: owner.childRoot,
      })
    const entryPoint = getOwnerBoundaryPoint(editor, owner, direction)
    const adjacentBoundary = getOwnerAdjacentBoundary(editor, owner, direction)
    const atModelBoundary =
      entryPoint && sameSlateRootPoint(point, entryPoint, currentRoot)
    const adjacentElement =
      sourceEditor && adjacentBoundary
        ? getPathElement(sourceEditor, adjacentBoundary.path)
        : null
    const atVisualBoundary =
      !!sourceEditor &&
      !!adjacentBoundary &&
      !!adjacentElement &&
      isPointInPath(point, adjacentBoundary.path) &&
      isPointOnVisualBoundaryLine({
        container: adjacentElement,
        direction,
        editor: sourceEditor,
        point,
        root: currentRoot,
      })

    if (!atModelBoundary && !atVisualBoundary) {
      continue
    }

    const fallbackTarget = getRootBoundaryNavigationTarget({
      direction,
      editor,
      owner,
    })
    const targetPoint =
      fallbackTarget && sourceEditor && targetEditor
        ? resolveVerticalNavigationPoint({
            currentRoot,
            direction,
            fallbackPoint: fallbackTarget.point,
            point,
            sourceEditor,
            targetEditor,
            targetRoot: owner.childRoot,
          })
        : null

    if (targetPoint) {
      return {
        owner,
        point: targetPoint,
        root: owner.childRoot,
      }
    }
  }

  return null
}

const getHorizontalNavigationTarget = ({
  currentRoot,
  direction,
  editor,
  getActiveContentRootOwner,
  owners,
  point,
}: {
  currentRoot: RootKey
  direction: ContentRootNavigationDirection
  editor: ContentRootNavigationEditor
  getActiveContentRootOwner?: (root: RootKey) => ContentRootOwner | null
  owners: ContentRootOwner[]
  point: Point
}): ContentRootNavigationTarget | null => {
  const activeOwner = getActiveContentRootOwner?.(currentRoot)
  const ownerForCurrentRoot = isKnownContentRootOwner(owners, activeOwner)
    ? activeOwner
    : owners.find((owner) => owner.childRoot === currentRoot)

  if (ownerForCurrentRoot) {
    const rootEdge = editor.read((state) =>
      getSlateRootBoundaryPoint(
        state.value.get().roots[currentRoot] ?? [],
        direction === 'forward' ? 'end' : 'start'
      )
    )
    const exitPoint =
      rootEdge && sameSlateRootPoint(point, rootEdge, currentRoot)
        ? getExitBoundaryPoint(editor, ownerForCurrentRoot, direction)
        : null

    return exitPoint
      ? {
          point: exitPoint,
          root: ownerForCurrentRoot.ownerRoot,
        }
      : null
  }

  for (const owner of owners) {
    if (owner.ownerRoot !== currentRoot) {
      continue
    }

    const entryPoint = getOwnerBoundaryPoint(editor, owner, direction)

    if (entryPoint && sameSlateRootPoint(point, entryPoint, currentRoot)) {
      return getRootBoundaryNavigationTarget({
        direction,
        editor,
        owner,
      })
    }
  }

  return null
}

const getRootLocalHorizontalSelectionTarget = ({
  direction,
  point,
  root,
  sourceEditor,
  unit,
}: {
  direction: ContentRootNavigationDirection
  point: Point
  root: RootKey
  sourceEditor: ReactRuntimeEditor
  unit?: 'line' | 'word'
}): ContentRootNavigationTarget | null => {
  const rootedPoint = rootSlatePoint(point, root)
  const nextPoint = sourceEditor.read((state) =>
    direction === 'forward'
      ? Editor.after(sourceEditor, rootedPoint, unit ? { unit } : undefined)
      : Editor.before(sourceEditor, rootedPoint, unit ? { unit } : undefined)
  )

  if (!nextPoint || getSlatePointRoot(nextPoint, root) !== root) {
    return null
  }

  return {
    point: rootSlatePoint(nextPoint, root),
    root,
  }
}

const getHorizontalSelectionUnit = (
  axis: ContentRootNavigationAxis
): 'line' | 'word' | undefined =>
  axis === 'line' || axis === 'word' ? axis : undefined

const advanceHorizontalBoundarySelectionTarget = ({
  action,
  editor,
  getContentRootOwnerViewEditor,
  getMountedViewEditor,
  target,
}: {
  action: Extract<ContentRootViewSelectionAction, { kind: 'move' }>
  editor: ContentRootNavigationEditor
  getContentRootOwnerViewEditor?: (
    owner: ContentRootOwner
  ) => ReactRuntimeEditor | null
  getMountedViewEditor?: (root: RootKey) => ReactRuntimeEditor | null
  target: ContentRootNavigationTarget
}): ContentRootNavigationTarget => {
  if (action.axis === 'vertical') {
    return target
  }

  const sourceEditor = getProjectedPointViewEditor({
    editor,
    getContentRootOwnerViewEditor,
    getMountedViewEditor,
    owner: target.owner,
    root: target.root,
  })

  if (!sourceEditor) {
    return target
  }

  const rootLocalTarget = getRootLocalHorizontalSelectionTarget({
    direction: action.direction,
    point: target.point,
    root: target.root,
    sourceEditor,
    unit: getHorizontalSelectionUnit(action.axis),
  })

  return rootLocalTarget && rootLocalTarget.root === target.root
    ? {
        ...rootLocalTarget,
        ...(target.owner ? { owner: target.owner } : {}),
      }
    : target
}

const advanceVerticalBoundarySelectionTarget = ({
  action,
  anchorSelection,
  currentOwner,
  currentRoot,
  editor,
  getContentRootOwnerViewEditor,
  getMountedViewEditor,
  owners,
  selection,
  target,
}: {
  action: Extract<ContentRootViewSelectionAction, { kind: 'move' }>
  anchorSelection: SlateViewSelection
  currentOwner?: ContentRootOwner | null
  currentRoot: RootKey
  editor: ContentRootNavigationEditor
  getContentRootOwnerViewEditor?: (
    owner: ContentRootOwner
  ) => ReactRuntimeEditor | null
  getMountedViewEditor?: (root: RootKey) => ReactRuntimeEditor | null
  owners: ContentRootOwner[]
  selection: Range | null
  target: ContentRootNavigationTarget
}): ContentRootNavigationTarget => {
  if (action.axis !== 'vertical') {
    return target
  }

  const currentRootOwner = isKnownContentRootOwner(owners, currentOwner)
    ? currentOwner
    : owners.find((owner) => owner.childRoot === currentRoot)
  const fallbackPoint = currentRootOwner
    ? getExitBoundaryPoint(editor, currentRootOwner, action.direction)
    : target.owner
      ? getRootBoundaryNavigationTarget({
          direction: action.direction,
          editor,
          owner: target.owner,
        })?.point
      : null

  if (
    !fallbackPoint ||
    !sameSlateRootPoint(target.point, fallbackPoint, target.root)
  ) {
    return target
  }

  const hasVisiblePart = (
    predicate: (
      segment: SlateViewSelection['segments']['parts'][number]
    ) => boolean
  ) =>
    editor.read((state) => {
      const roots = state.value.get().roots

      return anchorSelection.segments.parts.some((segment) => {
        if (!predicate(segment)) {
          return false
        }

        const anchor = resolveSlateViewBoundarySegmentEndpoint(
          roots,
          segment,
          segment.start
        )
        const focus = resolveSlateViewBoundarySegmentEndpoint(
          roots,
          segment,
          segment.end
        )

        return !!anchor && !!focus && !RangeApi.isCollapsed({ anchor, focus })
      })
    })
  const hasAnyVisiblePart = hasVisiblePart(() => true)
  const hasVisibleTargetPart = hasVisiblePart(
    (segment) =>
      segment.root === target.root &&
      isSameContentRootOwner(segment.owner, target.owner)
  )
  const shouldAdvance =
    !hasAnyVisiblePart || (!!currentRootOwner && !hasVisibleTargetPart)

  if (!shouldAdvance) {
    return target
  }

  const sourceEditor = getProjectedPointViewEditor({
    editor,
    getContentRootOwnerViewEditor,
    getMountedViewEditor,
    owner: target.owner,
    root: target.root,
  })

  if (!sourceEditor) {
    return target
  }

  const lineTarget = getRootLocalHorizontalSelectionTarget({
    direction: action.direction,
    point: target.point,
    root: target.root,
    sourceEditor,
    unit: 'line',
  })

  return lineTarget && lineTarget.root === target.root
    ? {
        ...lineTarget,
        ...(target.owner ? { owner: target.owner } : {}),
      }
    : target
}

const getInitialProjectedSelectionAnchor = ({
  currentOwner,
  currentRoot,
  getActiveContentRootOwner,
  owners,
  selection,
}: {
  currentOwner?: ContentRootOwner | null
  currentRoot: RootKey
  getActiveContentRootOwner?: (root: RootKey) => ContentRootOwner | null
  owners: readonly ContentRootOwner[]
  selection: Range
}): SlateViewBoundaryPoint => {
  const point = selection.anchor
  const root = getSlatePointRoot(point, currentRoot)
  const owner =
    isKnownContentRootOwner(owners, currentOwner) &&
    currentOwner.childRoot === root
      ? currentOwner
      : getOwnerForRoot({
          currentRoot: root,
          getActiveContentRootOwner,
          owners,
        })

  return toProjectedPoint({
    owner,
    point,
    root,
  })
}

const getTextPointAtPreferredOffset = (
  node: Descendant,
  path: Path,
  preferredOffset: number
): Point | null => {
  if (NodeApi.isText(node)) {
    return {
      offset: Math.min(preferredOffset, node.text.length),
      path,
    }
  }

  for (const [index, child] of node.children.entries()) {
    const point = getTextPointAtPreferredOffset(
      child,
      path.concat(index),
      preferredOffset
    )

    if (point) {
      return point
    }
  }

  return null
}

const getRootLocalVerticalModelSelectionTarget = ({
  direction,
  point,
  root,
  sourceEditor,
}: {
  direction: ContentRootNavigationDirection
  point: Point
  root: RootKey
  sourceEditor: ReactRuntimeEditor
}): ContentRootNavigationTarget | null =>
  sourceEditor.read((state) => {
    const children = (
      state.view.root() === root
        ? state.nodes.children()
        : (state.value.get().roots[root] ?? [])
    ) as readonly Descendant[]
    const blockIndex = point.path[0]

    if (blockIndex == null) {
      return null
    }

    const nextBlockIndex =
      direction === 'forward' ? blockIndex + 1 : blockIndex - 1
    const nextBlock = children[nextBlockIndex]

    if (!nextBlock) {
      return null
    }

    const nextPoint = getTextPointAtPreferredOffset(
      nextBlock,
      [nextBlockIndex],
      point.offset
    )

    return nextPoint
      ? {
          point: rootSlatePoint(nextPoint, root),
          root,
        }
      : null
  })

const isPointInRootTerminalBlock = ({
  direction,
  editor,
  point,
  root,
}: {
  direction: ContentRootNavigationDirection
  editor: ContentRootNavigationEditor
  point: Point
  root: RootKey
}) =>
  editor.read((state) => {
    const children = state.value.get().roots[root] ?? []
    const blockIndex = point.path[0]

    if (typeof blockIndex !== 'number' || children.length === 0) {
      return false
    }

    return direction === 'forward'
      ? blockIndex === children.length - 1
      : blockIndex === 0
  })

const getRootLocalVerticalSelectionTarget = ({
  direction,
  point,
  root,
  sourceEditor,
}: {
  direction: ContentRootNavigationDirection
  point: Point
  root: RootKey
  sourceEditor: ReactRuntimeEditor
}): ContentRootNavigationTarget | null => {
  const sourceRect = resolveUsableRangeRect(
    sourceEditor,
    rootedRange(point, root)
  )
  const sourceElement = sourceEditor.api.dom.resolveDOMNode(sourceEditor)

  if (!hasUsableRect(sourceRect) || !sourceElement) {
    return getRootLocalVerticalModelSelectionTarget({
      direction,
      point,
      root,
      sourceEditor,
    })
  }

  const sourceElementRect = sourceElement.getBoundingClientRect()
  const step = Math.min(Math.max(sourceRect.height, 8), 24)
  const rawY =
    direction === 'forward'
      ? sourceRect.bottom + step / 2
      : sourceRect.top - step / 2
  const y = clamp(rawY, sourceElementRect.top + 1, sourceElementRect.bottom - 1)
  const x = clamp(
    sourceRect.left,
    sourceElementRect.left + 1,
    sourceElementRect.right - 1
  )
  const nextPoint = getPointAtCoordinates(sourceEditor, x, y)

  if (
    !nextPoint ||
    getSlatePointRoot(nextPoint, root) !== root ||
    sameSlateRootPoint(nextPoint, point, root) ||
    nextPoint.path[0] === point.path[0]
  ) {
    return getRootLocalVerticalModelSelectionTarget({
      direction,
      point,
      root,
      sourceEditor,
    })
  }

  return {
    point: rootSlatePoint(nextPoint, root),
    root,
  }
}

const getProjectedGraphVerticalSelectionTarget = ({
  direction,
  editor,
  graph,
  viewSelection,
}: {
  direction: ContentRootNavigationDirection
  editor: ContentRootNavigationEditor
  graph: SlateViewBoundaryGraphModel
  viewSelection: SlateViewSelection
}): ContentRootNavigationTarget | null => {
  const focusNode = SlateViewBoundaryGraph.resolvePointNode(
    graph,
    viewSelection.focus
  )
  const targetNode =
    focusNode &&
    (direction === 'forward'
      ? SlateViewBoundaryGraph.nextNode(graph, focusNode)
      : SlateViewBoundaryGraph.previousNode(graph, focusNode))

  if (!targetNode) {
    return null
  }

  const point = editor.read((state) => {
    const node = getSlateDescendantAtPath(
      state.value.get().roots[targetNode.root] ?? [],
      targetNode.path
    )

    return node
      ? getTextPointAtPreferredOffset(
          node,
          [...targetNode.path],
          viewSelection.focus.point.offset
        )
      : null
  })

  return point
    ? {
        ...(targetNode.owner ? { owner: targetNode.owner } : {}),
        point: rootSlatePoint(point, targetNode.root),
        root: targetNode.root,
      }
    : null
}

const getProjectedGraphTerminalLineTarget = ({
  direction,
  editor,
  getContentRootOwnerViewEditor,
  getMountedViewEditor,
  viewSelection,
}: {
  direction: ContentRootNavigationDirection
  editor: ContentRootNavigationEditor
  getContentRootOwnerViewEditor?: (
    owner: ContentRootOwner
  ) => ReactRuntimeEditor | null
  getMountedViewEditor?: (root: RootKey) => ReactRuntimeEditor | null
  viewSelection: SlateViewSelection
}): ContentRootNavigationTarget | null => {
  const focus = viewSelection.focus
  const root = getSlateViewBoundaryPointRoot(focus)
  const sourceEditor = getProjectedPointViewEditor({
    editor,
    getContentRootOwnerViewEditor,
    getMountedViewEditor,
    owner: focus.owner,
    root,
  })

  if (!sourceEditor) {
    return null
  }

  const lineTarget = getRootLocalHorizontalSelectionTarget({
    direction,
    point: focus.point,
    root,
    sourceEditor,
    unit: 'line',
  })

  if (
    !lineTarget ||
    lineTarget.root !== root ||
    sameSlateRootPoint(lineTarget.point, focus.point, root)
  ) {
    return null
  }

  return {
    ...lineTarget,
    ...(focus.owner ? { owner: focus.owner } : {}),
  }
}

const getContentRootMovementTarget = ({
  action,
  allowRootLocalMovement,
  advanceBoundaryTarget,
  currentRoot,
  currentOwner,
  editor,
  getActiveContentRootOwner,
  getContentRootOwnerViewEditor,
  getMountedViewEditor,
  owners,
  point,
}: {
  action: Extract<ContentRootViewSelectionAction, { kind: 'move' }>
  allowRootLocalMovement: boolean
  advanceBoundaryTarget: boolean
  currentOwner?: ContentRootOwner | null
  currentRoot: RootKey
  editor: ContentRootNavigationEditor
  getActiveContentRootOwner?: (root: RootKey) => ContentRootOwner | null
  getContentRootOwnerViewEditor?: (
    owner: ContentRootOwner
  ) => ReactRuntimeEditor | null
  getMountedViewEditor?: (root: RootKey) => ReactRuntimeEditor | null
  owners: ContentRootOwner[]
  point: Point
}): ContentRootNavigationTarget | null => {
  const getCurrentRootOwner = (root: RootKey) =>
    root === currentRoot && isKnownContentRootOwner(owners, currentOwner)
      ? currentOwner
      : (getActiveContentRootOwner?.(root) ?? null)
  const boundaryTarget =
    action.kind === 'move' && action.axis === 'vertical'
      ? getVerticalNavigationTarget({
          currentRoot,
          direction: action.direction,
          editor,
          getActiveContentRootOwner: getCurrentRootOwner,
          getContentRootOwnerViewEditor,
          getMountedViewEditor,
          owners,
          point,
        })
      : action.kind === 'move'
        ? getHorizontalNavigationTarget({
            currentRoot,
            direction: action.direction,
            editor,
            getActiveContentRootOwner: getCurrentRootOwner,
            owners,
            point,
          })
        : null

  if (boundaryTarget) {
    return advanceBoundaryTarget
      ? advanceHorizontalBoundarySelectionTarget({
          action,
          editor,
          getContentRootOwnerViewEditor,
          getMountedViewEditor,
          target: boundaryTarget,
        })
      : boundaryTarget
  }

  if (!allowRootLocalMovement) {
    return null
  }

  const sourceEditor = getProjectedPointViewEditor({
    editor,
    getContentRootOwnerViewEditor,
    getMountedViewEditor,
    owner: currentOwner,
    root: currentRoot,
  })

  if (!sourceEditor) {
    return null
  }

  const rootLocalTarget =
    action.axis === 'vertical'
      ? getRootLocalVerticalSelectionTarget({
          direction: action.direction,
          point,
          root: currentRoot,
          sourceEditor,
        })
      : getRootLocalHorizontalSelectionTarget({
          direction: action.direction,
          point,
          root: currentRoot,
          sourceEditor,
          unit: getHorizontalSelectionUnit(action.axis),
        })

  return rootLocalTarget &&
    rootLocalTarget.root === currentRoot &&
    isKnownContentRootOwner(owners, currentOwner)
    ? {
        ...rootLocalTarget,
        owner: currentOwner,
      }
    : rootLocalTarget
}

export const getContentRootNavigationTarget = ({
  editor,
  event,
  getActiveContentRootOwner,
  getContentRootOwnerViewEditor,
  getMountedViewEditor,
  isRTL,
  selection,
}: {
  editor: ContentRootNavigationEditor
  event: ReactKeyboardEvent<HTMLDivElement>
  getActiveContentRootOwner?: (root: RootKey) => ContentRootOwner | null
  getContentRootOwnerViewEditor?: (
    owner: ContentRootOwner
  ) => ReactRuntimeEditor | null
  getMountedViewEditor?: (root: RootKey) => ReactRuntimeEditor | null
  isRTL: boolean
  selection: Range | null
}): ContentRootNavigationTarget | null => {
  const action = getContentRootNavigationAction({ event, isRTL })

  if (!action || !hasContentRootElementSpec(editor)) {
    return null
  }

  if (!selection || !RangeApi.isCollapsed(selection)) {
    return null
  }

  const point = selection.anchor
  const currentRoot = point.root ?? editor.read((state) => state.view.root())
  const owners = findContentRootOwners(editor)
  const currentViewOwner = getOwnerForCurrentViewEditor({
    editor,
    getContentRootOwnerViewEditor,
    owners,
  })
  const getCurrentRootOwner = (root: RootKey) =>
    root === currentRoot && isKnownContentRootOwner(owners, currentViewOwner)
      ? currentViewOwner
      : (getActiveContentRootOwner?.(root) ?? null)

  if (action.kind === 'enter') {
    for (const owner of owners) {
      if (owner.ownerRoot !== currentRoot) {
        continue
      }

      const start = getOwnerSelfBoundaryPoint(editor, owner, 'start')
      const end = getOwnerSelfBoundaryPoint(editor, owner, 'end')

      if (
        (start && sameSlateRootPoint(point, start, currentRoot)) ||
        (end && sameSlateRootPoint(point, end, currentRoot))
      ) {
        return getRootBoundaryNavigationTarget({
          direction: 'forward',
          editor,
          owner,
        })
      }
    }

    return null
  }

  if (action.kind === 'document-boundary') {
    return getDocumentBoundaryNavigationTarget({
      currentRoot,
      direction: action.direction,
      editor,
      getActiveContentRootOwner: getCurrentRootOwner,
      owners,
    })
  }

  return getContentRootMovementTarget({
    action,
    allowRootLocalMovement: false,
    advanceBoundaryTarget: action.axis === 'word',
    currentOwner: currentViewOwner,
    currentRoot,
    editor,
    getActiveContentRootOwner: getCurrentRootOwner,
    getContentRootOwnerViewEditor,
    getMountedViewEditor,
    owners,
    point,
  })
}

const getProjectedSelectionAction = ({
  event,
  isRTL,
}: {
  event: ReactKeyboardEvent<HTMLDivElement>
  isRTL: boolean
}): ContentRootViewSelectionAction | null => {
  if (Hotkeys.isExtendWordBackward(event.nativeEvent)) {
    return {
      axis: 'word',
      direction: isRTL ? 'forward' : 'backward',
      kind: 'move',
    }
  }

  if (Hotkeys.isExtendWordForward(event.nativeEvent)) {
    return {
      axis: 'word',
      direction: isRTL ? 'backward' : 'forward',
      kind: 'move',
    }
  }

  if (Hotkeys.isExtendLineBackward(event.nativeEvent)) {
    return { axis: 'vertical', direction: 'backward', kind: 'move' }
  }

  if (Hotkeys.isExtendLineForward(event.nativeEvent)) {
    return { axis: 'vertical', direction: 'forward', kind: 'move' }
  }

  if (event.shiftKey && event.metaKey && !event.altKey && !event.ctrlKey) {
    if (event.key === 'ArrowLeft') {
      return {
        axis: 'line',
        direction: isRTL ? 'forward' : 'backward',
        kind: 'move',
      }
    }

    if (event.key === 'ArrowRight') {
      return {
        axis: 'line',
        direction: isRTL ? 'backward' : 'forward',
        kind: 'move',
      }
    }
  }

  if (!event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
    if (event.shiftKey && event.metaKey && !event.altKey && !event.ctrlKey) {
      if (event.key === 'ArrowUp') {
        return { direction: 'backward', kind: 'document-boundary' }
      }

      if (event.key === 'ArrowDown') {
        return { direction: 'forward', kind: 'document-boundary' }
      }
    }

    return null
  }

  if (event.key === 'ArrowUp') {
    return { axis: 'vertical', direction: 'backward', kind: 'move' }
  }

  if (event.key === 'ArrowDown') {
    return { axis: 'vertical', direction: 'forward', kind: 'move' }
  }

  if (event.key === 'ArrowLeft') {
    return {
      axis: 'horizontal',
      direction: isRTL ? 'forward' : 'backward',
      kind: 'move',
    }
  }

  if (event.key === 'ArrowRight') {
    return {
      axis: 'horizontal',
      direction: isRTL ? 'backward' : 'forward',
      kind: 'move',
    }
  }

  return null
}

const getProjectedSelectionActionFromMoveCommand = ({
  command,
  isRTL,
}: {
  command: SelectionMoveCommand
  isRTL: boolean
}): ContentRootViewSelectionAction | null => {
  if (!command.extend) {
    return null
  }

  if (command.axis === 'document') {
    return {
      direction: command.reverse ? 'backward' : 'forward',
      kind: 'document-boundary',
    }
  }

  const direction = command.reverse
    ? isRTL
      ? 'forward'
      : 'backward'
    : isRTL
      ? 'backward'
      : 'forward'

  return {
    axis: command.axis === 'line' ? 'vertical' : command.axis,
    direction,
    kind: 'move',
  }
}

export const shouldModelOwnContentRootVerticalSelection = ({
  editor,
  event,
  getActiveContentRootOwner,
  selection,
}: {
  editor: ReactRuntimeEditor
  event: ReactKeyboardEvent<HTMLDivElement>
  getActiveContentRootOwner?: (root: RootKey) => ContentRootOwner | null
  selection: Range | null
}) => {
  if (
    !selection ||
    RangeApi.isCollapsed(selection) ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    !event.shiftKey ||
    (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') ||
    !hasContentRootElementSpec(editor)
  ) {
    return false
  }

  const owners = findContentRootOwners(editor)
  const currentRoot =
    selection.focus.root ?? editor.read((state) => state.view.root())
  const graph = createContentRootProjectionGraph(editor, owners)
  const anchor = getInitialProjectedSelectionAnchor({
    currentOwner: null,
    currentRoot,
    getActiveContentRootOwner,
    owners,
    selection,
  })
  const focusRoot = selection.focus.root ?? currentRoot
  const projectedSelection = createSlateViewSelection(graph, {
    anchor,
    focus: toProjectedPoint({
      owner: getOwnerForRoot({
        currentRoot: focusRoot,
        getActiveContentRootOwner,
        owners,
      }),
      point: selection.focus,
      root: focusRoot,
    }),
  })

  return projectedSelection.segments.parts.some(
    (segment) => segment.owner || segment.root !== currentRoot
  )
}

const applyContentRootViewSelectionAction = ({
  editor,
  action,
  getActiveContentRootOwner,
  getContentRootOwnerViewEditor,
  getMountedViewEditor,
  preventDefault,
  selection,
}: {
  editor: ReactRuntimeEditor
  action: ContentRootViewSelectionAction | null
  getActiveContentRootOwner?: (root: RootKey) => ContentRootOwner | null
  getContentRootOwnerViewEditor?: (
    owner: ContentRootOwner
  ) => ReactRuntimeEditor | null
  getMountedViewEditor?: (root: RootKey) => ReactRuntimeEditor | null
  preventDefault?: () => void
  selection: Range | null
}): ContentRootNavigationResult => {
  if (!action || !hasContentRootElementSpec(editor)) {
    return { handled: false }
  }

  const owners = findContentRootOwners(editor)
  const viewSelection = readSlateViewSelection(editor)
  const currentViewOwner = getOwnerForCurrentViewEditor({
    editor,
    getContentRootOwnerViewEditor,
    owners,
  })
  const currentOwner = viewSelection
    ? (viewSelection.focus.owner ?? null)
    : currentViewOwner
  const point = viewSelection?.focus.point ?? selection?.focus
  const currentRoot = viewSelection
    ? getSlateViewBoundaryPointRoot(viewSelection.focus)
    : (point?.root ?? editor.read((state) => state.view.root()))
  const selectionAnchorRoot =
    selection && !viewSelection
      ? (selection.anchor.root ?? currentRoot)
      : currentRoot
  const selectionFocusRoot =
    selection && !viewSelection
      ? (selection.focus.root ?? currentRoot)
      : currentRoot

  if (!point || (!viewSelection && !selection)) {
    return { handled: false }
  }

  if (!viewSelection && selectionAnchorRoot !== selectionFocusRoot) {
    return { handled: false }
  }

  const getCurrentRootOwner = (root: RootKey) =>
    root === currentRoot && isKnownContentRootOwner(owners, currentOwner)
      ? currentOwner
      : (getActiveContentRootOwner?.(root) ?? null)

  const graph = createContentRootProjectionGraph(editor, owners)
  let target =
    action.kind === 'document-boundary'
      ? getDocumentBoundaryNavigationTarget({
          currentRoot,
          direction: action.direction,
          editor,
          getActiveContentRootOwner: getCurrentRootOwner,
          owners,
        })
      : getContentRootMovementTarget({
          action,
          allowRootLocalMovement: Boolean(viewSelection),
          advanceBoundaryTarget: true,
          currentOwner,
          currentRoot,
          editor,
          getActiveContentRootOwner,
          getContentRootOwnerViewEditor,
          getMountedViewEditor,
          owners,
          point,
        })

  if (
    !target &&
    viewSelection &&
    action.kind === 'move' &&
    action.axis === 'vertical'
  ) {
    target = getProjectedGraphVerticalSelectionTarget({
      direction: action.direction,
      editor,
      graph,
      viewSelection,
    })

    if (!target) {
      target = getProjectedGraphTerminalLineTarget({
        direction: action.direction,
        editor,
        getContentRootOwnerViewEditor,
        getMountedViewEditor,
        viewSelection,
      })
    }
  }

  if (!target) {
    if (
      !viewSelection &&
      selection &&
      !RangeApi.isCollapsed(selection) &&
      action.kind === 'move' &&
      action.axis === 'vertical'
    ) {
      const anchor = getInitialProjectedSelectionAnchor({
        currentOwner,
        currentRoot,
        getActiveContentRootOwner,
        owners,
        selection,
      })
      const focusRoot = selection.focus.root ?? currentRoot
      const projectedSelection = createSlateViewSelection(graph, {
        anchor,
        focus: toProjectedPoint({
          owner: getOwnerForRoot({
            currentRoot: focusRoot,
            getActiveContentRootOwner,
            owners,
          }),
          point: selection.focus,
          root: focusRoot,
        }),
      })
      const hasProjectedPart = projectedSelection.segments.parts.some(
        (segment) => segment.owner || segment.root !== currentRoot
      )

      if (hasProjectedPart) {
        writeSlateViewSelection(editor, projectedSelection)
        collapseModelSelectionForProjectedSelection(editor, selection)
        collapseNativeSelectionForProjectedSelection(editor, selection)
        preventDefault?.()

        return { handled: true }
      }
    }

    if (viewSelection) {
      collapseModelSelectionForProjectedSelection(editor, selection)
      collapseNativeSelectionForProjectedSelection(editor, selection)
      preventDefault?.()

      return { handled: true }
    }

    return { handled: false }
  }

  const anchor =
    viewSelection?.anchor ??
    getInitialProjectedSelectionAnchor({
      currentOwner,
      currentRoot,
      getActiveContentRootOwner,
      owners,
      selection: selection!,
    })
  let projectedSelection = createSlateViewSelection(graph, {
    anchor,
    focus: toProjectedPoint({
      owner: target.owner,
      point: target.point,
      root: target.root,
    }),
  })

  if (action.kind === 'move') {
    target = advanceVerticalBoundarySelectionTarget({
      action,
      anchorSelection: projectedSelection,
      currentOwner,
      currentRoot,
      editor,
      getContentRootOwnerViewEditor,
      getMountedViewEditor,
      owners,
      selection,
      target,
    })
    projectedSelection = createSlateViewSelection(graph, {
      anchor,
      focus: toProjectedPoint({
        owner: target.owner,
        point: target.point,
        root: target.root,
      }),
    })
  }

  writeSlateViewSelection(editor, projectedSelection)
  collapseModelSelectionForProjectedSelection(editor, selection)
  collapseNativeSelectionForProjectedSelection(editor, selection)

  preventDefault?.()

  return {
    handled: true,
    target,
  }
}

export const applyContentRootSelectionMoveCommand = ({
  command,
  editor,
  getActiveContentRootOwner,
  getContentRootOwnerViewEditor,
  getMountedViewEditor,
  isRTL = false,
  selection,
}: {
  command: SelectionMoveCommand
  editor: ReactRuntimeEditor
  getActiveContentRootOwner?: (root: RootKey) => ContentRootOwner | null
  getContentRootOwnerViewEditor?: (
    owner: ContentRootOwner
  ) => ReactRuntimeEditor | null
  getMountedViewEditor?: (root: RootKey) => ReactRuntimeEditor | null
  isRTL?: boolean
  selection: Range | null
}): ContentRootNavigationResult =>
  applyContentRootViewSelectionAction({
    action: getProjectedSelectionActionFromMoveCommand({ command, isRTL }),
    editor,
    getActiveContentRootOwner,
    getContentRootOwnerViewEditor,
    getMountedViewEditor,
    selection,
  })

export const applyContentRootViewSelection = ({
  editor,
  event,
  getActiveContentRootOwner,
  getContentRootOwnerViewEditor,
  getMountedViewEditor,
  isRTL,
  selection,
}: {
  editor: ReactRuntimeEditor
  event: ReactKeyboardEvent<HTMLDivElement>
  getActiveContentRootOwner?: (root: RootKey) => ContentRootOwner | null
  getContentRootOwnerViewEditor?: (
    owner: ContentRootOwner
  ) => ReactRuntimeEditor | null
  getMountedViewEditor?: (root: RootKey) => ReactRuntimeEditor | null
  isRTL: boolean
  selection: Range | null
}): ContentRootNavigationResult =>
  applyContentRootViewSelectionAction({
    action: getProjectedSelectionAction({ event, isRTL }),
    editor,
    getActiveContentRootOwner,
    getContentRootOwnerViewEditor,
    getMountedViewEditor,
    preventDefault: () => event.preventDefault(),
    selection,
  })

export const applyContentRootNavigation = ({
  editor,
  event,
  focusEditor,
  getActiveContentRootOwner,
  getContentRootOwnerViewEditor,
  getMountedViewEditor,
  isRTL,
  selection,
}: {
  editor: ReactRuntimeEditor
  event: ReactKeyboardEvent<HTMLDivElement>
  focusEditor?: (editor: ReactRuntimeEditor) => void
  getActiveContentRootOwner?: (root: RootKey) => ContentRootOwner | null
  getContentRootOwnerViewEditor?: (
    owner: ContentRootOwner
  ) => ReactRuntimeEditor | null
  getMountedViewEditor?: (root: RootKey) => ReactRuntimeEditor | null
  isRTL: boolean
  selection: Range | null
}): ContentRootNavigationResult => {
  const target = getContentRootNavigationTarget({
    editor,
    event,
    getActiveContentRootOwner,
    getContentRootOwnerViewEditor,
    getMountedViewEditor,
    isRTL,
    selection,
  })

  if (!target) {
    return { handled: false }
  }

  const targetEditor =
    (target.owner ? getContentRootOwnerViewEditor?.(target.owner) : null) ??
    getMountedViewEditor?.(target.root) ??
    getRegisteredRootViewEditor(editor, target.root) ??
    editor

  event.preventDefault()
  writeSlateViewSelection(editor, null)
  targetEditor.update((tx) => {
    tx.selection.set(rootedRange(target.point, target.root))
  })

  if (targetEditor !== editor) {
    focusEditor?.(targetEditor)
    scheduleSlateReactFocus(() => {
      focusEditor?.(targetEditor)
    })
  }

  return {
    handled: true,
    target,
  }
}
