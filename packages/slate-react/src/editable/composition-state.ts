import { type CompositionEvent, type RefObject, useEffect } from 'react'
import {
  Editor,
  type EditorMarks,
  Node,
  Range,
  setCurrentMarks,
  Text,
} from 'slate'
import {
  EDITOR_TO_PENDING_INSERTION_MARKS,
  EDITOR_TO_USER_MARKS,
  IS_ANDROID,
  IS_FIREFOX_LEGACY,
  IS_IOS,
  IS_UC_MOBILE,
  IS_WEBKIT,
  IS_WECHATBROWSER,
  isDOMNode,
} from 'slate-dom'

import type { AndroidInputManager } from '../hooks/android-input-manager/android-input-manager'
import { ReactEditor } from '../plugin/react-editor'
import type { EditableCompositionStateSetter } from './input-controller'

type EditableCompositionHandler = (
  event: CompositionEvent<HTMLDivElement>
) => boolean | void

const isCompositionEventTargetInput = ({
  event,
}: {
  event: CompositionEvent<HTMLDivElement>
}) => {
  return (
    isDOMNode(event.target) &&
    (event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement)
  )
}

const isCompositionEventHandled = ({
  event,
  handler,
}: {
  event: CompositionEvent<HTMLDivElement>
  handler?: EditableCompositionHandler
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

export const commitInsertFromComposition = ({
  setComposing,
}: {
  setComposing: EditableCompositionStateSetter
}) => {
  // COMPAT: in Safari, `compositionend` is dispatched after the
  // `beforeinput` for "insertFromComposition". But if we wait for it
  // then we will abort because we're still composing and the selection
  // won't be updated properly.
  // https://www.w3.org/TR/input-events-2/
  setComposing(false)
}

export const commitChromeCompositionEndFallback = ({
  editor,
  text,
}: {
  editor: Editor
  text: string | null | undefined
}) => {
  // COMPAT: In Chrome, `beforeinput` events for compositions
  // aren't correct and never fire the "insertFromComposition"
  // type that we need. So instead, insert whenever a composition
  // ends since it will already have been committed to the DOM.
  if (
    IS_WEBKIT ||
    IS_FIREFOX_LEGACY ||
    IS_IOS ||
    IS_WECHATBROWSER ||
    IS_UC_MOBILE ||
    !text
  ) {
    return
  }

  const placeholderMarks = EDITOR_TO_PENDING_INSERTION_MARKS.get(editor)
  EDITOR_TO_PENDING_INSERTION_MARKS.delete(editor)

  // Ensure we insert text with the marks the user was actually seeing
  if (placeholderMarks !== undefined) {
    EDITOR_TO_USER_MARKS.set(editor, editor.getMarks())
    setCurrentMarks(editor, placeholderMarks)
  }

  editor.update(() => {
    Editor.insertText(editor, text)
  })

  const userMarks = EDITOR_TO_USER_MARKS.get(editor)
  EDITOR_TO_USER_MARKS.delete(editor)
  if (userMarks !== undefined) {
    setCurrentMarks(editor, userMarks)
  }
}

export const applyEditableCompositionEnd = ({
  androidInputManagerRef,
  editor,
  event,
  onCompositionEnd,
  setComposing,
}: {
  androidInputManagerRef: RefObject<AndroidInputManager | null | undefined>
  editor: ReactEditor
  event: CompositionEvent<HTMLDivElement>
  onCompositionEnd?: EditableCompositionHandler
  setComposing: EditableCompositionStateSetter
}) => {
  if (isCompositionEventTargetInput({ event })) {
    return
  }
  if (ReactEditor.hasSelectableTarget(editor, event.target)) {
    if (ReactEditor.isComposing(editor)) {
      Promise.resolve().then(() => {
        setComposing(false)
      })
    }

    androidInputManagerRef.current?.handleCompositionEnd(event)

    if (
      isCompositionEventHandled({ event, handler: onCompositionEnd }) ||
      IS_ANDROID
    ) {
      return
    }

    commitChromeCompositionEndFallback({
      editor,
      text: event.data,
    })
  }
}

export const applyEditableCompositionStart = ({
  androidInputManagerRef,
  editor,
  event,
  onCompositionStart,
  setComposing,
}: {
  androidInputManagerRef: RefObject<AndroidInputManager | null | undefined>
  editor: ReactEditor
  event: CompositionEvent<HTMLDivElement>
  onCompositionStart?: EditableCompositionHandler
  setComposing: EditableCompositionStateSetter
}) => {
  if (isCompositionEventTargetInput({ event })) {
    return
  }
  if (ReactEditor.hasSelectableTarget(editor, event.target)) {
    androidInputManagerRef.current?.handleCompositionStart(event)

    if (
      isCompositionEventHandled({ event, handler: onCompositionStart }) ||
      IS_ANDROID
    ) {
      return
    }

    setComposing(true)

    const selection = editor.getSelection()
    if (selection && Range.isExpanded(selection)) {
      editor.update(() => {
        Editor.deleteFragment(editor)
      })
      return
    }
  }
}

export const applyEditableCompositionUpdate = ({
  editor,
  event,
  onCompositionUpdate,
  setComposing,
}: {
  editor: ReactEditor
  event: CompositionEvent<HTMLDivElement>
  onCompositionUpdate?: EditableCompositionHandler
  setComposing: EditableCompositionStateSetter
}) => {
  if (
    ReactEditor.hasSelectableTarget(editor, event.target) &&
    !isCompositionEventHandled({ event, handler: onCompositionUpdate }) &&
    !isCompositionEventTargetInput({ event }) &&
    !ReactEditor.isComposing(editor)
  ) {
    setComposing(true)
  }
}

export const usePendingInsertionMarksEffect = ({
  editor,
  marks,
}: {
  editor: Editor
  marks: EditorMarks | null
}) => {
  // Update EDITOR_TO_MARK_PLACEHOLDER_MARKS in setTimeout useEffect to ensure we don't set it
  // before we receive the composition end event.
  useEffect(() => {
    setTimeout(() => {
      const selection = editor.getSelection()
      if (selection) {
        const { anchor } = selection
        const text = Node.leaf(editor, anchor.path)

        // While marks isn't a 'complete' text, we can still use loose Text.equals
        // here which only compares marks anyway.
        if (marks && !Text.equals(text, marks as Text, { loose: true })) {
          EDITOR_TO_PENDING_INSERTION_MARKS.set(editor, marks)
          return
        }
      }

      EDITOR_TO_PENDING_INSERTION_MARKS.delete(editor)
    })
  })
}
