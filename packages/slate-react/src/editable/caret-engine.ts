import type { KeyboardEvent } from 'react'
import { type Range, RangeApi } from 'slate'
import { Hotkeys } from 'slate-dom'
import { DOMCoverage } from 'slate-dom/internal'
import type { ReactRuntimeEditor } from '../plugin/react-editor'
import { writeSlateViewSelection } from '../view-selection'
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

const getBoundarySelectionIds = (
  editor: ReactRuntimeEditor,
  selection: Range | null
) =>
  new Set(
    selection
      ? DOMCoverage.getBoundariesForRange(editor, selection)
          .filter((boundary) => boundary.selectionPolicy === 'boundary')
          .map((boundary) => boundary.boundaryId)
      : []
  )

const restoreSelectionIfMovementEnteredBoundary = ({
  editor,
  preserveAnchorOnBoundarySkip,
  previousSelection,
  reverse,
}: {
  editor: ReactRuntimeEditor
  preserveAnchorOnBoundarySkip: boolean
  previousSelection: Range | null
  reverse: boolean
}) => {
  const nextSelection = editor.read((state) => state.selection.get())

  if (
    !previousSelection ||
    !nextSelection ||
    RangeApi.equals(previousSelection, nextSelection)
  ) {
    return
  }

  const previousBoundaryIds = getBoundarySelectionIds(editor, previousSelection)
  const focusedBoundary = DOMCoverage.getBoundaryForPoint(
    editor,
    nextSelection.focus
  )
  const enteredBoundary =
    focusedBoundary?.selectionPolicy === 'boundary'
      ? focusedBoundary
      : DOMCoverage.getBoundariesForRange(editor, nextSelection).find(
          (boundary) =>
            boundary.selectionPolicy === 'boundary' &&
            !previousBoundaryIds.has(boundary.boundaryId)
        )

  if (!enteredBoundary) {
    return
  }

  const skipPoint = DOMCoverage.getPointOutsideBoundary(
    editor,
    enteredBoundary,
    nextSelection.focus,
    { reverse }
  )

  editor.update((tx) => {
    tx.selection.set(
      skipPoint
        ? {
            anchor: preserveAnchorOnBoundarySkip
              ? previousSelection.anchor
              : skipPoint,
            focus: skipPoint,
          }
        : previousSelection
    )
  })
}

const moveSelectionAndRespectBoundaries = ({
  editor,
  move,
  preserveAnchorOnBoundarySkip = false,
  reverse,
  selection,
}: {
  editor: ReactRuntimeEditor
  move: Parameters<ReactRuntimeEditor['update']>[0]
  preserveAnchorOnBoundarySkip?: boolean
  reverse: boolean
  selection: Range | null
}) => {
  writeSlateViewSelection(editor, null)
  editor.update(move)
  restoreSelectionIfMovementEnteredBoundary({
    editor,
    preserveAnchorOnBoundarySkip,
    previousSelection: selection,
    reverse,
  })
}

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
    moveSelectionAndRespectBoundaries({
      editor,
      move: (tx) => {
        tx.selection.move({ unit: 'line', reverse: true })
      },
      reverse: true,
      selection,
    })
    return caretMovementHandled()
  }

  if (Hotkeys.isMoveLineForward(nativeEvent)) {
    event.preventDefault()
    moveSelectionAndRespectBoundaries({
      editor,
      move: (tx) => {
        tx.selection.move({ unit: 'line' })
      },
      reverse: false,
      selection,
    })
    return caretMovementHandled()
  }

  if (Hotkeys.isExtendLineBackward(nativeEvent)) {
    event.preventDefault()
    moveSelectionAndRespectBoundaries({
      editor,
      move: (tx) => {
        tx.selection.move({
          edge: 'focus',
          reverse: true,
          unit: 'line',
        })
      },
      preserveAnchorOnBoundarySkip: true,
      reverse: true,
      selection,
    })
    return caretMovementHandled()
  }

  if (Hotkeys.isExtendLineForward(nativeEvent)) {
    event.preventDefault()
    moveSelectionAndRespectBoundaries({
      editor,
      move: (tx) => {
        tx.selection.move({ edge: 'focus', unit: 'line' })
      },
      preserveAnchorOnBoundarySkip: true,
      reverse: false,
      selection,
    })
    return caretMovementHandled()
  }

  if (Hotkeys.isExtendBackward(nativeEvent)) {
    event.preventDefault()
    moveSelectionAndRespectBoundaries({
      editor,
      move: (tx) => {
        tx.selection.move({
          edge: 'focus',
          reverse: !isRTL,
        })
      },
      preserveAnchorOnBoundarySkip: true,
      reverse: !isRTL,
      selection,
    })
    return caretMovementHandled()
  }

  if (Hotkeys.isExtendForward(nativeEvent)) {
    event.preventDefault()
    moveSelectionAndRespectBoundaries({
      editor,
      move: (tx) => {
        tx.selection.move({
          edge: 'focus',
          reverse: isRTL,
        })
      },
      preserveAnchorOnBoundarySkip: true,
      reverse: isRTL,
      selection,
    })
    return caretMovementHandled()
  }

  if (Hotkeys.isExtendWordBackward(nativeEvent)) {
    event.preventDefault()
    moveSelectionAndRespectBoundaries({
      editor,
      move: (tx) => {
        tx.selection.move({
          edge: 'focus',
          reverse: !isRTL,
          unit: 'word',
        })
      },
      preserveAnchorOnBoundarySkip: true,
      reverse: !isRTL,
      selection,
    })
    return caretMovementHandled()
  }

  if (Hotkeys.isExtendWordForward(nativeEvent)) {
    event.preventDefault()
    moveSelectionAndRespectBoundaries({
      editor,
      move: (tx) => {
        tx.selection.move({
          edge: 'focus',
          reverse: isRTL,
          unit: 'word',
        })
      },
      preserveAnchorOnBoundarySkip: true,
      reverse: isRTL,
      selection,
    })
    return caretMovementHandled()
  }

  // COMPAT: If a void node is selected, or a zero-width text node adjacent to
  // an inline is selected, browsers can't reliably skip over the void node with
  // the zero-width space not being an empty string.
  if (Hotkeys.isMoveBackward(nativeEvent)) {
    event.preventDefault()

    moveSelectionAndRespectBoundaries({
      editor,
      move: (tx) => {
        if (selection && RangeApi.isCollapsed(selection)) {
          tx.selection.move({ reverse: !isRTL })
        } else {
          tx.selection.collapse({
            edge: isRTL ? 'end' : 'start',
          })
        }
      },
      reverse: !isRTL,
      selection,
    })

    return caretMovementHandled()
  }

  if (Hotkeys.isMoveForward(nativeEvent)) {
    event.preventDefault()

    moveSelectionAndRespectBoundaries({
      editor,
      move: (tx) => {
        if (selection && RangeApi.isCollapsed(selection)) {
          tx.selection.move({ reverse: isRTL })
        } else {
          tx.selection.collapse({
            edge: isRTL ? 'start' : 'end',
          })
        }
      },
      reverse: isRTL,
      selection,
    })

    return caretMovementHandled()
  }

  if (Hotkeys.isMoveWordBackward(nativeEvent)) {
    event.preventDefault()

    moveSelectionAndRespectBoundaries({
      editor,
      move: (tx) => {
        if (selection && RangeApi.isExpanded(selection)) {
          tx.selection.collapse({ edge: 'focus' })
        }

        tx.selection.move({
          reverse: !isRTL,
          unit: 'word',
        })
      },
      reverse: !isRTL,
      selection,
    })
    return caretMovementHandled()
  }

  if (Hotkeys.isMoveWordForward(nativeEvent)) {
    event.preventDefault()

    moveSelectionAndRespectBoundaries({
      editor,
      move: (tx) => {
        if (selection && RangeApi.isExpanded(selection)) {
          tx.selection.collapse({ edge: 'focus' })
        }

        tx.selection.move({
          reverse: isRTL,
          unit: 'word',
        })
      },
      reverse: isRTL,
      selection,
    })
    return caretMovementHandled()
  }

  return caretMovementUnhandled()
}
