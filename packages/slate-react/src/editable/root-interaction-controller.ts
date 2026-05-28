import {
  type MouseEvent,
  type MouseEventHandler,
  useCallback,
  useRef,
} from 'react'
import {
  type BaseSelection,
  PathApi,
  type Point,
  type Range,
  RangeApi,
  type RootKey,
} from 'slate'

import { scheduleSlateReactFocus } from '../hooks/focus-scheduler'
import {
  focusSlateEditable,
  focusSlateEditableAfterEventFrame,
} from '../hooks/focus-slate-editable'
import { getSlateNodePathFromDOMElement } from '../hooks/use-slate-node-ref'
import type { ReactRuntimeEditor } from '../plugin/react-editor'
import { getSlateRootBoundaryPoint } from '../view-boundary-graph'
import {
  createSlateViewSelection,
  writeSlateViewSelection,
} from '../view-selection'
import {
  type ContentRootOwner,
  createContentRootProjectionGraph,
  findContentRootOwners,
} from './content-root-navigation'
import {
  isRootInteractionEditableFocused,
  type RootInteractionFocusSelection,
  type RootInteractionMouseDownAction,
  type RootInteractionMouseUpAction,
  type RootInteractionSelectionMode,
  resolveRootInteractionMouseDown,
  resolveRootInteractionMouseUp,
  resolveRootInteractionTarget,
} from './root-interaction-resolver'

type SlateFocusableEditor = Parameters<typeof focusSlateEditable>[0]
const MAIN_ROOT_KEY: RootKey = 'main'

export type RootInteractionEditor = ReactRuntimeEditor &
  SlateFocusableEditor & {
    api: ReactRuntimeEditor['api'] &
      SlateFocusableEditor['api'] & {
        dom: ReactRuntimeEditor['api']['dom'] &
          SlateFocusableEditor['api']['dom'] & {
            resolveEventRange: (event: Event) => Range | null
          }
      }
  }

export type RootInteractionControllerOptions = {
  disabled: boolean
  editor: RootInteractionEditor
  getLastSelectionForRoot: (root: RootKey) => BaseSelection
  getMountedViewEditor: (root: RootKey) => RootInteractionEditor | null
  root: RootKey
  selection: RootInteractionSelectionMode
  selectionBridge?: {
    beforeModelSelection: () => void
    importDOMSelection: () => void
    syncDOMSelectionToEditor: () => void
  }
}

export type RootInteractionController = {
  onMouseDownCapture: MouseEventHandler<HTMLElement>
  onMouseMoveCapture: MouseEventHandler<HTMLElement>
  onMouseUpCapture: MouseEventHandler<HTMLElement>
}

type PendingRootInteraction = {
  action: RootInteractionMouseDownAction
  clientX: number
  clientY: number
  coordinateDragSelection: boolean
  preventNativeSelection: boolean
  startRange: Range | null
}

type RootInteractionDragEndpoint = {
  isDOMCoverageBoundary: boolean
  owner?: ContentRootOwner | null
  point: Point
  root: RootKey
}

type PendingProjectedDrag = {
  clientX: number
  clientY: number
  editor: RootInteractionEditor
  endpoint: RootInteractionDragEndpoint
}

let pendingProjectedDrag: PendingProjectedDrag | null = null

const withInteractionRangeRoot = (range: Range, root: RootKey): Range => {
  if (root === MAIN_ROOT_KEY) {
    return range
  }

  return {
    anchor:
      range.anchor.root === undefined
        ? { ...range.anchor, root }
        : range.anchor,
    focus:
      range.focus.root === undefined ? { ...range.focus, root } : range.focus,
  }
}

const hasExpandedDOMSelectionInTarget = (target: HTMLElement) => {
  const rootNode = target.getRootNode() as Document | ShadowRoot
  const selection =
    'getSelection' in rootNode
      ? rootNode.getSelection()
      : target.ownerDocument.getSelection()

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return false
  }

  const { anchorNode, focusNode } = selection

  return (
    !!anchorNode &&
    !!focusNode &&
    target.contains(anchorNode) &&
    target.contains(focusNode)
  )
}

const ignoreInteraction = (): PendingRootInteraction => ({
  action: { type: 'ignore' },
  clientX: 0,
  clientY: 0,
  coordinateDragSelection: false,
  preventNativeSelection: false,
  startRange: null,
})

const mouseEventTargetToElement = (
  target: EventTarget | null
): Element | null => {
  if (target instanceof Element) {
    return target
  }

  if (typeof Text !== 'undefined' && target instanceof Text) {
    return target.parentElement
  }

  return null
}

const getEditableRootFromTarget = (target: EventTarget | null): RootKey => {
  const element = mouseEventTargetToElement(target)
  const editableRoot = element?.closest('[data-slate-editor="true"]')

  return (editableRoot?.getAttribute('data-slate-root') ??
    MAIN_ROOT_KEY) as RootKey
}

const getContentRootOwnerFromTarget = ({
  childRoot,
  target,
}: {
  childRoot: RootKey
  target: EventTarget | null
}): ContentRootOwner | null => {
  if (childRoot === MAIN_ROOT_KEY) {
    return null
  }

  const element = mouseEventTargetToElement(target)
  const slotElement = element?.closest('[data-slate-content-root-slot]')
  const ownerElement = slotElement?.parentElement?.closest(
    '[data-slate-node="element"][data-slate-path]'
  )
  const ownerEditorElement = ownerElement?.closest('[data-slate-editor="true"]')
  const ownerPath =
    ownerElement instanceof HTMLElement
      ? getSlateNodePathFromDOMElement(ownerElement)
      : null
  const ownerRoot =
    ownerEditorElement?.getAttribute('data-slate-root') ?? MAIN_ROOT_KEY

  return ownerPath
    ? {
        childRoot,
        ownerPath,
        ownerRoot,
      }
    : null
}

const isSameOwner = (
  left: ContentRootOwner | null | undefined,
  right: ContentRootOwner | null | undefined
) =>
  (!left && !right) ||
  (!!left &&
    !!right &&
    left.childRoot === right.childRoot &&
    left.ownerRoot === right.ownerRoot &&
    PathApi.equals(left.ownerPath, right.ownerPath))

const isSameProjectedEndpoint = (
  left: RootInteractionDragEndpoint,
  right: RootInteractionDragEndpoint
) =>
  left.root === right.root &&
  isSameOwner(left.owner, right.owner) &&
  PathApi.equals(left.point.path, right.point.path) &&
  left.point.offset === right.point.offset

const toRootedPoint = (point: Point, root: RootKey): Point =>
  root === MAIN_ROOT_KEY ? point : { ...point, root }

const isDOMCoverageBoundaryTarget = (target: EventTarget | null) =>
  !!mouseEventTargetToElement(target)?.closest(
    '[data-slate-dom-coverage-boundary]'
  )

const shouldUseViewProjectedDragSelection = ({
  anchor,
  editor,
  focus,
}: {
  anchor: RootInteractionDragEndpoint
  editor: RootInteractionEditor
  focus: RootInteractionDragEndpoint
}) =>
  anchor.root !== focus.root ||
  !isSameOwner(anchor.owner, focus.owner) ||
  hasContentRootOwnerBetweenDragEndpoints({ anchor, editor, focus })

const comparePoints = (left: Point, right: Point) => {
  const pathComparison = PathApi.compare(left.path, right.path)

  if (pathComparison !== 0) {
    return pathComparison
  }

  if (left.offset === right.offset) {
    return 0
  }

  return left.offset < right.offset ? -1 : 1
}

const hasContentRootOwnerBetweenDragEndpoints = ({
  anchor,
  editor,
  focus,
}: {
  anchor: RootInteractionDragEndpoint
  editor: RootInteractionEditor
  focus: RootInteractionDragEndpoint
}) => {
  if (
    anchor.root !== focus.root ||
    anchor.owner ||
    focus.owner ||
    anchor.root !== MAIN_ROOT_KEY
  ) {
    return false
  }

  const [start, end] =
    comparePoints(anchor.point, focus.point) <= 0
      ? [anchor.point, focus.point]
      : [focus.point, anchor.point]

  return findContentRootOwners(editor).some(
    (owner) =>
      owner.ownerRoot === anchor.root &&
      PathApi.compare(owner.ownerPath, start.path) >= 0 &&
      PathApi.compare(owner.ownerPath, end.path) <= 0
  )
}

const shouldUseModelProjectedDragSelection = ({
  anchor,
  focus,
}: {
  anchor: RootInteractionDragEndpoint
  focus: RootInteractionDragEndpoint
}) =>
  anchor.root === focus.root &&
  isSameOwner(anchor.owner, focus.owner) &&
  (anchor.isDOMCoverageBoundary || focus.isDOMCoverageBoundary)

const findOwnerContainingPoint = (
  owners: readonly ContentRootOwner[],
  root: RootKey,
  point: Point
) =>
  root === MAIN_ROOT_KEY
    ? (owners.find(
        (owner) =>
          owner.ownerRoot === root &&
          (PathApi.equals(owner.ownerPath, point.path) ||
            PathApi.isAncestor(owner.ownerPath, point.path))
      ) ?? null)
    : null

const resolveContentRootOwnerChromeEdge = ({
  event,
  owner,
}: {
  event: MouseEvent<HTMLElement>
  owner: ContentRootOwner
}): 'end' | 'start' => {
  const element = mouseEventTargetToElement(event.target)
  const ownerElement = element?.closest<HTMLElement>(
    `[data-slate-node="element"][data-slate-path="${owner.ownerPath.join(',')}"]`
  )
  const slotElement = ownerElement?.querySelector<HTMLElement>(
    '[data-slate-content-root-slot]'
  )

  if (!slotElement) {
    return 'start'
  }

  const slotRect = slotElement.getBoundingClientRect()

  return event.clientY > slotRect.bottom ? 'end' : 'start'
}

const resolveContentRootOwnerChromeEndpoint = ({
  editor,
  event,
  owners,
  point,
  root,
}: {
  editor: RootInteractionEditor
  event: MouseEvent<HTMLElement>
  owners: readonly ContentRootOwner[]
  point: Point
  root: RootKey
}): RootInteractionDragEndpoint | null => {
  const owner = findOwnerContainingPoint(owners, root, point)

  if (!owner) {
    return null
  }

  const edge = resolveContentRootOwnerChromeEdge({ event, owner })
  const childPoint = editor.read((state) =>
    getSlateRootBoundaryPoint(
      state.value.get().roots[owner.childRoot] ?? [],
      edge
    )
  )

  return childPoint
    ? {
        isDOMCoverageBoundary: isDOMCoverageBoundaryTarget(event.target),
        owner,
        point: toRootedPoint(childPoint, owner.childRoot),
        root: owner.childRoot,
      }
    : null
}

const resolveProjectedDragEndpoint = ({
  editor,
  event,
  getMountedViewEditor,
}: {
  editor: RootInteractionEditor
  event: MouseEvent<HTMLElement>
  getMountedViewEditor: (root: RootKey) => RootInteractionEditor | null
}): RootInteractionDragEndpoint | null => {
  const targetRoot = getEditableRootFromTarget(event.target)
  const targetEditor = getMountedViewEditor(targetRoot) ?? editor
  const range = targetEditor.api.dom.resolveEventRange(event.nativeEvent)

  if (!range) {
    return null
  }

  const point = toRootedPoint(RangeApi.start(range), targetRoot)
  const ownerChromeEndpoint =
    targetRoot === MAIN_ROOT_KEY
      ? resolveContentRootOwnerChromeEndpoint({
          editor,
          event,
          owners: findContentRootOwners(editor),
          point,
          root: targetRoot,
        })
      : null

  if (ownerChromeEndpoint) {
    return ownerChromeEndpoint
  }

  return {
    isDOMCoverageBoundary: isDOMCoverageBoundaryTarget(event.target),
    owner: getContentRootOwnerFromTarget({
      childRoot: targetRoot,
      target: event.target,
    }),
    point,
    root: targetRoot,
  }
}

const resolveKnownOwner = (
  owners: readonly ContentRootOwner[],
  owner: ContentRootOwner | null | undefined
) => (owner ? owners.find((candidate) => isSameOwner(candidate, owner)) : null)

const applyProjectedDragSelection = ({
  anchor,
  editor,
  focus,
}: {
  anchor: RootInteractionDragEndpoint
  editor: RootInteractionEditor
  focus: RootInteractionDragEndpoint
}) => {
  if (isSameProjectedEndpoint(anchor, focus)) {
    return false
  }

  const owners = findContentRootOwners(editor)
  const anchorOwner = resolveKnownOwner(owners, anchor.owner)
  const focusOwner = resolveKnownOwner(owners, focus.owner)

  if ((anchor.owner && !anchorOwner) || (focus.owner && !focusOwner)) {
    return false
  }

  writeSlateViewSelection(
    editor,
    createSlateViewSelection(createContentRootProjectionGraph(editor, owners), {
      anchor: {
        ...(anchorOwner ? { owner: anchorOwner } : {}),
        point: anchor.point,
      },
      focus: {
        ...(focusOwner ? { owner: focusOwner } : {}),
        point: focus.point,
      },
    })
  )
  collapseModelSelectionToProjectedDragAnchor({ anchor, editor })

  return true
}

const collapseModelSelectionToProjectedDragAnchor = ({
  anchor,
  editor,
}: {
  anchor: RootInteractionDragEndpoint
  editor: RootInteractionEditor
}) => {
  const viewRoot = editor.read((state) => state.view.root())

  if (anchor.root !== viewRoot) {
    return
  }

  const range = withInteractionRangeRoot(
    {
      anchor: anchor.point,
      focus: anchor.point,
    },
    viewRoot
  )
  const selection = editor.read((state) => state.selection.get())

  if (selection && RangeApi.equals(selection, range)) {
    return
  }

  editor.update((tx) => {
    tx.selection.set(range)
  })
}

const applyModelProjectedDragSelection = ({
  anchor,
  editor,
  focus,
  selectionBridge,
}: {
  anchor: RootInteractionDragEndpoint
  editor: RootInteractionEditor
  focus: RootInteractionDragEndpoint
  selectionBridge?: RootInteractionControllerOptions['selectionBridge']
}) => {
  if (isSameProjectedEndpoint(anchor, focus)) {
    return false
  }

  selectionBridge?.beforeModelSelection()
  writeSlateViewSelection(editor, null)
  editor.update((tx) => {
    tx.selection.set({
      anchor: anchor.point,
      focus: focus.point,
    })
  })

  return true
}

const shouldPlaceFocusedNativeEditableFromCoordinates = (
  event: MouseEvent<HTMLElement>
) => {
  const element = mouseEventTargetToElement(event.target)
  const textHost = element?.closest('[data-slate-node="text"]')

  if (!textHost) {
    return false
  }

  return shouldPlaceNearSlateStringFromCoordinates({
    event,
    strings: Array.from(
      textHost.querySelectorAll<HTMLElement>(
        '[data-slate-string], [data-slate-zero-width]'
      )
    ),
  })
}

const shouldPlaceEditableRootChromeFromCoordinates = (
  event: MouseEvent<HTMLElement>
) => {
  const element = mouseEventTargetToElement(event.target)
  const editableRoot = element?.closest<HTMLElement>(
    '[data-slate-editor="true"]'
  )

  if (!editableRoot || !event.currentTarget.contains(editableRoot)) {
    return false
  }

  return shouldPlaceNearSlateStringFromCoordinates({
    event,
    strings: Array.from(
      editableRoot.querySelectorAll<HTMLElement>(
        '[data-slate-string], [data-slate-zero-width]'
      )
    ),
  })
}

const shouldPlaceNearSlateStringFromCoordinates = ({
  event,
  strings,
}: {
  event: MouseEvent<HTMLElement>
  strings: HTMLElement[]
}) => {
  const nearestString = strings
    .map((string) => {
      const rect = string.getBoundingClientRect()
      const verticalDistance =
        event.clientY < rect.top
          ? rect.top - event.clientY
          : event.clientY > rect.bottom
            ? event.clientY - rect.bottom
            : 0

      return { rect, verticalDistance }
    })
    .sort((left, right) => left.verticalDistance - right.verticalDistance)[0]

  if (!nearestString || nearestString.verticalDistance > 16) {
    return false
  }

  return (
    event.clientX < nearestString.rect.left - 4 ||
    event.clientX > nearestString.rect.right + 4
  )
}

const hasPointerMoved = (
  pending: PendingRootInteraction,
  event: MouseEvent<HTMLElement>
) =>
  Math.abs(event.clientX - pending.clientX) > 4 ||
  Math.abs(event.clientY - pending.clientY) > 4

const createDragSelectionRange = ({
  endRange,
  startRange,
}: {
  endRange: Range
  startRange: Range
}): Range => ({
  anchor: RangeApi.start(startRange),
  focus: RangeApi.end(endRange),
})

const canApplyCoordinateDragSelection = (
  pendingInteraction: PendingRootInteraction
) =>
  pendingInteraction.action.type === 'place-native-editable' ||
  pendingInteraction.coordinateDragSelection

const clearDOMSelectionFromEvent = (event: MouseEvent<HTMLElement>) => {
  const rootNode = event.currentTarget.getRootNode() as Document | ShadowRoot
  const domSelection =
    'getSelection' in rootNode
      ? rootNode.getSelection()
      : event.currentTarget.ownerDocument.getSelection()

  domSelection?.removeAllRanges()
}

const applyProjectedDragSelectionFromEvent = ({
  event,
  getMountedViewEditor,
  projectedDrag,
  selectionBridge,
}: {
  event: MouseEvent<HTMLElement>
  getMountedViewEditor: (root: RootKey) => RootInteractionEditor | null
  projectedDrag: PendingProjectedDrag
  selectionBridge?: RootInteractionControllerOptions['selectionBridge']
}) => {
  if (
    !hasPointerMoved(
      {
        action: { type: 'ignore' },
        clientX: projectedDrag.clientX,
        clientY: projectedDrag.clientY,
        coordinateDragSelection: false,
        preventNativeSelection: false,
        startRange: null,
      },
      event
    )
  ) {
    return false
  }

  const focus = resolveProjectedDragEndpoint({
    editor: projectedDrag.editor,
    event,
    getMountedViewEditor,
  })

  if (!focus) {
    return false
  }

  if (
    !(
      (shouldUseViewProjectedDragSelection({
        anchor: projectedDrag.endpoint,
        editor: projectedDrag.editor,
        focus,
      }) &&
        applyProjectedDragSelection({
          anchor: projectedDrag.endpoint,
          editor: projectedDrag.editor,
          focus,
        })) ||
      (shouldUseModelProjectedDragSelection({
        anchor: projectedDrag.endpoint,
        focus,
      }) &&
        applyModelProjectedDragSelection({
          anchor: projectedDrag.endpoint,
          editor: projectedDrag.editor,
          focus,
          selectionBridge,
        }))
    )
  ) {
    return false
  }

  event.preventDefault()
  clearDOMSelectionFromEvent(event)

  return true
}

const applyModelDragSelection = ({
  editor,
  range,
  root,
  selectionBridge,
}: {
  editor: RootInteractionEditor
  range: Range
  root: RootKey
  selectionBridge?: RootInteractionControllerOptions['selectionBridge']
}) => {
  selectionBridge?.beforeModelSelection()
  writeSlateViewSelection(editor, null)
  editor.update((tx) => {
    tx.selection.set(withInteractionRangeRoot(range, root))
  })
  selectionBridge?.syncDOMSelectionToEditor()
}

export const useRootInteractionController = ({
  disabled,
  editor,
  getLastSelectionForRoot,
  getMountedViewEditor,
  root,
  selection,
  selectionBridge,
}: RootInteractionControllerOptions): RootInteractionController => {
  const pendingInteractionRef = useRef<PendingRootInteraction>(
    ignoreInteraction()
  )

  const focusRoot = useCallback(
    ({
      forceSelection = false,
      selection: selectionPreference = selection,
    }: {
      forceSelection?: boolean
      selection?: RootInteractionFocusSelection
    } = {}) => {
      const focusEditor = getMountedViewEditor(root) ?? editor
      const getEndSelection = (): Range => {
        const point = focusEditor.read((state) => state.points.end([]))

        return { anchor: point, focus: point }
      }
      const focusSelection =
        selectionPreference === 'end'
          ? getEndSelection()
          : selectionPreference === 'restore' &&
              (forceSelection ||
                !focusEditor.read((state) => state.selection.get()))
            ? (getLastSelectionForRoot(root) ?? getEndSelection())
            : null
      const applyFocusSelection = () => {
        if (!focusSelection) {
          return false
        }

        writeSlateViewSelection(focusEditor, null)
        focusEditor.update((tx) => {
          tx.selection.set(focusSelection)
        })

        return true
      }
      const appliedSelection = applyFocusSelection()

      focusSlateEditableAfterEventFrame(focusEditor)

      if (appliedSelection) {
        globalThis.setTimeout?.(() => {
          applyFocusSelection()
          focusSlateEditableAfterEventFrame(focusEditor)
        }, 0)
      }
    },
    [editor, getLastSelectionForRoot, getMountedViewEditor, root, selection]
  )

  const applyInteractionAction = useCallback(
    (action: RootInteractionMouseUpAction) => {
      if (action.type === 'ignore') {
        return
      }
      const focusEditor = getMountedViewEditor(root) ?? editor

      if (action.type === 'set-selection') {
        selectionBridge?.beforeModelSelection()
        try {
          focusEditor.api.dom
            .assertDOMNode(focusEditor)
            .focus({ preventScroll: true })
        } catch {
          // The regular focus path below handles temporarily unmounted roots.
        }
        writeSlateViewSelection(focusEditor, null)
        focusEditor.update((tx) => {
          tx.selection.set(withInteractionRangeRoot(action.range, root))
        })
        focusSlateEditable(focusEditor)
        selectionBridge?.syncDOMSelectionToEditor()
        scheduleSlateReactFocus(() => {
          selectionBridge?.syncDOMSelectionToEditor()
        })
        return
      }

      focusRoot({
        forceSelection: action.selection === 'restore',
        selection: action.selection,
      })
    },
    [editor, focusRoot, getMountedViewEditor, root, selectionBridge]
  )

  const onMouseDownCapture = useCallback<MouseEventHandler<HTMLElement>>(
    (event) => {
      if (disabled || event.defaultPrevented) {
        return
      }

      const target = resolveRootInteractionTarget({
        currentTarget: event.currentTarget,
        target: event.target,
      })
      const editableRoot =
        target.kind === 'editable-root' || target.kind === 'native-editable'
          ? target.editableRoot
          : null
      let action = resolveRootInteractionMouseDown({
        editableRootFocused: editableRoot
          ? isRootInteractionEditableFocused(editableRoot)
          : undefined,
        target,
      })
      const placeRootChromeFromCoordinates =
        action.type === 'activate-root' &&
        shouldPlaceEditableRootChromeFromCoordinates(event)
      const placeFocusedNativeEditableFromCoordinates =
        action.type === 'ignore' &&
        target.kind === 'native-editable' &&
        shouldPlaceFocusedNativeEditableFromCoordinates(event)
      const preventNativeSelection =
        action.type === 'place-native-editable' ||
        placeRootChromeFromCoordinates ||
        placeFocusedNativeEditableFromCoordinates

      if (
        action.type === 'place-native-editable' ||
        placeFocusedNativeEditableFromCoordinates
      ) {
        action = { type: 'place-native-editable' }
      }

      const focusEditor = getMountedViewEditor(root) ?? editor
      const startRange =
        action.type === 'place-native-editable' ||
        placeRootChromeFromCoordinates
          ? focusEditor.api.dom.resolveEventRange(event.nativeEvent)
          : null
      const projectedDragEndpoint = resolveProjectedDragEndpoint({
        editor,
        event,
        getMountedViewEditor,
      })

      pendingProjectedDrag = projectedDragEndpoint
        ? {
            clientX: event.clientX,
            clientY: event.clientY,
            editor,
            endpoint: projectedDragEndpoint,
          }
        : null

      pendingInteractionRef.current = {
        action,
        clientX: event.clientX,
        clientY: event.clientY,
        coordinateDragSelection: placeRootChromeFromCoordinates,
        preventNativeSelection,
        startRange,
      }

      if (action.type === 'ignore') {
        return
      }

      if (
        ('preventDefault' in action && action.preventDefault) ||
        preventNativeSelection
      ) {
        event.preventDefault()
      }

      if (action.type === 'place-editable-root') {
        return
      }

      if (action.type === 'place-native-editable') {
        if (startRange) {
          applyInteractionAction({
            range: startRange,
            type: 'set-selection',
          })
        }
        return
      }

      scheduleSlateReactFocus(() => {
        applyInteractionAction(
          resolveRootInteractionMouseUp({
            eventRange: null,
            pendingAction: action,
            selection,
          })
        )
      })
    },
    [
      applyInteractionAction,
      disabled,
      editor,
      getMountedViewEditor,
      root,
      selection,
    ]
  )

  const onMouseMoveCapture = useCallback<MouseEventHandler<HTMLElement>>(
    (event) => {
      const pendingInteraction = pendingInteractionRef.current
      const projectedDrag = pendingProjectedDrag

      if (event.buttons === 0) {
        pendingProjectedDrag = null
        return
      }

      if (
        projectedDrag &&
        applyProjectedDragSelectionFromEvent({
          event,
          getMountedViewEditor,
          projectedDrag,
          selectionBridge,
        })
      ) {
        return
      }

      if (disabled || !canApplyCoordinateDragSelection(pendingInteraction)) {
        return
      }

      const focusEditor = getMountedViewEditor(root) ?? editor
      const eventRange = focusEditor.api.dom.resolveEventRange(
        event.nativeEvent
      )

      if (
        eventRange &&
        pendingInteraction.startRange &&
        hasPointerMoved(pendingInteraction, event)
      ) {
        event.preventDefault()
        applyModelDragSelection({
          editor: focusEditor,
          range: createDragSelectionRange({
            endRange: eventRange,
            startRange: pendingInteraction.startRange,
          }),
          root,
          selectionBridge,
        })
      }
    },
    [disabled, editor, getMountedViewEditor, root, selectionBridge]
  )

  const onMouseUpCapture = useCallback<MouseEventHandler<HTMLElement>>(
    (event) => {
      const pendingInteraction = pendingInteractionRef.current
      pendingInteractionRef.current = ignoreInteraction()
      const { action: pendingAction } = pendingInteraction
      const projectedDrag = pendingProjectedDrag
      pendingProjectedDrag = null

      if (
        projectedDrag &&
        applyProjectedDragSelectionFromEvent({
          event,
          getMountedViewEditor,
          projectedDrag,
          selectionBridge,
        })
      ) {
        return
      }

      if (pendingAction.type === 'ignore') {
        if (!disabled && hasExpandedDOMSelectionInTarget(event.currentTarget)) {
          selectionBridge?.importDOMSelection()
        }

        return
      }

      if (disabled) {
        return
      }

      if (
        ('preventDefault' in pendingAction && pendingAction.preventDefault) ||
        pendingInteraction.preventNativeSelection
      ) {
        event.preventDefault()
      }

      if (
        pendingAction.type === 'place-native-editable' &&
        hasExpandedDOMSelectionInTarget(event.currentTarget)
      ) {
        selectionBridge?.importDOMSelection()
        return
      }

      const focusEditor = getMountedViewEditor(root) ?? editor
      const eventRange = focusEditor.api.dom.resolveEventRange(
        event.nativeEvent
      )
      const pointerMoved = hasPointerMoved(pendingInteraction, event)

      if (
        canApplyCoordinateDragSelection(pendingInteraction) &&
        eventRange &&
        pendingInteraction.startRange &&
        pointerMoved
      ) {
        applyInteractionAction({
          range: createDragSelectionRange({
            endRange: eventRange,
            startRange: pendingInteraction.startRange,
          }),
          type: 'set-selection',
        })
        return
      }

      if (
        pendingAction.type === 'place-native-editable' &&
        pendingInteraction.startRange &&
        !pointerMoved
      ) {
        applyInteractionAction({
          range: pendingInteraction.startRange,
          type: 'set-selection',
        })
        return
      }

      applyInteractionAction(
        resolveRootInteractionMouseUp({
          eventRange,
          pendingAction,
          selection,
        })
      )
    },
    [
      applyInteractionAction,
      disabled,
      editor,
      getMountedViewEditor,
      root,
      selection,
      selectionBridge,
    ]
  )

  return {
    onMouseDownCapture,
    onMouseMoveCapture,
    onMouseUpCapture,
  }
}
