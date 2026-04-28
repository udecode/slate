import getDirection from 'direction'
import type { KeyboardEvent, RefObject } from 'react'
import { Editor, Node, Range } from 'slate'
import {
  HAS_BEFORE_INPUT_SUPPORT,
  Hotkeys,
  IS_CHROME,
  IS_WEBKIT,
} from 'slate-dom'

import type { AndroidInputManager } from '../hooks/android-input-manager/android-input-manager'
import { isSelectAllHotkey } from '../large-document/large-document-commands'
import { ReactEditor } from '../plugin/react-editor'
import { applyEditableCaretMovement } from './caret-engine'
import {
  isDestructiveEditableCommand,
  markEditableEditingEpochCommandHandled,
} from './editing-epoch-kernel'
import { getEditableCommandFromKeyDown } from './editing-kernel'
import {
  type EditableCompositionStateSetter,
  type EditableRepairRequest,
  isInteractiveInternalTarget,
} from './input-controller'
import {
  applyModelOwnedHistoryIntent,
  shouldForceRenderAfterModelOwnedHistory,
} from './model-input-strategy'
import { applyEditableCommand } from './mutation-controller'
import { readRuntimeSelection } from './runtime-selection-state'

type EditableKeyboardHandler = (
  event: KeyboardEvent<HTMLDivElement>
) => boolean | void
type EditableKeyCommandHandler = (
  event: KeyboardEvent<HTMLDivElement>
) => boolean | EditableRepairRequest | void
export type EditableKeyDownResult = {
  handled: boolean
  repair?: EditableRepairRequest | null
}

const keyDownHandled = (
  repair?: EditableRepairRequest | null
): EditableKeyDownResult => ({ handled: true, repair })
const keyDownUnhandled = (): EditableKeyDownResult => ({ handled: false })

const isKeyboardEventHandled = ({
  event,
  handler,
}: {
  event: KeyboardEvent<HTMLDivElement>
  handler?: EditableKeyboardHandler
}) => {
  if (!handler) {
    return false
  }

  // The custom event handler may return a boolean to specify whether the event
  // shall be treated as being handled or not.
  const shouldTreatEventAsHandled = handler(event)

  if (shouldTreatEventAsHandled != null) {
    return shouldTreatEventAsHandled
  }

  return event.isDefaultPrevented() || event.isPropagationStopped()
}

export const applyEditableKeyDown = ({
  androidInputManagerRef,
  editor,
  event,
  forceRender,
  largeDocument,
  onKeyCommand,
  onKeyDown,
  readOnly,
  setExplicitShellBackedSelection,
  setComposing,
}: {
  androidInputManagerRef: RefObject<AndroidInputManager | null | undefined>
  editor: ReactEditor
  event: KeyboardEvent<HTMLDivElement>
  forceRender: () => void
  largeDocument: unknown
  onKeyCommand?: EditableKeyCommandHandler
  onKeyDown?: EditableKeyboardHandler
  readOnly: boolean
  setExplicitShellBackedSelection: (nextValue: boolean) => void
  setComposing: EditableCompositionStateSetter
}): EditableKeyDownResult => {
  if (isInteractiveInternalTarget(editor, event.target)) {
    event.stopPropagation()
    return keyDownHandled()
  }

  if (!readOnly && ReactEditor.hasEditableTarget(editor, event.target)) {
    androidInputManagerRef.current?.handleKeyDown(event)

    const { nativeEvent } = event

    // COMPAT: The composition end event isn't fired reliably in all browsers,
    // so we sometimes might end up stuck in a composition state even though we
    // aren't composing any more.
    if (ReactEditor.isComposing(editor) && nativeEvent.isComposing === false) {
      setComposing(false)
    }

    if (
      isKeyboardEventHandled({ event, handler: onKeyDown }) ||
      ReactEditor.isComposing(editor)
    ) {
      return keyDownHandled()
    }

    const keyCommandResult = onKeyCommand?.(event)
    if (keyCommandResult) {
      event.preventDefault()
      return keyDownHandled(
        keyCommandResult === true
          ? {
              focus: true,
              kind: 'repair-caret',
              selectionSourceTransition: {
                preferModelSelection: true,
                reason: 'model-command',
                selectionSource: 'model-owned',
              },
            }
          : keyCommandResult
      )
    }

    if (isSelectAllHotkey(nativeEvent)) {
      event.preventDefault()
      applyEditableCommand({ command: { kind: 'select-all' }, editor })
      setExplicitShellBackedSelection(Boolean(largeDocument))
      forceRender()
      return keyDownHandled()
    }

    const selection = readRuntimeSelection(editor)
    const children = Editor.getChildren(editor)
    const element = children[selection === null ? 0 : selection.focus.path[0]]
    const isRTL = getDirection(Node.string(element)) === 'rtl'

    // COMPAT: Since we prevent the default behavior on
    // `beforeinput` events, the browser doesn't think there's ever
    // any history stack to undo or redo, so we have to manage these
    // hotkeys ourselves. (2019/11/06)
    if (Hotkeys.isRedo(nativeEvent)) {
      event.preventDefault()

      if (
        applyModelOwnedHistoryIntent({
          direction: 'redo',
          editor,
        }) &&
        shouldForceRenderAfterModelOwnedHistory(editor)
      ) {
        forceRender()
      }

      return keyDownHandled()
    }

    if (Hotkeys.isUndo(nativeEvent)) {
      event.preventDefault()

      if (
        applyModelOwnedHistoryIntent({
          direction: 'undo',
          editor,
        }) &&
        shouldForceRenderAfterModelOwnedHistory(editor)
      ) {
        forceRender()
      }

      return keyDownHandled()
    }

    if (
      largeDocument &&
      selection &&
      Range.isCollapsed(selection) &&
      nativeEvent.key.length === 1 &&
      !nativeEvent.altKey &&
      !nativeEvent.ctrlKey &&
      !nativeEvent.metaKey
    ) {
      event.preventDefault()
      applyEditableCommand({
        command: {
          inputType: 'insertText',
          kind: 'insert-text',
          text: nativeEvent.key,
        },
        editor,
      })
      return keyDownHandled()
    }

    const caretMovementResult = applyEditableCaretMovement({
      editor,
      event,
      isRTL,
      selection,
    })

    if (caretMovementResult.handled) {
      return keyDownHandled(caretMovementResult.repair)
    }

    const keyDownCommand = getEditableCommandFromKeyDown({
      event,
      selection,
    })

    if (isDestructiveEditableCommand(keyDownCommand)) {
      event.preventDefault()
      applyEditableCommand({ command: keyDownCommand, editor })
      markEditableEditingEpochCommandHandled(editor, keyDownCommand)

      return keyDownHandled({
        focus: true,
        kind: 'repair-caret',
        selectionSourceTransition: {
          preferModelSelection: true,
          reason: 'model-command',
          selectionSource: 'model-owned',
        },
      })
    }

    if (keyDownCommand?.kind === 'insert-break') {
      event.preventDefault()
      applyEditableCommand({ command: keyDownCommand, editor })

      return keyDownHandled({
        focus: true,
        forceRender: true,
        kind: 'repair-caret',
        selectionSourceTransition: {
          preferModelSelection: true,
          reason: 'model-command',
          selectionSource: 'model-owned',
        },
      })
    }

    // COMPAT: Certain browsers don't support the `beforeinput` event, so we
    // fall back to guessing at the input intention for hotkeys.
    // COMPAT: In iOS, some of these hotkeys are handled in the
    if (HAS_BEFORE_INPUT_SUPPORT) {
      if (IS_CHROME || IS_WEBKIT) {
        // COMPAT: Chrome and Safari support `beforeinput` event but do not fire
        // an event when deleting backwards in a selected void inline node
        const currentNode =
          selection && Range.isCollapsed(selection)
            ? Node.parent(editor, selection.anchor.path)
            : null

        if (
          selection &&
          (Hotkeys.isDeleteBackward(nativeEvent) ||
            Hotkeys.isDeleteForward(nativeEvent)) &&
          Range.isCollapsed(selection) &&
          currentNode &&
          Node.isElement(currentNode) &&
          Editor.isVoid(editor, currentNode) &&
          (Editor.isInline(editor, currentNode) ||
            Editor.isBlock(editor, currentNode))
        ) {
          event.preventDefault()
          applyEditableCommand({
            command: { direction: 'backward', kind: 'delete', unit: 'block' },
            editor,
          })

          return keyDownHandled()
        }
      }
    } else {
      const fallbackCommand = getEditableCommandFromKeyDown({
        event,
        selection,
      })

      // We don't have a core behavior for these, but they change the
      // DOM if we don't prevent them, so we have to.
      if (
        Hotkeys.isBold(nativeEvent) ||
        Hotkeys.isItalic(nativeEvent) ||
        Hotkeys.isTransposeCharacter(nativeEvent)
      ) {
        event.preventDefault()
        return keyDownHandled()
      }

      if (Hotkeys.isSoftBreak(nativeEvent)) {
        event.preventDefault()
        if (fallbackCommand) {
          applyEditableCommand({ command: fallbackCommand, editor })
        }
        return keyDownHandled()
      }

      if (Hotkeys.isSplitBlock(nativeEvent)) {
        event.preventDefault()
        if (fallbackCommand) {
          applyEditableCommand({ command: fallbackCommand, editor })
        }
        return keyDownHandled()
      }

      if (Hotkeys.isDeleteBackward(nativeEvent)) {
        event.preventDefault()
        if (fallbackCommand) {
          applyEditableCommand({ command: fallbackCommand, editor })
        }

        return keyDownHandled()
      }

      if (Hotkeys.isDeleteForward(nativeEvent)) {
        event.preventDefault()
        if (fallbackCommand) {
          applyEditableCommand({ command: fallbackCommand, editor })
        }

        return keyDownHandled()
      }

      if (Hotkeys.isDeleteLineBackward(nativeEvent)) {
        event.preventDefault()
        if (fallbackCommand) {
          applyEditableCommand({ command: fallbackCommand, editor })
        }

        return keyDownHandled()
      }

      if (Hotkeys.isDeleteLineForward(nativeEvent)) {
        event.preventDefault()
        if (fallbackCommand) {
          applyEditableCommand({ command: fallbackCommand, editor })
        }

        return keyDownHandled()
      }

      if (Hotkeys.isDeleteWordBackward(nativeEvent)) {
        event.preventDefault()
        if (fallbackCommand) {
          applyEditableCommand({ command: fallbackCommand, editor })
        }

        return keyDownHandled()
      }

      if (Hotkeys.isDeleteWordForward(nativeEvent)) {
        event.preventDefault()
        if (fallbackCommand) {
          applyEditableCommand({ command: fallbackCommand, editor })
        }

        return keyDownHandled()
      }
    }
  }

  return keyDownUnhandled()
}
