import type { RefObject } from 'react'
import type { DOMElement } from 'slate-dom'

export type InputIntent =
  | 'clipboard'
  | 'composition'
  | 'delete'
  | 'format'
  | 'history'
  | 'insert-break'
  | 'internal-control'
  | 'model-selection-move'
  | 'native-selection-move'
  | 'shell-selection'
  | 'text-insert'

export type SelectionSource =
  | 'app-owned'
  | 'composition-owned'
  | 'dom-current'
  | 'internal-control'
  | 'model-owned'
  | 'shell-backed'
  | 'unknown'

export type SelectionChangeOrigin =
  | 'browser-handle'
  | 'native-user'
  | 'programmatic-export'
  | 'repair-induced'
  | 'unknown'

export type EditableSelectionSourceTransition = {
  preferModelSelection: boolean
  reason:
    | 'internal-control'
    | 'model-command'
    | 'native-selection-move'
    | 'unknown-selection'
  selectionSource: SelectionSource
}

export type EditableInputControllerState = {
  activeIntent: InputIntent | null
  isComposing: boolean
  isDraggingInternally: boolean
  isUpdatingSelection: boolean
  latestElement: DOMElement | null
  pendingDOMSelectionImport: boolean
  selectionChangeOrigin: SelectionChangeOrigin | null
  selectionSource: SelectionSource
}

export type EditableInputController = {
  preferModelSelectionForInputRef: RefObject<boolean>
  state: EditableInputControllerState
}

export const createEditableInputControllerState =
  (): EditableInputControllerState => ({
    activeIntent: null,
    isComposing: false,
    isDraggingInternally: false,
    isUpdatingSelection: false,
    latestElement: null,
    pendingDOMSelectionImport: false,
    selectionChangeOrigin: null,
    selectionSource: 'unknown',
  })

export const createEditableInputController = ({
  preferModelSelectionForInputRef,
  state,
}: EditableInputController): EditableInputController => ({
  preferModelSelectionForInputRef,
  state,
})
