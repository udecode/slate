import { type CompositionEvent, type RefObject, useEffect } from 'react'
import { type EditorMarks, Node, Range, Text } from 'slate'
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
import { getNativeTextInputHistoryMetadata } from './input-history'
import type { EditableInputController } from './input-state'
import type { Editor } from './runtime-editor-api'
import { writeRuntimeMarks } from './runtime-mutation-state'

type EditableCompositionHandler = (
  event: CompositionEvent<HTMLDivElement>
) => boolean | void

const EDITOR_TO_PENDING_COMPOSITION_TEXT = new WeakMap<Editor, string>()
const EDITOR_TO_COMPOSITION_PREDELETE = new WeakSet<Editor>()

const getCompositionEventText = (event: CompositionEvent<HTMLDivElement>) =>
  event.data || (event.nativeEvent as globalThis.CompositionEvent).data

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
  mergeWithCompositionPredelete = false,
  rootElement,
  shouldCommit = true,
  text,
}: {
  editor: Editor
  mergeWithCompositionPredelete?: boolean
  rootElement?: HTMLElement | null
  shouldCommit?: boolean
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

  if (!shouldCommit) {
    removeUnmanagedCompositionTextNodes({ editor, rootElement, text })
    EDITOR_TO_USER_MARKS.delete(editor)
    return
  }

  // Ensure we insert text with the marks the user was actually seeing
  if (placeholderMarks !== undefined) {
    EDITOR_TO_USER_MARKS.set(
      editor,
      editor.read((state) => state.marks.get())
    )
    writeRuntimeMarks(editor, placeholderMarks)
  }

  editor.update(
    (tx) => {
      tx.text.insert(text)
    },
    mergeWithCompositionPredelete
      ? { metadata: { history: { mode: 'merge' } } }
      : { metadata: getNativeTextInputHistoryMetadata(editor) }
  )
  removeUnmanagedCompositionTextNodes({ editor, rootElement, text })

  const userMarks = EDITOR_TO_USER_MARKS.get(editor)
  EDITOR_TO_USER_MARKS.delete(editor)
  if (userMarks !== undefined) {
    writeRuntimeMarks(editor, userMarks)
  }
}

const removeUnmanagedCompositionTextNodes = ({
  editor,
  rootElement,
  text,
}: {
  editor: Editor
  rootElement?: HTMLElement | null
  text: string
}) => {
  if (!rootElement || text.length === 0) {
    return
  }

  rootElement
    .querySelectorAll<HTMLElement>('[data-slate-node="text"]')
    .forEach((textElement) => {
      const textNodes: globalThis.Text[] = []
      const walker = textElement.ownerDocument.createTreeWalker(
        textElement,
        NodeFilter.SHOW_TEXT
      )

      for (
        let current = walker.nextNode();
        current;
        current = walker.nextNode()
      ) {
        const textNode = current as globalThis.Text
        const textContent = textNode.textContent ?? ''
        const slateString = textNode.parentElement?.closest(
          '[data-slate-string="true"]'
        )

        if (slateString && textContent.includes(text)) {
          const path = textElement
            .getAttribute('data-slate-path')
            ?.split(',')
            .map((segment) => Number.parseInt(segment, 10))

          if (path?.every(Number.isInteger)) {
            try {
              const modelText = Node.leaf(editor, path).text

              if (
                textContent !== modelText &&
                textContent.endsWith(text) &&
                textContent.slice(0, -text.length) === modelText
              ) {
                textNode.textContent = modelText
                continue
              }

              if (
                textContent !== modelText &&
                textContent.startsWith(text) &&
                textContent.slice(text.length) === modelText
              ) {
                textNode.textContent = modelText
                continue
              }
            } catch {
              // The host may have been removed by the same composition commit.
            }
          }
        }

        if (
          textContent === text &&
          !textNode.parentElement?.closest('[data-slate-string="true"]')
        ) {
          textNodes.push(textNode)
        }
      }

      textNodes.forEach((textNode) => {
        textNode.parentNode?.removeChild(textNode)
      })
    })
}

export const applyEditableCompositionEnd = ({
  androidInputManagerRef,
  editor,
  event,
  inputController,
  onCompositionEnd,
  setComposing,
}: {
  androidInputManagerRef: RefObject<AndroidInputManager | null | undefined>
  editor: ReactEditor
  event: CompositionEvent<HTMLDivElement>
  inputController: EditableInputController
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

    const shouldCommitChromeFallback =
      ReactEditor.isComposing(editor) &&
      inputController.state.selectionSource !== 'model-owned'
    const compositionText =
      getCompositionEventText(event) ??
      EDITOR_TO_PENDING_COMPOSITION_TEXT.get(editor)
    EDITOR_TO_PENDING_COMPOSITION_TEXT.delete(editor)
    const mergeWithCompositionPredelete =
      EDITOR_TO_COMPOSITION_PREDELETE.has(editor)
    EDITOR_TO_COMPOSITION_PREDELETE.delete(editor)

    commitChromeCompositionEndFallback({
      editor,
      mergeWithCompositionPredelete,
      rootElement: event.currentTarget,
      shouldCommit: shouldCommitChromeFallback,
      text: compositionText,
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

    const marks = editor.read((state) => state.marks.get())
    if (marks && Object.keys(marks).length > 0) {
      EDITOR_TO_PENDING_INSERTION_MARKS.set(editor, marks)
      writeRuntimeMarks(editor, marks)
    }

    setComposing(true)

    const selection = editor.read((state) => state.selection.get())
    if (
      selection &&
      Range.isExpanded(selection) &&
      event.nativeEvent.isTrusted
    ) {
      EDITOR_TO_COMPOSITION_PREDELETE.add(editor)
      editor.update((tx) => {
        tx.fragment.delete()
      })
      return
    }

    EDITOR_TO_COMPOSITION_PREDELETE.delete(editor)
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

  const compositionText = getCompositionEventText(event)
  if (compositionText) {
    EDITOR_TO_PENDING_COMPOSITION_TEXT.set(editor, compositionText)
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
      const selection = editor.read((state) => state.selection.get())
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
