import type { RefObject } from 'react'
import {
  Point,
  Range,
  type Selection,
  type TargetFreshnessRequest,
} from 'slate'
import {
  type DOMRange,
  getActiveElement,
  getSelection,
  IS_ANDROID,
  IS_FOCUSED,
  IS_NODE_MAP_DIRTY,
  IS_WEBKIT,
  isDOMNode,
  isDOMText,
} from 'slate-dom'
import { DOMCoverage } from 'slate-dom/internal'
import type { AndroidInputManager } from '../hooks/android-input-manager/android-input-manager'
import { getSlateNodeElementByPath } from '../hooks/use-slate-node-ref'
import { ReactEditor } from '../plugin/react-editor'
import type { EditableSelectionPolicy } from './editing-kernel'
import type {
  EditableInputController,
  ModelSelectionPreferenceReason,
  SelectionChangeOrigin,
  SelectionSource,
} from './input-state'
import {
  readLiveSelection,
  readRuntimeSelection,
} from './runtime-selection-state'

export type EditableSelectionController = {
  inputController: EditableInputController
}

const MODEL_BACKED_FULL_DOCUMENT_CHILD_THRESHOLD = 1000

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
  editor: ReactEditor,
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

const isFullDocumentSelection = (editor: ReactEditor, selection: Range) => {
  try {
    const [start, end] = Range.edges(selection)
    const [documentStart, documentEnd] = editor.read((state) => [
      state.points.start([]),
      state.points.end([]),
    ])

    return Point.equals(start, documentStart) && Point.equals(end, documentEnd)
  } catch {
    return false
  }
}

const shouldKeepFullDocumentSelectionModelBacked = ({
  editor,
  editorElement,
  selection,
}: {
  editor: ReactEditor
  editorElement: HTMLElement
  selection: Range
}) => {
  const rootChildCount = editor.read((state) => state.value.get().length)

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
  editor: ReactEditor
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

  const [start, end] = Range.edges(selection)

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

const materializeOrModelBackDOMCoverageSelection = ({
  domSelection,
  editor,
  selection,
}: {
  domSelection: globalThis.Selection
  editor: ReactEditor
  selection: Range
}) => {
  const boundaries = DOMCoverage.getBoundariesForRange(editor, selection)

  if (boundaries.length === 0) {
    return false
  }

  for (const boundary of boundaries) {
    if (boundary.selectionPolicy === 'materialize') {
      DOMCoverage.materializeBoundary(
        editor,
        boundary.boundaryId,
        'selection',
        {
          range: selection,
        }
      )
    }
  }

  domSelection.removeAllRanges()
  return true
}

export const syncEditorSelectionFromDOM = ({
  editor,
  ignoreModelSelectionPreference = false,
  inputController,
}: {
  editor: ReactEditor
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
  const anchorNodeSelectable = ReactEditor.hasSelectableTarget(
    editor,
    anchorNode
  )
  const focusNodeSelectable = ReactEditor.hasSelectableTarget(editor, focusNode)

  if (!anchorNodeSelectable || !focusNodeSelectable) {
    return
  }

  const range = ReactEditor.toSlateRange(editor, domSelection, {
    exactMatch: false,
    suppressThrow: true,
  })
  const selection = readRuntimeSelection(editor)

  if (range && (!selection || !Range.equals(selection, range))) {
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
    case 'shell-backed':
      return 'shell-backed'
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
    preference.reason === 'shell-backed'
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
    !Range.isExpanded(nextSelection)
  ) {
    return false
  }

  return !currentSelection || !Range.equals(currentSelection, nextSelection)
}

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
  editor: ReactEditor
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
    ReactEditor.toSlateRange(editor, domSelection, {
      exactMatch: false,
      suppressThrow: true,
    }) ?? request.fallback

  if (
    preferModelSelection &&
    (!Range.isRange(target) || !Range.isExpanded(target))
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
  editor: ReactEditor
  inputController: EditableInputController
  processing: RefObject<boolean>
  readOnly: boolean
  rerunOnDirtyNodeMap: () => void
}) => {
  if (IS_NODE_MAP_DIRTY.get(editor)) {
    rerunOnDirtyNodeMap()
    return
  }

  const editorElement = ReactEditor.toDOMNode(editor, editor)
  const editorRoot = editorElement.getRootNode()

  if (!processing.current && IS_WEBKIT && editorRoot instanceof ShadowRoot) {
    processing.current = true

    const active = getActiveElement()

    if (active) {
      document.execCommand('indent')
    } else {
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
    state.isDraggingInternally
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

  if (
    activeElement !== editorElement &&
    isDOMNode(activeElement) &&
    ReactEditor.hasDOMNode(editor, activeElement)
  ) {
    return
  }

  if (!domSelection) {
    setEditableModelSelectionPreference({
      inputController,
      preferModelSelection: false,
      selectionSource: 'unknown',
    })
    editor.update((tx) => {
      tx.selection.clear()
    })
    return
  }

  const { anchorNode, focusNode } = domSelection

  const anchorNodeSelectable = ReactEditor.hasSelectableTarget(
    editor,
    anchorNode
  )

  const focusNodeSelectable = ReactEditor.hasSelectableTarget(editor, focusNode)
  const domSelectionBelongsToEditor =
    anchorNodeSelectable && focusNodeSelectable
  const range = domSelectionBelongsToEditor
    ? ReactEditor.toSlateRange(editor, domSelection, {
        exactMatch: false,
        suppressThrow: true,
      })
    : null
  const selectionChangeOrigin = state.selectionChangeOrigin ?? 'native-user'

  if (
    state.selectionSource === 'shell-backed' &&
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
    editor.update((tx) => {
      tx.selection.clear()
    })
  }
}

export const syncEditableDOMSelectionToEditor = ({
  editor,
  scrollSelectionIntoView,
  shellBackedSelection,
  state,
}: {
  editor: ReactEditor
  scrollSelectionIntoView: (editor: ReactEditor, domRange: DOMRange) => void
  shellBackedSelection: boolean
  state: {
    isUpdatingSelection: boolean
    selectionChangeOrigin?: SelectionChangeOrigin | null
  }
}) => {
  const selection = readRuntimeSelection(editor)

  if (shellBackedSelection || !selection) {
    return
  }

  try {
    const root = ReactEditor.findDocumentOrShadowRoot(editor)
    const domSelection = getSelection(root)

    if (!domSelection) {
      return
    }

    const editorElement = ReactEditor.toDOMNode(editor, editor)

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
      materializeOrModelBackDOMCoverageSelection({
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
      }) ?? ReactEditor.toDOMRange(editor, selection)

    state.isUpdatingSelection = true
    state.selectionChangeOrigin = 'programmatic-export'

    if (Range.isBackward(selection)) {
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

    scrollSelectionIntoView(editor, domRange)
    setTimeout(() => {
      state.isUpdatingSelection = false
    })
  } catch {
    // Leave browser selection unchanged if the DOM bridge is between commits.
  }
}
