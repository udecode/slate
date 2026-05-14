import getDirection from 'direction'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import { NodeApi, RangeApi } from 'slate'
import {
  HAS_BEFORE_INPUT_SUPPORT,
  Hotkeys,
  IS_CHROME,
  IS_IOS,
  IS_WEBKIT,
} from 'slate-dom'
import type {
  EditableCommandHandler,
  EditableKeyDownHandler,
} from '../components/editable'
import type { AndroidInputManager } from '../hooks/android-input-manager/android-input-manager'
import { ReactEditor } from '../plugin/react-editor'
import { isSelectAllHotkey } from '../rendering-strategy/rendering-strategy-commands'
import { applyEditableCaretMovement } from './caret-engine'
import {
  isDestructiveEditableCommand,
  markEditableEditingEpochCommandHandled,
} from './editing-epoch-kernel'
import { getEditableCommandFromKeyDown } from './editing-kernel'
import {
  type EditableCompositionStateSetter,
  type EditableInputController,
  type EditableRepairRequest,
  isInteractiveInternalTarget,
  setEditableModelSelectionPreference,
} from './input-controller'
import {
  applyModelOwnedHistoryIntent,
  shouldForceRenderAfterModelOwnedHistory,
} from './model-input-strategy'
import { applyEditableCommand } from './mutation-controller'
import { Editor } from './runtime-editor-api'
import { readRuntimeSelection } from './runtime-selection-state'

export type EditableKeyDownResult = {
  handled: boolean
  repair?: EditableRepairRequest | null
}

const keyDownHandled = (
  repair?: EditableRepairRequest | null
): EditableKeyDownResult => ({ handled: true, repair })
const keyDownUnhandled = (): EditableKeyDownResult => ({ handled: false })

const DEFAULT_MODEL_COMMAND_REPAIR: EditableRepairRequest = {
  focus: true,
  kind: 'repair-caret',
  selectionSourceTransition: {
    preferModelSelection: true,
    reason: 'model-command',
    selectionSource: 'model-owned',
  },
}

const getModelOwnedHistoryRepair = (
  editor: ReactEditor
): EditableRepairRequest => ({
  focus: true,
  forceRender: shouldForceRenderAfterModelOwnedHistory(editor),
  kind: 'repair-caret',
  selectionSourceTransition: {
    preferModelSelection: true,
    reason: 'model-command',
    selectionSource: 'model-owned',
  },
})

const isShellRenderingStrategy = (renderingStrategy: unknown) =>
  typeof renderingStrategy === 'object' &&
  renderingStrategy !== null &&
  ((renderingStrategy as { type?: unknown }).type === 'shell' ||
    (renderingStrategy as { type?: unknown }).type === 'virtualized')

export const shouldDeferBackspaceToNativeInput = ({
  isIOS = IS_IOS,
  language = typeof navigator === 'undefined' ? '' : navigator.language,
  nativeEvent,
}: {
  isIOS?: boolean
  language?: string
  nativeEvent: KeyboardEvent
}) => isIOS && language === 'ko-KR' && Hotkeys.isDeleteBackward(nativeEvent)

const applyUserKeyDownHandler = ({
  editor,
  event,
  handler,
}: {
  editor: ReactEditor
  event: ReactKeyboardEvent<HTMLDivElement>
  handler?: EditableKeyDownHandler
}): EditableKeyDownResult => {
  if (!handler) {
    return keyDownUnhandled()
  }

  // The custom event handler may return a boolean to specify whether the event
  // shall be treated as being handled or not.
  const shouldTreatEventAsHandled = handler(event, { editor })

  if (shouldTreatEventAsHandled != null) {
    if (!shouldTreatEventAsHandled) {
      return keyDownUnhandled()
    }

    event.preventDefault()

    return keyDownHandled(
      shouldTreatEventAsHandled === true
        ? DEFAULT_MODEL_COMMAND_REPAIR
        : shouldTreatEventAsHandled
    )
  }

  return event.isDefaultPrevented() || event.isPropagationStopped()
    ? keyDownHandled()
    : keyDownUnhandled()
}

const applyUserEditableCommandHandler = ({
  command,
  editor,
  event,
  handler,
  selection,
}: {
  command: NonNullable<ReturnType<typeof getEditableCommandFromKeyDown>>
  editor: ReactEditor
  event: ReactKeyboardEvent<HTMLDivElement>
  handler?: EditableCommandHandler
  selection: ReturnType<typeof readRuntimeSelection>
}): EditableKeyDownResult => {
  if (!handler) {
    return keyDownUnhandled()
  }

  const result = handler(command, {
    data: undefined,
    editor,
    event,
    intent: command.kind === 'format' ? 'format' : null,
    native: false,
    selection,
  })

  if (result != null) {
    if (!result) {
      return keyDownUnhandled()
    }

    event.preventDefault()

    return keyDownHandled(
      result === true ? DEFAULT_MODEL_COMMAND_REPAIR : result
    )
  }

  return event.isDefaultPrevented() || event.isPropagationStopped()
    ? keyDownHandled()
    : keyDownUnhandled()
}

export const applyEditableKeyDown = ({
  androidInputManagerRef,
  editor,
  event,
  forceRender,
  inputController,
  renderingStrategy,
  onCommand,
  onKeyDown,
  readOnly,
  setExplicitShellBackedSelection,
  setComposing,
  shellBackedSelection,
}: {
  androidInputManagerRef: RefObject<AndroidInputManager | null | undefined>
  editor: ReactEditor
  event: ReactKeyboardEvent<HTMLDivElement>
  forceRender: () => void
  inputController: EditableInputController
  renderingStrategy: unknown
  onCommand?: EditableCommandHandler
  onKeyDown?: EditableKeyDownHandler
  readOnly: boolean
  setExplicitShellBackedSelection: (nextValue: boolean) => void
  setComposing: EditableCompositionStateSetter
  shellBackedSelection: boolean
}): EditableKeyDownResult => {
  if (isInteractiveInternalTarget(editor, event.target)) {
    const { nativeEvent } = event

    if (!readOnly && Hotkeys.isRedo(nativeEvent)) {
      event.preventDefault()
      event.stopPropagation()

      if (
        applyModelOwnedHistoryIntent({
          direction: 'redo',
          editor,
        })
      ) {
        return keyDownHandled(getModelOwnedHistoryRepair(editor))
      }

      return keyDownHandled()
    }

    if (!readOnly && Hotkeys.isUndo(nativeEvent)) {
      event.preventDefault()
      event.stopPropagation()

      if (
        applyModelOwnedHistoryIntent({
          direction: 'undo',
          editor,
        })
      ) {
        return keyDownHandled(getModelOwnedHistoryRepair(editor))
      }

      return keyDownHandled()
    }

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

    const userKeyDownResult = applyUserKeyDownHandler({
      editor,
      event,
      handler: onKeyDown,
    })
    if (userKeyDownResult.handled) {
      return userKeyDownResult
    }

    if (ReactEditor.isComposing(editor)) {
      return keyDownHandled()
    }

    if (isSelectAllHotkey(nativeEvent)) {
      event.preventDefault()
      applyEditableCommand({ command: { kind: 'select-all' }, editor })
      const shellRenderingStrategy = isShellRenderingStrategy(renderingStrategy)
      if (shellRenderingStrategy) {
        setEditableModelSelectionPreference({
          inputController,
          preferModelSelection: true,
          selectionSource: 'shell-backed',
        })
      }
      setExplicitShellBackedSelection(shellRenderingStrategy)
      forceRender()
      return keyDownHandled()
    }

    const selection = readRuntimeSelection(editor)
    const children = editor.read((state) => state.value.get())
    const element = children[selection === null ? 0 : selection.focus.path[0]]
    const isRTL = getDirection(NodeApi.string(element)) === 'rtl'

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
        })
      ) {
        return keyDownHandled(getModelOwnedHistoryRepair(editor))
      }

      return keyDownHandled()
    }

    if (Hotkeys.isUndo(nativeEvent)) {
      event.preventDefault()

      if (
        applyModelOwnedHistoryIntent({
          direction: 'undo',
          editor,
        })
      ) {
        return keyDownHandled(getModelOwnedHistoryRepair(editor))
      }

      return keyDownHandled()
    }

    if (
      isShellRenderingStrategy(renderingStrategy) &&
      shellBackedSelection &&
      selection &&
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

    if (keyDownCommand?.kind === 'format') {
      const editableCommandResult = applyUserEditableCommandHandler({
        command: keyDownCommand,
        editor,
        event,
        handler: onCommand,
        selection,
      })

      if (editableCommandResult.handled) {
        return editableCommandResult
      }
    }

    if (
      keyDownCommand?.kind === 'delete' &&
      keyDownCommand.direction === 'backward' &&
      shouldDeferBackspaceToNativeInput({ nativeEvent })
    ) {
      return keyDownUnhandled()
    }

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
          selection && RangeApi.isCollapsed(selection)
            ? NodeApi.parent(editor, selection.anchor.path)
            : null

        if (
          selection &&
          (Hotkeys.isDeleteBackward(nativeEvent) ||
            Hotkeys.isDeleteForward(nativeEvent)) &&
          RangeApi.isCollapsed(selection) &&
          currentNode &&
          NodeApi.isElement(currentNode) &&
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
      if (Hotkeys.isBold(nativeEvent) || Hotkeys.isItalic(nativeEvent)) {
        event.preventDefault()
        return keyDownHandled()
      }

      if (Hotkeys.isTransposeCharacter(nativeEvent)) {
        event.preventDefault()
        applyEditableCommand({
          command: { kind: 'transpose-character' },
          editor,
        })
        return keyDownHandled(DEFAULT_MODEL_COMMAND_REPAIR)
      }

      if (Hotkeys.isSoftBreak(nativeEvent)) {
        event.preventDefault()
        if (fallbackCommand) {
          applyEditableCommand({ command: fallbackCommand, editor })
        }
        return keyDownHandled()
      }

      if (
        Hotkeys.isSplitBlock(nativeEvent) ||
        Hotkeys.isOpenLine(nativeEvent)
      ) {
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
