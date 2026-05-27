import {
  type ClipboardEvent,
  type CompositionEvent,
  type DragEvent,
  type FocusEvent,
  type ForwardedRef,
  type KeyboardEvent,
  type MouseEvent,
  type InputEvent as ReactInputEvent,
  type RefObject,
  useCallback,
  useState,
} from 'react'
import {
  EDITOR_TO_ELEMENT,
  HAS_BEFORE_INPUT_SUPPORT,
  NODE_TO_ELEMENT,
} from 'slate-dom'

import { getSlateNodePathFromDOMElement } from '../hooks/use-slate-node-ref'
import { ReactEditor, type ReactRuntimeEditor } from '../plugin/react-editor'
import { isInteractiveInternalTarget } from './input-controller'
import { readRuntimeText } from './runtime-live-state'

type MutableRefBox<T> = {
  current: T
}

type CancelableCallback = {
  cancel: () => void
}

export type RepairDOMInput = (
  nativeInput: { data: string | null; inputType: string },
  rootElement: HTMLElement
) => void

export type HandleEditablePaste = (
  event: ClipboardEvent<HTMLDivElement>
) => void

export type HandleEditableClipboard = (
  event: ClipboardEvent<HTMLDivElement>
) => void

export type HandleEditableDrag = (event: DragEvent<HTMLDivElement>) => void

export type HandleEditableComposition = (
  event: CompositionEvent<HTMLDivElement>
) => void

export type HandleEditableInput = (
  event: ReactInputEvent<HTMLDivElement>
) => void

export type HandleEditableDOMBeforeInput = (event: InputEvent) => void

export type HandleEditableReactBeforeInputFallback = (text: string) => void

export type HandleEditableFocus = (event: FocusEvent<HTMLDivElement>) => void

export type HandleEditableMouse = (event: MouseEvent<HTMLDivElement>) => void

export type HandleEditableKeyboard = (
  event: KeyboardEvent<HTMLDivElement>
) => void

export type EditableDragLifecycleState = {
  isDraggingInternally: boolean
}

const getReadOnlyDOMStringLengths = ({
  nativeInput,
  rootElement,
  strings,
  text,
}: {
  nativeInput: { data: string | null; inputType: string }
  rootElement: HTMLElement
  strings: readonly HTMLElement[]
  text: string
}) => {
  const lengths = strings.map((string) => string.textContent?.length ?? 0)
  const extraLength =
    lengths.reduce((sum, length) => sum + length, 0) - text.length

  if (
    extraLength <= 0 ||
    nativeInput.inputType !== 'insertText' ||
    !nativeInput.data
  ) {
    return lengths
  }

  const selection = rootElement.ownerDocument.getSelection()
  const selectionElement =
    selection?.anchorNode instanceof Element
      ? selection.anchorNode
      : selection?.anchorNode?.parentElement
  const selectedString = selectionElement?.closest('[data-slate-string="true"]')
  const selectedIndex =
    selectedString instanceof HTMLElement ? strings.indexOf(selectedString) : -1
  const fallbackIndex = strings.findIndex((string) =>
    string.textContent?.includes(nativeInput.data!)
  )
  const targetIndex = selectedIndex >= 0 ? selectedIndex : fallbackIndex

  if (targetIndex >= 0) {
    lengths[targetIndex] = Math.max(0, lengths[targetIndex]! - extraLength)
  }

  return lengths
}

const restoreReadOnlyDOMText = ({
  editor,
  nativeInput,
  rootElement,
}: {
  editor: ReactRuntimeEditor
  nativeInput: { data: string | null; inputType: string }
  rootElement: HTMLElement
}) => {
  rootElement
    .querySelectorAll<HTMLElement>('[data-slate-node="text"]')
    .forEach((textElement) => {
      const path = getSlateNodePathFromDOMElement(textElement)
      const slateText = path ? readRuntimeText(editor, path)?.text : null

      if (slateText == null) {
        return
      }

      const strings = Array.from(
        textElement.querySelectorAll<HTMLElement>('[data-slate-string="true"]')
      )

      if (strings.length === 0) {
        return
      }

      const lengths = getReadOnlyDOMStringLengths({
        nativeInput,
        rootElement,
        strings,
        text: slateText,
      })
      let offset = 0

      strings.forEach((stringElement, index) => {
        const length =
          index === strings.length - 1
            ? slateText.length - offset
            : Math.max(
                0,
                Math.min(lengths[index] ?? 0, slateText.length - offset)
              )
        const nextText = slateText.slice(offset, offset + length)

        if (stringElement.textContent !== nextText) {
          stringElement.textContent = nextText
        }
        offset += length
      })
    })
}

export const attachEditableGlobalDragLifecycleListeners = ({
  state,
  targetDocument,
}: {
  state: EditableDragLifecycleState
  targetDocument: Document
}) => {
  // Listen for dragend and drop globally. In Firefox, if a drop handler
  // initiates an operation that causes the originally dragged element to
  // unmount, that element will not emit a dragend event. (2024/06/21)
  const stoppedDragging = () => {
    state.isDraggingInternally = false
  }
  targetDocument.addEventListener('dragend', stoppedDragging)
  targetDocument.addEventListener('drop', stoppedDragging)

  return () => {
    targetDocument.removeEventListener('dragend', stoppedDragging)
    targetDocument.removeEventListener('drop', stoppedDragging)
  }
}

export const attachEditableNativeInputListeners = ({
  node,
  onDOMBeforeInput,
  onDOMInput,
}: {
  node: HTMLElement
  onDOMBeforeInput: (event: InputEvent) => void
  onDOMInput: (event: Event) => void
}) => {
  // Attach a native DOM event handler for `beforeinput` events, because React's
  // built-in `onBeforeInput` is actually a leaky polyfill that doesn't expose
  // real `beforeinput` events sadly... (2019/11/04)
  // https://github.com/facebook/react/issues/11211
  // `beforeinput` is attached directly because React's polyfill does
  // not expose the real event on this path.
  node.addEventListener('beforeinput', onDOMBeforeInput)
  node.addEventListener('input', onDOMInput)

  return () => {
    // `beforeinput` is attached directly because React's polyfill does
    // not expose the real event on this path.
    node.removeEventListener('beforeinput', onDOMBeforeInput)
    node.removeEventListener('input', onDOMInput)
  }
}

export const useEditableRootRef = ({
  detachNativeInputListenersRef,
  editor,
  forwardedRef,
  onDOMBeforeInput,
  onDOMInput,
  onDOMSelectionChange,
  rootRef,
  scheduleOnDOMSelectionChange,
}: {
  detachNativeInputListenersRef: MutableRefBox<(() => void) | null>
  editor: ReactRuntimeEditor
  forwardedRef?: ForwardedRef<HTMLDivElement>
  onDOMBeforeInput: (event: InputEvent) => void
  onDOMInput: (event: Event) => void
  onDOMSelectionChange: CancelableCallback
  rootRef: MutableRefBox<HTMLDivElement | null>
  scheduleOnDOMSelectionChange: CancelableCallback
}) => {
  const [nativeInputHandlers] = useState(() => {
    const handlers = {
      onDOMBeforeInput: null as ((event: InputEvent) => void) | null,
      onDOMInput: null as ((event: Event) => void) | null,
      handleDOMBeforeInput(event: InputEvent) {
        handlers.onDOMBeforeInput?.(event)
      },
      handleDOMInput(event: Event) {
        handlers.onDOMInput?.(event)
      },
    }

    return handlers
  })

  nativeInputHandlers.onDOMBeforeInput = onDOMBeforeInput
  nativeInputHandlers.onDOMInput = onDOMInput

  return useCallback(
    (node: HTMLDivElement | null) => {
      if (node == null) {
        onDOMSelectionChange.cancel()
        scheduleOnDOMSelectionChange.cancel()

        EDITOR_TO_ELEMENT.delete(editor)
        NODE_TO_ELEMENT.delete(editor)

        if (rootRef.current) {
          detachNativeInputListenersRef.current?.()
          detachNativeInputListenersRef.current = null
        }
      } else {
        detachNativeInputListenersRef.current =
          attachEditableNativeInputListeners({
            node,
            onDOMBeforeInput: nativeInputHandlers.handleDOMBeforeInput,
            onDOMInput: nativeInputHandlers.handleDOMInput,
          })
      }
      rootRef.current = node
      if (typeof forwardedRef === 'function') {
        forwardedRef(node)
      } else if (forwardedRef) {
        forwardedRef.current = node
      }
    },
    [
      detachNativeInputListenersRef,
      editor,
      forwardedRef,
      nativeInputHandlers,
      onDOMSelectionChange,
      rootRef,
      scheduleOnDOMSelectionChange,
    ]
  )
}

export const useEditableDOMInputHandler = ({
  editor,
  onHandledDOMInput,
  onReadOnlyDOMInput,
  repairDOMInput,
  readOnly,
  rootRef,
}: {
  editor: ReactRuntimeEditor
  onHandledDOMInput?: (event: Event) => void
  onReadOnlyDOMInput?: () => void
  repairDOMInput: RepairDOMInput
  readOnly: boolean
  rootRef: RefObject<HTMLElement | null>
}) =>
  useCallback(
    (event: Event) => {
      const nativeInput = event as InputEvent

      if (isInteractiveInternalTarget(editor, event.target)) {
        event.stopImmediatePropagation()
        return
      }

      if (!rootRef.current || typeof nativeInput.inputType !== 'string') {
        return
      }

      if (readOnly) {
        event.preventDefault()
        event.stopImmediatePropagation()
        restoreReadOnlyDOMText({
          editor,
          nativeInput,
          rootElement: rootRef.current,
        })
        onReadOnlyDOMInput?.()
        return
      }

      onHandledDOMInput?.(event)
      repairDOMInput(nativeInput, rootRef.current)
    },
    [
      editor,
      onHandledDOMInput,
      onReadOnlyDOMInput,
      readOnly,
      repairDOMInput,
      rootRef,
    ]
  )

export const useEditableDOMBeforeInputHandler = ({
  handleDOMBeforeInput,
}: {
  handleDOMBeforeInput: HandleEditableDOMBeforeInput
}) =>
  useCallback(
    (event: InputEvent) => {
      handleDOMBeforeInput(event)
    },
    [handleDOMBeforeInput]
  )

export const useEditableReactBeforeInputHandler = ({
  editor,
  handleFallbackInsertText,
  onBeforeInput,
  readOnly,
}: {
  editor: ReactRuntimeEditor
  handleFallbackInsertText: HandleEditableReactBeforeInputFallback
  onBeforeInput?:
    | ((event: React.FormEvent<HTMLDivElement>) => boolean | void)
    | undefined
  readOnly: boolean
}) =>
  useCallback(
    (event: React.InputEvent<HTMLDivElement>) => {
      if (isInteractiveInternalTarget(editor, event.target)) {
        event.stopPropagation()
        return
      }

      // COMPAT: Certain browsers don't support the `beforeinput` event, so we
      // fall back to React's leaky polyfill instead just for it. It
      // only works for the `insertText` input type.
      if (
        !HAS_BEFORE_INPUT_SUPPORT &&
        !readOnly &&
        !(onBeforeInput?.(event) ?? event.defaultPrevented) &&
        ReactEditor.hasSelectableTarget(editor, event.target)
      ) {
        event.preventDefault()
        if (!ReactEditor.isComposing(editor)) {
          const text = event.nativeEvent.data
          if (text != null) {
            handleFallbackInsertText(text)
          }
        }
      }
    },
    [editor, handleFallbackInsertText, onBeforeInput, readOnly]
  )

export const useEditablePasteHandler = ({
  handlePaste,
}: {
  handlePaste: HandleEditablePaste
}) =>
  useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      handlePaste(event)
    },
    [handlePaste]
  )

export const useEditableClipboardHandler = ({
  handleClipboard,
}: {
  handleClipboard: HandleEditableClipboard
}) =>
  useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      handleClipboard(event)
    },
    [handleClipboard]
  )

export const useEditableDragHandler = ({
  handleDrag,
}: {
  handleDrag: HandleEditableDrag
}) =>
  useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      handleDrag(event)
    },
    [handleDrag]
  )

export const useEditableCompositionHandler = ({
  handleComposition,
}: {
  handleComposition: HandleEditableComposition
}) =>
  useCallback(
    (event: CompositionEvent<HTMLDivElement>) => {
      handleComposition(event)
    },
    [handleComposition]
  )

export const useEditableInputHandler = ({
  handleInput,
}: {
  handleInput: HandleEditableInput
}) =>
  useCallback(
    (event: ReactInputEvent<HTMLDivElement>) => {
      handleInput(event)
    },
    [handleInput]
  )

export const useEditableFocusHandler = ({
  handleFocus,
}: {
  handleFocus: HandleEditableFocus
}) =>
  useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      handleFocus(event)
    },
    [handleFocus]
  )

export const useEditableMouseHandler = ({
  handleMouse,
}: {
  handleMouse: HandleEditableMouse
}) =>
  useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      handleMouse(event)
    },
    [handleMouse]
  )

export const useEditableKeyboardHandler = ({
  handleKeyboard,
}: {
  handleKeyboard: HandleEditableKeyboard
}) =>
  useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      handleKeyboard(event)
    },
    [handleKeyboard]
  )
