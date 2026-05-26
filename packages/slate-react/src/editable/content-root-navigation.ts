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
import { getEditorExtensionRegistry } from './runtime-editor-api'

type ContentRootNavigationDirection = 'backward' | 'forward'
type ContentRootNavigationAxis = 'horizontal' | 'vertical'

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

type ContentRootOwner = {
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

const getBoundaryPoint = (
  node: Descendant,
  path: Path,
  edge: 'end' | 'start'
): Point | null => {
  if (NodeApi.isText(node)) {
    return {
      path: [...path],
      offset: edge === 'start' ? 0 : node.text.length,
    }
  }

  const childIndexes =
    edge === 'start'
      ? node.children.keys()
      : [...node.children.keys()].reverse()

  for (const index of childIndexes) {
    const child = node.children[index]
    const point = child && getBoundaryPoint(child, path.concat(index), edge)

    if (point) {
      return point
    }
  }

  return null
}

const getRootBoundaryPoint = (
  children: readonly Descendant[],
  edge: 'end' | 'start'
): Point | null => {
  const indexes =
    edge === 'start' ? children.keys() : [...children.keys()].reverse()

  for (const index of indexes) {
    const child = children[index]
    const point = child && getBoundaryPoint(child, [index], edge)

    if (point) {
      return point
    }
  }

  return null
}

const sameRootPoint = (left: Point, right: Point, root: RootKey) =>
  (left.root ?? root) === (right.root ?? root) &&
  left.offset === right.offset &&
  PathApi.equals(left.path, right.path)

const isPointInPath = (point: Point, path: Path) =>
  PathApi.equals(point.path, path) || PathApi.isDescendant(point.path, path)

const rootedPoint = (point: Point, root: RootKey): Point =>
  root === 'main' ? point : { ...point, root }

const rootedRange = (point: Point, root: RootKey): Range => {
  const rooted = rootedPoint(point, root)

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

const findContentRootOwners = (
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

const getNodeAtPath = (
  children: readonly Descendant[],
  path: Path
): Descendant | null => {
  let node: Descendant | null = children[path[0]!] ?? null

  for (const index of path.slice(1)) {
    if (!node || !NodeApi.isElement(node)) {
      return null
    }

    node = node.children[index] ?? null
  }

  return node
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

  const sibling = getNodeAtPath(children, siblingPath)

  if (!sibling) {
    return null
  }

  const point = getBoundaryPoint(
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
    const ownerNode = children && getNodeAtPath(children, owner.ownerPath)

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

    return getBoundaryPoint(
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
    const ownerNode = children && getNodeAtPath(children, owner.ownerPath)

    return ownerNode ? getBoundaryPoint(ownerNode, owner.ownerPath, edge) : null
  })

const getExitBoundaryPoint = (
  editor: ContentRootNavigationEditor,
  owner: ContentRootOwner,
  direction: ContentRootNavigationDirection
): Point | null =>
  editor.read((state) => {
    const children = state.value.get().roots[owner.ownerRoot]
    const ownerNode = children && getNodeAtPath(children, owner.ownerPath)

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

    return getBoundaryPoint(
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
    getRootBoundaryPoint(
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
    getRootBoundaryPoint(
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
    const sourceEditor = getRootViewEditor({
      editor,
      getMountedViewEditor,
      root: currentRoot,
    })
    const rootEdge = editor.read((state) =>
      getRootBoundaryPoint(
        state.value.get().roots[currentRoot] ?? [],
        direction === 'forward' ? 'end' : 'start'
      )
    )
    const atModelBoundary =
      rootEdge && sameRootPoint(point, rootEdge, currentRoot)
    const sourceElement = sourceEditor?.api.dom.resolveDOMNode(sourceEditor)
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

    return targetPoint
      ? {
          point: targetPoint,
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
      entryPoint && sameRootPoint(point, entryPoint, currentRoot)
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

  if (action.kind === 'enter') {
    for (const owner of owners) {
      if (owner.ownerRoot !== currentRoot) {
        continue
      }

      const start = getOwnerSelfBoundaryPoint(editor, owner, 'start')
      const end = getOwnerSelfBoundaryPoint(editor, owner, 'end')

      if (
        (start && sameRootPoint(point, start, currentRoot)) ||
        (end && sameRootPoint(point, end, currentRoot))
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
      getActiveContentRootOwner,
      owners,
    })
  }

  const { direction } = action

  if (action.axis === 'vertical') {
    return getVerticalNavigationTarget({
      currentRoot,
      direction,
      editor,
      getActiveContentRootOwner,
      getContentRootOwnerViewEditor,
      getMountedViewEditor,
      owners,
      point,
    })
  }

  const activeOwner = getActiveContentRootOwner?.(currentRoot)
  const ownerForCurrentRoot = isKnownContentRootOwner(owners, activeOwner)
    ? activeOwner
    : owners.find((owner) => owner.childRoot === currentRoot)

  if (ownerForCurrentRoot) {
    const rootEdge = editor.read((state) =>
      getRootBoundaryPoint(
        state.value.get().roots[currentRoot] ?? [],
        direction === 'forward' ? 'end' : 'start'
      )
    )
    const exitPoint =
      rootEdge && sameRootPoint(point, rootEdge, currentRoot)
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

    if (entryPoint && sameRootPoint(point, entryPoint, currentRoot)) {
      return getRootBoundaryNavigationTarget({
        direction,
        editor,
        owner,
      })
    }
  }

  return null
}

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
