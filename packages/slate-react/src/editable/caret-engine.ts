import type { KeyboardEvent } from 'react'
import { type Range, RangeApi } from 'slate'
import { Hotkeys } from 'slate-dom'
import type { ReactRuntimeEditor } from '../plugin/react-editor'
import type { EditableRepairRequest } from './mutation-controller'

export type EditableCaretMovementResult = {
  handled: boolean
  repair?: EditableRepairRequest | null
}

const selectionSyncRepair = (): EditableRepairRequest => ({
  kind: 'sync-selection',
  selectionSourceTransition: {
    preferModelSelection: true,
    reason: 'model-command',
    selectionSource: 'model-owned',
  },
})

const caretMovementHandled = (): EditableCaretMovementResult => {
  return { handled: true, repair: selectionSyncRepair() }
}

const caretMovementUnhandled = (): EditableCaretMovementResult => ({
  handled: false,
})

export const applyEditableCaretMovement = ({
  editor,
  event,
  isRTL,
  selection,
}: {
  editor: ReactRuntimeEditor
  event: KeyboardEvent<HTMLDivElement>
  isRTL: boolean
  selection: Range | null
}): EditableCaretMovementResult => {
  const { nativeEvent } = event

  // COMPAT: Certain browsers don't handle the selection updates properly.
  // In Chrome, the selection isn't properly extended. In Firefox, the
  // selection isn't properly collapsed. (2017/10/17)
  if (Hotkeys.isMoveLineBackward(nativeEvent)) {
    event.preventDefault()
    editor.update((tx) => {
      tx.selection.move({ unit: 'line', reverse: true })
    })
    return caretMovementHandled()
  }

  if (Hotkeys.isMoveLineForward(nativeEvent)) {
    event.preventDefault()
    editor.update((tx) => {
      tx.selection.move({ unit: 'line' })
    })
    return caretMovementHandled()
  }

  if (Hotkeys.isExtendLineBackward(nativeEvent)) {
    event.preventDefault()
    editor.update((tx) => {
      tx.selection.move({
        unit: 'line',
        edge: 'focus',
        reverse: true,
      })
    })
    return caretMovementHandled()
  }

  if (Hotkeys.isExtendLineForward(nativeEvent)) {
    event.preventDefault()
    editor.update((tx) => {
      tx.selection.move({ unit: 'line', edge: 'focus' })
    })
    return caretMovementHandled()
  }

  if (Hotkeys.isExtendBackward(nativeEvent)) {
    event.preventDefault()
    editor.update((tx) => {
      tx.selection.move({
        edge: 'focus',
        reverse: !isRTL,
      })
    })
    return caretMovementHandled()
  }

  if (Hotkeys.isExtendForward(nativeEvent)) {
    event.preventDefault()
    editor.update((tx) => {
      tx.selection.move({
        edge: 'focus',
        reverse: isRTL,
      })
    })
    return caretMovementHandled()
  }

  // COMPAT: If a void node is selected, or a zero-width text node adjacent to
  // an inline is selected, browsers can't reliably skip over the void node with
  // the zero-width space not being an empty string.
  if (Hotkeys.isMoveBackward(nativeEvent)) {
    event.preventDefault()

    editor.update((tx) => {
      if (selection && RangeApi.isCollapsed(selection)) {
        tx.selection.move({ reverse: !isRTL })
      } else {
        tx.selection.collapse({
          edge: isRTL ? 'end' : 'start',
        })
      }
    })

    return caretMovementHandled()
  }

  if (Hotkeys.isMoveForward(nativeEvent)) {
    event.preventDefault()

    editor.update((tx) => {
      if (selection && RangeApi.isCollapsed(selection)) {
        tx.selection.move({ reverse: isRTL })
      } else {
        tx.selection.collapse({
          edge: isRTL ? 'start' : 'end',
        })
      }
    })

    return caretMovementHandled()
  }

  if (Hotkeys.isMoveWordBackward(nativeEvent)) {
    event.preventDefault()

    editor.update((tx) => {
      if (selection && RangeApi.isExpanded(selection)) {
        tx.selection.collapse({ edge: 'focus' })
      }

      tx.selection.move({
        unit: 'word',
        reverse: !isRTL,
      })
    })
    return caretMovementHandled()
  }

  if (Hotkeys.isMoveWordForward(nativeEvent)) {
    event.preventDefault()

    editor.update((tx) => {
      if (selection && RangeApi.isExpanded(selection)) {
        tx.selection.collapse({ edge: 'focus' })
      }

      tx.selection.move({
        unit: 'word',
        reverse: isRTL,
      })
    })
    return caretMovementHandled()
  }

  return caretMovementUnhandled()
}
