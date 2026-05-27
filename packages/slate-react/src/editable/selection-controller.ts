import type { RefObject } from 'react'
import {
  type Point,
  PointApi,
  type Range,
  RangeApi,
  type RootKey,
  type Selection,
  type TargetFreshnessRequest,
} from 'slate'
import {
  containsShadowAware,
  type DOMRange,
  ELEMENT_TO_NODE,
  getSelection,
  IS_ANDROID,
  IS_FOCUSED,
  IS_NODE_MAP_DIRTY,
  IS_WEBKIT,
  isDOMElement,
  isDOMNode,
  isDOMText,
} from 'slate-dom'
import type { AndroidInputManager } from '../hooks/android-input-manager/android-input-manager'
import {
  getSlateNodeElementByPath,
  getSlateNodePathFromDOMElement,
} from '../hooks/use-slate-node-ref'
import { ReactEditor, type ReactRuntimeEditor } from '../plugin/react-editor'
import {
  createSlateViewSelection,
  readSlateViewSelection,
  writeSlateViewSelection,
} from '../view-selection'
import {
  type ContentRootOwner,
  createContentRootProjectionGraph,
  findContentRootOwners,
} from './content-root-navigation'
import { applyDOMCoverageSelectionPolicy } from './dom-coverage-selection'
import type { EditableSelectionPolicy } from './editing-kernel'
import type {
  EditableInputController,
  ModelSelectionPreferenceReason,
  SelectionChangeOrigin,
  SelectionSource,
} from './input-state'
import { isEditableOutsideFocusBoundarySettling } from './input-state'
import {
  readLiveSelection,
  readRuntimeSelection,
} from './runtime-selection-state'
import {
  shouldSkipDOMSelection,
  shouldSkipSelectionScroll,
} from './selection-side-effect-policy'

export type EditableSelectionController = {
  inputController: EditableInputController
}

const MODEL_BACKED_FULL_DOCUMENT_CHILD_THRESHOLD = 1000
const MAIN_ROOT_KEY = 'main'

const isNestedEditableDOMTarget = (
  editorElement: HTMLElement,
  target: EventTarget | null
) => {
  const targetElement = isDOMElement(target)
    ? target
    : isDOMText(target)
      ? target.parentElement
      : null
  const targetEditor = targetElement?.closest('[data-slate-editor="true"]')

  return Boolean(
    targetEditor &&
      targetEditor !== editorElement &&
      editorElement.contains(targetEditor)
  )
}

export const isSelectionInEditorView = (
  editor: ReactRuntimeEditor,
  selection: Range | null
) => {
  if (!selection) {
    return true
  }

  const selectionRoot = selection.anchor.root ?? MAIN_ROOT_KEY
  const viewRoot = editor.read((state) => state.view.root())

  return selectionRoot === viewRoot
}

type ProjectedDOMSelectionEndpoint = {
  owner?: ContentRootOwner
  point: Point
  root: RootKey
}

const getDOMElementForNode = (node: globalThis.Node | null) =>
  isDOMElement(node) ? node : isDOMText(node) ? node.parentElement : null

const getDOMEditorElementForNode = (
  node: globalThis.Node | null
): HTMLElement | null => {
  const element = getDOMElementForNode(node)
  const editorElement = element?.closest('[data-slate-editor="true"]')

  return editorElement instanceof HTMLElement ? editorElement : null
}

const getEditorFromDOMEditorElement = (
  editorElement: HTMLElement
): ReactRuntimeEditor | null => {
  const editor = ELEMENT_TO_NODE.get(editorElement)

  return editor &&
    typeof editor === 'object' &&
    'read' in editor &&
    'update' in editor
    ? (editor as ReactRuntimeEditor)
    : null
}

const getContentRootOwnerFromDOMEndpoint = ({
  childRoot,
  node,
}: {
  childRoot: RootKey
  node: globalThis.Node | null
}): ContentRootOwner | null => {
  if (childRoot === MAIN_ROOT_KEY) {
    return null
  }

  const element = getDOMElementForNode(node)
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

const isSameContentRootOwner = (
  left: ContentRootOwner | null | undefined,
  right: ContentRootOwner | null | undefined
) =>
  (!left && !right) ||
  (!!left &&
    !!right &&
    left.childRoot === right.childRoot &&
    left.ownerRoot === right.ownerRoot &&
    left.ownerPath.length === right.ownerPath.length &&
    left.ownerPath.every((part, index) => part === right.ownerPath[index]))

const isKnownContentRootOwner = (
  owner: ContentRootOwner | null | undefined,
  owners: readonly ContentRootOwner[]
): owner is ContentRootOwner =>
  !!owner &&
  owners.some((candidate) => isSameContentRootOwner(owner, candidate))

const resolveProjectedDOMSelectionEndpoint = ({
  node,
  offset,
}: {
  node: globalThis.Node | null
  offset: number
}): ProjectedDOMSelectionEndpoint | null => {
  const editorElement = getDOMEditorElementForNode(node)
  const editor = editorElement
    ? getEditorFromDOMEditorElement(editorElement)
    : null

  if (!editorElement || !editor || !node) {
    return null
  }

  const range = editorElement.ownerDocument.createRange()

  try {
    range.setStart(node, offset)
    range.collapse(true)
  } catch {
    return null
  }

  const slateRange = editor.api.dom.resolveSlateRange(range, {
    exactMatch: false,
  })

  if (!slateRange || !RangeApi.isCollapsed(slateRange)) {
    return null
  }

  const root = editor.read((state) => state.view.root())

  const owner = getContentRootOwnerFromDOMEndpoint({
    childRoot: root,
    node,
  })

  return {
    ...(owner ? { owner } : {}),
    point: {
      ...slateRange.anchor,
      ...(root === MAIN_ROOT_KEY ? {} : { root }),
    },
    root,
  }
}

const resolveProjectedDOMSelection = ({
  domSelection,
  editor,
  editorElement,
}: {
  domSelection: globalThis.Selection
  editor: ReactRuntimeEditor
  editorElement: HTMLElement
}) => {
  if (domSelection.isCollapsed) {
    return null
  }

  const anchorEditorElement = getDOMEditorElementForNode(
    domSelection.anchorNode
  )
  const focusEditorElement = getDOMEditorElementForNode(domSelection.focusNode)

  if (
    !anchorEditorElement ||
    !focusEditorElement ||
    !editorElement.contains(anchorEditorElement) ||
    !editorElement.contains(focusEditorElement)
  ) {
    return null
  }

  const anchor = resolveProjectedDOMSelectionEndpoint({
    node: domSelection.anchorNode,
    offset: domSelection.anchorOffset,
  })
  const focus = resolveProjectedDOMSelectionEndpoint({
    node: domSelection.focusNode,
    offset: domSelection.focusOffset,
  })

  if (!anchor || !focus) {
    return null
  }

  if (
    anchor.root === focus.root &&
    isSameContentRootOwner(anchor.owner, focus.owner)
  ) {
    return null
  }

  const owners = findContentRootOwners(editor)
  const anchorOwner = anchor.owner
    ? owners.find((owner) => isSameContentRootOwner(owner, anchor.owner))
    : null
  const focusOwner = focus.owner
    ? owners.find((owner) => isSameContentRootOwner(owner, focus.owner))
    : null

  if (
    (anchor.root !== MAIN_ROOT_KEY &&
      !isKnownContentRootOwner(anchorOwner, owners)) ||
    (focus.root !== MAIN_ROOT_KEY &&
      !isKnownContentRootOwner(focusOwner, owners))
  ) {
    return null
  }

  return createSlateViewSelection(
    createContentRootProjectionGraph(editor, owners),
    {
      anchor: {
        ...(anchorOwner ? { owner: anchorOwner } : {}),
        point: anchor.point,
      },
      focus: {
        ...(focusOwner ? { owner: focusOwner } : {}),
        point: focus.point,
      },
    }
  )
}

const getActiveElementInDocument = (targetDocument: Document) => {
  let activeElement = targetDocument.activeElement

  while (activeElement?.shadowRoot?.activeElement) {
    activeElement = activeElement.shadowRoot.activeElement
  }

  return activeElement
}

export const executeEditableSelectionImport = ({
  importSelection,
  selectionPolicy,
}: {
  importSelection: () => void
  selectionPolicy: EditableSelectionPolicy
}) => {
  if (selectionPolicy.kind !== 'import-dom') {
    return false
  }

  importSelection()
  return true
}

export const executeEditableSelectionExport = ({
  exportSelection,
  selectionPolicy,
}: {
  exportSelection: () => void
  selectionPolicy: EditableSelectionPolicy
}) => {
  if (selectionPolicy.kind !== 'export-model') {
    return false
  }

  exportSelection()
  return true
}

const getDOMPointForSlateTextPoint = (
  editor: ReactRuntimeEditor,
  point: Point
): { node: globalThis.Node; offset: number } | null => {
  const textHost = getSlateNodeElementByPath(editor, point.path)

  if (!textHost) {
    return null
  }

  const strings = Array.from(
    textHost.querySelectorAll('[data-slate-string], [data-slate-zero-width]')
  )
  let offset = 0

  for (const string of strings) {
    const textNode = Array.from(string.childNodes).find(isDOMText)
    const lengthAttribute = string.getAttribute('data-slate-length')
    const length =
      lengthAttribute == null
        ? (textNode?.textContent?.length ?? string.textContent?.length ?? 0)
        : Number.parseInt(lengthAttribute, 10)
    const nextOffset = offset + (Number.isFinite(length) ? length : 0)

    if (point.offset <= nextOffset) {
      const zeroWidthOffset =
        textNode?.textContent?.startsWith('\uFEFF') ||
        string.textContent === '\uFEFF'
          ? 1
          : 0

      return {
        node: textNode ?? string,
        offset: string.hasAttribute('data-slate-zero-width')
          ? zeroWidthOffset
          : Math.max(0, Math.min(point.offset - offset, length)),
      }
    }

    offset = nextOffset
  }

  return null
}

const isFullDocumentSelection = (
  editor: ReactRuntimeEditor,
  selection: Range
) => {
  try {
    const [start, end] = RangeApi.edges(selection)
    const [documentStart, documentEnd] = editor.read((state) => [
      state.points.start([]),
      state.points.end([]),
    ])

    return (
      PointApi.equals(start, documentStart) && PointApi.equals(end, documentEnd)
    )
  } catch {
    return false
  }
}

const shouldKeepFullDocumentSelectionModelBacked = ({
  editor,
  editorElement,
  selection,
}: {
  editor: ReactRuntimeEditor
  editorElement: HTMLElement
  selection: Range
}) => {
  const rootChildCount = editor.read((state) => state.nodes.children().length)

  return (
    (rootChildCount > MODEL_BACKED_FULL_DOCUMENT_CHILD_THRESHOLD ||
      editorElement.childNodes.length >
        MODEL_BACKED_FULL_DOCUMENT_CHILD_THRESHOLD) &&
    isFullDocumentSelection(editor, selection)
  )
}

const createDOMSelectionRangeFromEndpoints = ({
  editorElement,
  end,
  start,
}: {
  editorElement: HTMLElement
  end: { node: globalThis.Node; offset: number }
  start: { node: globalThis.Node; offset: number }
}) => {
  const range = editorElement.ownerDocument.createRange()

  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)

  return range
}

const isSamePath = (left: readonly number[], right: readonly number[]) =>
  left.length === right.length &&
  left.every((part, index) => part === right[index])

const createFastDOMSelectionRange = ({
  editor,
  editorElement,
  selection,
}: {
  editor: ReactRuntimeEditor
  editorElement: HTMLElement
  selection: Range
}): DOMRange | null => {
  if (isFullDocumentSelection(editor, selection)) {
    return createDOMSelectionRangeFromEndpoints({
      editorElement,
      end: {
        node: editorElement,
        offset: editorElement.childNodes.length,
      },
      start: {
        node: editorElement,
        offset: 0,
      },
    })
  }

  const [start, end] = RangeApi.edges(selection)

  if (!isSamePath(start.path, end.path)) {
    return null
  }

  const startDOMPoint = getDOMPointForSlateTextPoint(editor, start)
  const endDOMPoint = getDOMPointForSlateTextPoint(editor, end)

  if (!startDOMPoint || !endDOMPoint) {
    return null
  }

  return createDOMSelectionRangeFromEndpoints({
    editorElement,
    end: endDOMPoint,
    start: startDOMPoint,
  })
}

export const syncEditorSelectionFromDOM = ({
  editor,
  ignoreModelSelectionPreference = false,
  inputController,
}: {
  editor: ReactRuntimeEditor
  ignoreModelSelectionPreference?: boolean
  inputController: EditableInputController
}) => {
  if (
    isEditableModelSelectionPreferred(inputController) &&
    !ignoreModelSelectionPreference
  ) {
    return
  }

  const root = ReactEditor.findDocumentOrShadowRoot(editor)
  const domSelection = getSelection(root)

  if (!domSelection || domSelection.rangeCount === 0) {
    return
  }

  const { anchorNode, focusNode } = domSelection

  const editorElement = ReactEditor.assertDOMNode(editor, editor)

  if (
    isNestedEditableDOMTarget(editorElement, anchorNode) ||
    isNestedEditableDOMTarget(editorElement, focusNode)
  ) {
    return
  }

  const anchorNodeSelectable = ReactEditor.hasSelectableTarget(
    editor,
    anchorNode
  )
  const focusNodeSelectable = ReactEditor.hasSelectableTarget(editor, focusNode)

  if (!anchorNodeSelectable || !focusNodeSelectable) {
    return
  }

  const range = ReactEditor.resolveSlateRange(editor, domSelection, {
    exactMatch: false,
  })
  const selection = readRuntimeSelection(editor)

  if (range && (!selection || !RangeApi.equals(selection, range))) {
    writeSlateViewSelection(editor, null)
    editor.update((tx) => {
      tx.selection.set(range)
    })
  }
}

export const setEditableModelSelectionPreference = ({
  inputController,
  preferModelSelection,
  reason,
  selectionSource,
}: {
  inputController: EditableInputController
  preferModelSelection: boolean
  reason?: ModelSelectionPreferenceReason
  selectionSource?: SelectionSource
}) => {
  // Keep the input guard and the controller's selection provenance in lockstep.
  const nextSelectionSource =
    selectionSource ?? (preferModelSelection ? 'model-owned' : 'dom-current')

  inputController.preferModelSelectionForInputRef.current = preferModelSelection
  inputController.state.selectionSource = nextSelectionSource
  inputController.state.modelSelectionPreference = {
    preferModelSelection,
    reason:
      reason ??
      inferModelSelectionPreferenceReason({
        preferModelSelection,
        selectionSource: nextSelectionSource,
      }),
    selectionSource: nextSelectionSource,
  }
}

export const isEditableModelSelectionPreferred = (
  inputController: EditableInputController
) => inputController.preferModelSelectionForInputRef.current

const inferModelSelectionPreferenceReason = ({
  preferModelSelection,
  selectionSource,
}: {
  preferModelSelection: boolean
  selectionSource: SelectionSource
}): ModelSelectionPreferenceReason => {
  if (!preferModelSelection) {
    return selectionSource === 'dom-current' ? 'native-selection' : 'unknown'
  }

  switch (selectionSource) {
    case 'app-owned':
    case 'internal-control':
      return 'internal-control'
    case 'composition-owned':
      return 'composition'
    case 'partial-dom-backed':
      return 'partial-dom-backed'
    default:
      return 'model-command'
  }
}

export const isEditableModelSelectionPreferredForInput = ({
  inputController,
  inputType,
}: {
  inputController: EditableInputController
  inputType: string
}) => {
  if (!isEditableModelSelectionPreferred(inputController)) {
    return false
  }

  if (inputType !== 'insertText') {
    return true
  }

  const preference = inputController.state.modelSelectionPreference

  if (!preference?.preferModelSelection) {
    return false
  }

  return (
    inputController.state.isComposing ||
    preference.reason === 'browser-handle' ||
    preference.reason === 'composition' ||
    preference.reason === 'internal-control' ||
    preference.reason === 'model-command' ||
    preference.reason === 'partial-dom-backed'
  )
}

export const shouldImportChangedExpandedDOMSelection = ({
  currentSelection,
  nextSelection,
  selectionChangeOrigin,
}: {
  currentSelection: Selection
  nextSelection: Range | null
  selectionChangeOrigin: SelectionChangeOrigin
}) => {
  if (
    selectionChangeOrigin === 'repair-induced' ||
    !nextSelection ||
    !RangeApi.isExpanded(nextSelection)
  ) {
    return false
  }

  return !currentSelection || !RangeApi.equals(currentSelection, nextSelection)
}

export const shouldApplyDOMSelectionChange = ({
  changedExpandedDOMSelection,
  selectionChangeOrigin,
}: {
  changedExpandedDOMSelection: boolean
  selectionChangeOrigin: SelectionChangeOrigin
}) => selectionChangeOrigin === 'native-user' || changedExpandedDOMSelection

export const prepareEditableSelectionChangeImport = ({
  domSelectionBelongsToEditor,
  domSelectionCanImport = domSelectionBelongsToEditor,
  inputController,
  selectionChangeOrigin,
}: {
  domSelectionCanImport?: boolean
  domSelectionBelongsToEditor: boolean
  inputController: EditableInputController
  selectionChangeOrigin: SelectionChangeOrigin
}) => {
  if (
    selectionChangeOrigin !== 'native-user' ||
    !domSelectionBelongsToEditor ||
    !domSelectionCanImport
  ) {
    return false
  }

  setEditableModelSelectionPreference({
    inputController,
    preferModelSelection: false,
    selectionSource: 'dom-current',
  })

  return true
}

export const completeEditableSelectionChangeImport = ({
  inputController,
  selectionChangeOrigin,
}: {
  inputController: EditableInputController
  selectionChangeOrigin: SelectionChangeOrigin
}) => {
  if (inputController.state.selectionChangeOrigin !== selectionChangeOrigin) {
    return
  }

  if (
    isEditableModelSelectionPreferred(inputController) &&
    (selectionChangeOrigin === 'browser-handle' ||
      selectionChangeOrigin === 'programmatic-export')
  ) {
    return
  }

  inputController.state.selectionChangeOrigin = null
}

export const resolveEditableImplicitTarget = ({
  editor,
  inputController,
  request,
  scheduleSelectionSync = (callback) => {
    setTimeout(callback)
  },
  syncDOMSelectionToEditor,
}: {
  editor: ReactRuntimeEditor
  inputController: EditableInputController
  request: TargetFreshnessRequest
  scheduleSelectionSync?: (callback: () => void) => void
  syncDOMSelectionToEditor: () => void
}) => {
  const preferModelSelection =
    isEditableModelSelectionPreferred(inputController)

  const root = ReactEditor.findDocumentOrShadowRoot(editor)
  const domSelection = getSelection(root)

  if (!domSelection || domSelection.rangeCount === 0) {
    return request.fallback
  }

  const { anchorNode, focusNode } = domSelection
  const anchorNodeSelectable = ReactEditor.hasSelectableTarget(
    editor,
    anchorNode
  )
  const focusNodeSelectable = ReactEditor.hasSelectableTarget(editor, focusNode)

  if (!anchorNodeSelectable || !focusNodeSelectable) {
    return request.fallback
  }

  const target =
    ReactEditor.resolveSlateRange(editor, domSelection, {
      exactMatch: false,
    }) ?? request.fallback

  if (
    preferModelSelection &&
    (!RangeApi.isRange(target) || !RangeApi.isExpanded(target))
  ) {
    return request.fallback
  }

  if (target) {
    if (preferModelSelection) {
      setEditableModelSelectionPreference({
        inputController,
        preferModelSelection: false,
        selectionSource: 'dom-current',
      })
    }

    scheduleSelectionSync(syncDOMSelectionToEditor)
  }

  return target
}

export const applyEditableDOMSelectionChange = ({
  androidInputManager,
  editor,
  inputController,
  processing,
  readOnly,
  rerunOnDirtyNodeMap,
}: {
  androidInputManager: AndroidInputManager | null | undefined
  editor: ReactRuntimeEditor
  inputController: EditableInputController
  processing: RefObject<boolean>
  readOnly: boolean
  rerunOnDirtyNodeMap: () => void
}) => {
  if (IS_NODE_MAP_DIRTY.get(editor)) {
    rerunOnDirtyNodeMap()
    return
  }

  const editorElement = ReactEditor.assertDOMNode(editor, editor)
  const editorDocument = editorElement.ownerDocument
  const ShadowRootConstructor = editorDocument.defaultView?.ShadowRoot
  const editorRoot = editorElement.getRootNode()

  if (
    !processing.current &&
    IS_WEBKIT &&
    ShadowRootConstructor &&
    editorRoot instanceof ShadowRootConstructor
  ) {
    processing.current = true

    const active = getActiveElementInDocument(editorDocument)

    if (active) {
      editorDocument.execCommand('indent')
    } else {
      writeSlateViewSelection(editor, null)
      editor.update((tx) => {
        tx.selection.clear()
      })
    }

    processing.current = false
    return
  }

  const state = inputController.state
  if (
    (!IS_ANDROID && ReactEditor.isComposing(editor)) ||
    state.isDraggingInternally ||
    isEditableOutsideFocusBoundarySettling(state)
  ) {
    return
  }

  const root = ReactEditor.findDocumentOrShadowRoot(editor)
  const { activeElement } = root
  const domSelection = getSelection(root)

  if (activeElement === editorElement) {
    state.latestElement = activeElement
    IS_FOCUSED.set(editor, true)
  } else {
    IS_FOCUSED.delete(editor)
  }

  if (!domSelection) {
    setEditableModelSelectionPreference({
      inputController,
      preferModelSelection: false,
      selectionSource: 'unknown',
    })
    writeSlateViewSelection(editor, null)
    editor.update((tx) => {
      tx.selection.clear()
    })
    return
  }

  const { anchorNode, focusNode } = domSelection

  const projectedSelection = resolveProjectedDOMSelection({
    domSelection,
    editor,
    editorElement,
  })

  if (projectedSelection) {
    editor.update((tx) => {
      tx.selection.set({
        anchor: projectedSelection.anchor.point,
        focus: projectedSelection.anchor.point,
      })
    })
    writeSlateViewSelection(editor, projectedSelection)
    setEditableModelSelectionPreference({
      inputController,
      preferModelSelection: true,
      reason: 'partial-dom-backed',
      selectionSource: 'model-owned',
    })
    return
  }

  if (
    activeElement !== editorElement &&
    isDOMNode(activeElement) &&
    (ReactEditor.hasDOMNode(editor, activeElement) ||
      isNestedEditableDOMTarget(editorElement, activeElement))
  ) {
    return
  }

  if (
    isNestedEditableDOMTarget(editorElement, anchorNode) ||
    isNestedEditableDOMTarget(editorElement, focusNode)
  ) {
    return
  }

  const anchorNodeSelectable = ReactEditor.hasSelectableTarget(
    editor,
    anchorNode
  )

  const focusNodeSelectable = ReactEditor.hasSelectableTarget(editor, focusNode)
  const domSelectionBelongsToEditor =
    anchorNodeSelectable && focusNodeSelectable
  const range = domSelectionBelongsToEditor
    ? ReactEditor.resolveSlateRange(editor, domSelection, {
        exactMatch: false,
      })
    : null
  const selectionChangeOrigin = state.selectionChangeOrigin ?? 'native-user'

  if (
    selectionChangeOrigin === 'native-user' &&
    state.activeIntent === 'history' &&
    isEditableModelSelectionPreferred(inputController)
  ) {
    return
  }

  if (
    state.selectionSource === 'partial-dom-backed' &&
    isEditableModelSelectionPreferred(inputController)
  ) {
    return
  }

  const shouldImportChangedExpandedSelection =
    domSelectionBelongsToEditor &&
    shouldImportChangedExpandedDOMSelection({
      currentSelection: readLiveSelection(editor),
      nextSelection: range,
      selectionChangeOrigin,
    })

  if (
    readSlateViewSelection(editor) &&
    selectionChangeOrigin !== 'native-user'
  ) {
    return
  }

  if (
    !shouldApplyDOMSelectionChange({
      changedExpandedDOMSelection: shouldImportChangedExpandedSelection,
      selectionChangeOrigin,
    })
  ) {
    return
  }

  if (
    state.isUpdatingSelection &&
    !androidInputManager?.isFlushing() &&
    !shouldImportChangedExpandedSelection
  ) {
    return
  }

  prepareEditableSelectionChangeImport({
    domSelectionCanImport: !!range,
    domSelectionBelongsToEditor,
    inputController,
    selectionChangeOrigin: shouldImportChangedExpandedSelection
      ? 'native-user'
      : selectionChangeOrigin,
  })

  if (isEditableModelSelectionPreferred(inputController)) {
    return
  }

  if (domSelectionBelongsToEditor && range) {
    writeSlateViewSelection(editor, null)
    if (
      !ReactEditor.isComposing(editor) &&
      !androidInputManager?.hasPendingChanges() &&
      !androidInputManager?.isFlushing()
    ) {
      editor.update((tx) => {
        tx.selection.set(range)
      })
    } else {
      androidInputManager?.handleUserSelect(range)
    }
  }

  // Deselect the editor if the DOM selection is not selectable in read-only mode.
  if (readOnly && (!anchorNodeSelectable || !focusNodeSelectable)) {
    setEditableModelSelectionPreference({
      inputController,
      preferModelSelection: false,
      selectionSource: 'unknown',
    })
    writeSlateViewSelection(editor, null)
    editor.update((tx) => {
      tx.selection.clear()
    })
  }
}

export const syncEditableDOMSelectionToEditor = ({
  editor,
  scrollSelectionIntoView,
  partialDOMBackedSelection,
  state,
}: {
  editor: ReactRuntimeEditor
  scrollSelectionIntoView: (
    editor: ReactRuntimeEditor,
    domRange: DOMRange
  ) => void
  partialDOMBackedSelection: boolean
  state: {
    isUpdatingSelection: boolean
    outsideFocusBoundarySettleUntil: number
    selectionChangeOrigin?: SelectionChangeOrigin | null
  }
}) => {
  const selection = readRuntimeSelection(editor)

  if (
    partialDOMBackedSelection ||
    !selection ||
    !isSelectionInEditorView(editor, selection) ||
    shouldSkipDOMSelection(editor)
  ) {
    return
  }

  if (isEditableOutsideFocusBoundarySettling(state)) {
    return
  }

  try {
    const root = ReactEditor.findDocumentOrShadowRoot(editor)
    const domSelection = getSelection(root)

    if (!domSelection) {
      return
    }

    const editorElement = ReactEditor.assertDOMNode(editor, editor)
    const activeElement = root.activeElement
    const editorHasDOMFocus =
      activeElement != null && containsShadowAware(editorElement, activeElement)

    if (
      activeElement &&
      activeElement !== editorElement.ownerDocument.body &&
      activeElement !== editorElement.ownerDocument.documentElement &&
      !editorHasDOMFocus
    ) {
      return
    }

    if (
      shouldKeepFullDocumentSelectionModelBacked({
        editor,
        editorElement,
        selection,
      })
    ) {
      return
    }

    if (
      applyDOMCoverageSelectionPolicy({
        domSelection,
        editor,
        selection,
      })
    ) {
      return
    }

    const domRange =
      createFastDOMSelectionRange({
        editor,
        editorElement,
        selection,
      }) ?? ReactEditor.resolveDOMRange(editor, selection)

    if (!domRange) {
      return
    }

    state.isUpdatingSelection = true
    state.selectionChangeOrigin = 'programmatic-export'

    try {
      if (RangeApi.isBackward(selection)) {
        domSelection.setBaseAndExtent(
          domRange.endContainer,
          domRange.endOffset,
          domRange.startContainer,
          domRange.startOffset
        )
      } else {
        domSelection.setBaseAndExtent(
          domRange.startContainer,
          domRange.startOffset,
          domRange.endContainer,
          domRange.endOffset
        )
      }

      if (!shouldSkipSelectionScroll(editor)) {
        scrollSelectionIntoView(editor, domRange)
      }
    } finally {
      setTimeout(() => {
        state.isUpdatingSelection = false
      })
    }
  } catch {
    // Leave browser selection unchanged if the DOM bridge is between commits.
  }
}
