import type {
  ClipboardEvent as ReactClipboardEvent,
  CompositionEvent as ReactCompositionEvent,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import type { Editor } from 'slate'
import { Hotkeys, IS_COMPOSING, isDOMElement, isDOMText } from 'slate-dom'

import { ReactEditor, type ReactRuntimeEditor } from '../plugin/react-editor'
import type { EditableInputController, InputIntent } from './input-state'

export type {
  EditableInputController,
  EditableInputControllerState,
  InputIntent,
  SelectionChangeOrigin,
  SelectionSource,
} from './input-state'
export {
  createEditableInputController,
  createEditableInputControllerState,
} from './input-state'
export {
  applyEditableRepairRequest,
  applyModelOwnedDataTransferInput,
  applyModelOwnedDeleteIntent,
  applyModelOwnedExpandedDelete,
  applyModelOwnedHistoryIntent,
  applyModelOwnedLineBreak,
  applyModelOwnedNativeHistoryEvent,
  applyModelOwnedTextInput,
  type EditableRepairRequest,
} from './mutation-controller'
export {
  applyEditableDOMSelectionChange,
  completeEditableSelectionChangeImport,
  type EditableSelectionController,
  executeEditableSelectionExport,
  executeEditableSelectionImport,
  isEditableModelSelectionPreferred,
  isEditableModelSelectionPreferredForInput,
  prepareEditableSelectionChangeImport,
  resolveEditableImplicitTarget,
  setEditableModelSelectionPreference,
  syncEditableDOMSelectionToEditor,
  syncEditorSelectionFromDOM,
} from './selection-controller'

export const isInteractiveInternalTarget = (
  editor: ReactRuntimeEditor,
  target: EventTarget | null
) => {
  const element = isDOMElement(target)
    ? target
    : isDOMText(target)
      ? target.parentElement
      : null

  if (!element) {
    return false
  }

  const control = element.closest(
    'input, textarea, select, button, [role="button"], [data-slate-editor="true"]'
  )

  return (
    control instanceof HTMLElement &&
    control !== ReactEditor.assertDOMNode(editor, editor) &&
    ReactEditor.hasDOMNode(editor, control) &&
    !ReactEditor.hasEditableTarget(editor, control)
  )
}

export const isNativeInternalControlTarget = (
  editor: ReactRuntimeEditor,
  target: EventTarget | null
) => {
  const element = isDOMElement(target)
    ? target
    : isDOMText(target)
      ? target.parentElement
      : null

  if (!element) {
    return false
  }

  const control = element.closest(
    'input, textarea, select, button, [role="button"]'
  )

  return (
    control instanceof HTMLElement &&
    control !== ReactEditor.assertDOMNode(editor, editor) &&
    ReactEditor.hasDOMNode(editor, control) &&
    !ReactEditor.hasEditableTarget(editor, control)
  )
}

const isPlainTextKeyboardIntent = (event: KeyboardEvent) =>
  event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey

const MODIFIER_ONLY_KEYS = new Set([
  'Alt',
  'AltGraph',
  'CapsLock',
  'Control',
  'Fn',
  'FnLock',
  'Meta',
  'NumLock',
  'ScrollLock',
  'Shift',
  'Symbol',
  'SymbolLock',
])

const isModifierOnlyKeyboardIntent = (event: KeyboardEvent) =>
  MODIFIER_ONLY_KEYS.has(event.key)

export const classifyKeyboardIntent = ({
  editor,
  event,
  isComposing = false,
  renderingStrategy,
}: {
  editor: ReactRuntimeEditor
  event: ReactKeyboardEvent<HTMLDivElement>
  isComposing?: boolean
  renderingStrategy: unknown
}): InputIntent | null => {
  const { nativeEvent } = event

  if (isComposing || nativeEvent.isComposing) {
    return 'composition'
  }

  if (Hotkeys.isUndo(nativeEvent) || Hotkeys.isRedo(nativeEvent)) {
    return 'history'
  }

  if (isInteractiveInternalTarget(editor, event.target)) {
    return 'internal-control'
  }

  if (
    Hotkeys.isSoftBreak(nativeEvent) ||
    Hotkeys.isSplitBlock(nativeEvent) ||
    Hotkeys.isOpenLine(nativeEvent)
  ) {
    return 'insert-break'
  }

  if (
    Hotkeys.isMoveLineBackward(nativeEvent) ||
    Hotkeys.isMoveLineForward(nativeEvent) ||
    Hotkeys.isExtendLineBackward(nativeEvent) ||
    Hotkeys.isExtendLineForward(nativeEvent) ||
    Hotkeys.isExtendBackward(nativeEvent) ||
    Hotkeys.isExtendForward(nativeEvent) ||
    Hotkeys.isMoveBackward(nativeEvent) ||
    Hotkeys.isMoveForward(nativeEvent) ||
    Hotkeys.isMoveWordBackward(nativeEvent) ||
    Hotkeys.isMoveWordForward(nativeEvent)
  ) {
    return 'model-selection-move'
  }

  if (
    Hotkeys.isDeleteBackward(nativeEvent) ||
    Hotkeys.isDeleteForward(nativeEvent) ||
    Hotkeys.isDeleteLineBackward(nativeEvent) ||
    Hotkeys.isDeleteLineForward(nativeEvent) ||
    Hotkeys.isDeleteWordBackward(nativeEvent) ||
    Hotkeys.isDeleteWordForward(nativeEvent)
  ) {
    return 'delete'
  }

  if (Hotkeys.isBold(nativeEvent) || Hotkeys.isItalic(nativeEvent)) {
    return 'format'
  }

  if (isPlainTextKeyboardIntent(nativeEvent)) {
    return 'text-insert'
  }

  if (isModifierOnlyKeyboardIntent(nativeEvent)) {
    return null
  }

  return 'native-selection-move'
}

export const classifyBeforeInputIntent = ({
  editor,
  event,
  internalTarget = isInteractiveInternalTarget(editor, event.target),
}: {
  editor: ReactRuntimeEditor
  event: InputEvent
  internalTarget?: boolean
}): InputIntent | null => {
  const { inputType } = event

  if (inputType === 'historyUndo' || inputType === 'historyRedo') {
    return 'history'
  }

  if (internalTarget) {
    return 'internal-control'
  }

  if (inputType.startsWith('format')) {
    return 'format'
  }

  if (inputType.includes('Composition')) {
    return 'composition'
  }

  if (inputType.includes('Paste') || inputType.includes('Drop')) {
    return 'clipboard'
  }

  if (inputType.startsWith('delete')) {
    return 'delete'
  }

  if (inputType === 'insertLineBreak' || inputType === 'insertParagraph') {
    return 'insert-break'
  }

  if (inputType.startsWith('insert')) {
    return 'text-insert'
  }

  return null
}

export const classifyClipboardIntent = ({
  editor,
  event,
}: {
  editor: ReactRuntimeEditor
  event: ReactClipboardEvent<HTMLDivElement> | ReactDragEvent<HTMLDivElement>
}): InputIntent => {
  if (isInteractiveInternalTarget(editor, event.target)) {
    return 'internal-control'
  }

  return 'clipboard'
}

export const classifyCompositionIntent = ({
  editor,
  event,
}: {
  editor: ReactRuntimeEditor
  event: ReactCompositionEvent<HTMLDivElement>
}): InputIntent => {
  if (isInteractiveInternalTarget(editor, event.target)) {
    return 'internal-control'
  }

  return 'composition'
}

export type EditableCompositionStateSetter = (nextValue: boolean) => void

export const setEditableComposingState = ({
  editor,
  inputController,
  nextValue,
  setIsComposing,
}: {
  editor: ReactRuntimeEditor | Editor
  inputController: EditableInputController
  nextValue: boolean
  setIsComposing: (nextValue: boolean) => void
}) => {
  inputController.state.isComposing = nextValue
  if (nextValue) {
    inputController.state.selectionSource = 'composition-owned'
  } else if (inputController.state.selectionSource === 'composition-owned') {
    inputController.state.selectionSource = 'unknown'
  }
  setIsComposing(nextValue)
  IS_COMPOSING.set(editor, nextValue)
}
