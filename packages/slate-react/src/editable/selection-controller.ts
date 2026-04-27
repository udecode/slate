import type { RefObject } from 'react'
import {
  Editor,
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
} from 'slate-dom'

import type { AndroidInputManager } from '../hooks/android-input-manager/android-input-manager'
import { ReactEditor } from '../plugin/react-editor'
import type { EditableSelectionPolicy } from './editing-kernel'
import type {
  EditableInputController,
  SelectionChangeOrigin,
  SelectionSource,
} from './input-state'

export type EditableSelectionController = {
  inputController: EditableInputController
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
  const anchorNodeSelectable =
    ReactEditor.hasEditableTarget(editor, anchorNode) ||
    ReactEditor.isTargetInsideNonReadonlyVoid(editor, anchorNode)
  const focusNodeInEditor = ReactEditor.hasTarget(editor, focusNode)

  if (!anchorNodeSelectable || !focusNodeInEditor) {
    return
  }

  const range = ReactEditor.toSlateRange(editor, domSelection, {
    exactMatch: false,
    suppressThrow: true,
  })
  const selection = Editor.getLiveSelection(editor)

  if (range && (!selection || !Range.equals(selection, range))) {
    editor.update(() => {
      editor.select(range)
    })
  }
}

export const setEditableModelSelectionPreference = ({
  inputController,
  preferModelSelection,
  selectionSource,
}: {
  inputController: EditableInputController
  preferModelSelection: boolean
  selectionSource?: SelectionSource
}) => {
  // Keep the legacy input guard and the controller's selection provenance in lockstep.
  inputController.preferModelSelectionForInputRef.current = preferModelSelection
  inputController.state.selectionSource =
    selectionSource ?? (preferModelSelection ? 'model-owned' : 'dom-current')
}

export const isEditableModelSelectionPreferred = (
  inputController: EditableInputController
) => inputController.preferModelSelectionForInputRef.current

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
  inputController,
  selectionChangeOrigin,
}: {
  domSelectionBelongsToEditor: boolean
  inputController: EditableInputController
  selectionChangeOrigin: SelectionChangeOrigin
}) => {
  if (selectionChangeOrigin !== 'native-user' || !domSelectionBelongsToEditor) {
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
  const anchorNodeSelectable =
    ReactEditor.hasEditableTarget(editor, anchorNode) ||
    ReactEditor.isTargetInsideNonReadonlyVoid(editor, anchorNode)
  const focusNodeInEditor = ReactEditor.hasTarget(editor, focusNode)

  if (!anchorNodeSelectable || !focusNodeInEditor) {
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
      editor.update(() => {
        editor.deselect()
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
    editor.update(() => {
      editor.deselect()
    })
    return
  }

  const { anchorNode, focusNode } = domSelection

  const anchorNodeSelectable =
    ReactEditor.hasEditableTarget(editor, anchorNode) ||
    ReactEditor.isTargetInsideNonReadonlyVoid(editor, anchorNode)

  const focusNodeInEditor = ReactEditor.hasTarget(editor, focusNode)
  const domSelectionBelongsToEditor = anchorNodeSelectable && focusNodeInEditor
  const range = domSelectionBelongsToEditor
    ? ReactEditor.toSlateRange(editor, domSelection, {
        exactMatch: false,
        suppressThrow: true,
      })
    : null
  const selectionChangeOrigin = state.selectionChangeOrigin ?? 'native-user'
  const shouldImportChangedExpandedSelection =
    domSelectionBelongsToEditor &&
    shouldImportChangedExpandedDOMSelection({
      currentSelection: Editor.getLiveSelection(editor),
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
      editor.update(() => {
        editor.select(range)
      })
    } else {
      androidInputManager?.handleUserSelect(range)
    }
  }

  // Deselect the editor if the DOM selection is not selectable in read-only mode.
  if (readOnly && (!anchorNodeSelectable || !focusNodeInEditor)) {
    setEditableModelSelectionPreference({
      inputController,
      preferModelSelection: false,
      selectionSource: 'unknown',
    })
    editor.update(() => {
      editor.deselect()
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
  const selection = Editor.getLiveSelection(editor)

  if (shellBackedSelection || !selection) {
    return
  }

  try {
    const root = ReactEditor.findDocumentOrShadowRoot(editor)
    const domSelection = getSelection(root)
    const domRange = ReactEditor.toDOMRange(editor, selection)

    if (!domSelection) {
      return
    }

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
