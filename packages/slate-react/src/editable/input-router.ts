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
  useRef,
  useState,
} from 'react'
import { type Path, RangeApi } from 'slate'
import {
  EDITOR_TO_ELEMENT,
  getSelection,
  HAS_BEFORE_INPUT_SUPPORT,
  isDOMElement,
  isDOMText,
  NODE_TO_ELEMENT,
} from 'slate-dom'

import {
  getSlateNodeElementByPath,
  getSlateNodePathFromDOMElement,
} from '../hooks/use-slate-node-ref'
import { ReactEditor, type ReactRuntimeEditor } from '../plugin/react-editor'
import { isInteractiveInternalTarget } from './input-controller'
import { readRuntimeText } from './runtime-live-state'
import { readRuntimeSelection } from './runtime-selection-state'

type MutableRefBox<T> = {
  current: T
}

type CancelableCallback = {
  cancel: () => void
}

const DEFERRED_NATIVE_TEXT_INPUT_REPAIR_DELAY_MS = 16

type DeferredTextInputRepair = {
  pathKey: string | null
  repair: () => void
}

export type DOMInputRepairTarget = {
  insert?: {
    offset: number
    text: string
  }
  path: Path
  selectionOffset: number
  text: string
}

export type RepairDOMInput = (
  nativeInput: {
    data: string | null
    inputType: string
    target?: DOMInputRepairTarget | null
  },
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

const getTextHostSelectionOffset = ({
  anchorNode,
  anchorOffset,
  textHost,
}: {
  anchorNode: Node | null
  anchorOffset: number | null
  textHost: Element
}) => {
  if (anchorOffset == null || !anchorNode) {
    return null
  }

  const strings = Array.from(
    textHost.querySelectorAll('[data-slate-string], [data-slate-zero-width]')
  )
  let offset = 0

  for (const string of strings) {
    const textNode = Array.from(string.childNodes).find(isDOMText)
    const lengthAttribute = string.getAttribute('data-slate-length')
    const length =
      lengthAttribute == null
        ? (textNode?.textContent?.length ?? string.textContent?.length ?? 0)
        : Number.parseInt(lengthAttribute, 10)
    const safeLength = Number.isFinite(length) ? length : 0

    if (anchorNode === textNode || string.contains(anchorNode)) {
      return offset + Math.max(0, Math.min(anchorOffset, safeLength))
    }

    offset += safeLength
  }

  return null
}

export const getDOMInputRepairTarget = (
  editor: ReactRuntimeEditor,
  rootElement: HTMLElement,
  nativeInput?: { data: string | null; inputType: string }
): DOMInputRepairTarget | null => {
  const rootNode = rootElement.getRootNode?.() ?? rootElement.ownerDocument
  const root =
    'getSelection' in rootNode
      ? (rootNode as Document | ShadowRoot)
      : rootElement.ownerDocument
  const domSelection = getSelection(root)
  const anchorNode = domSelection?.anchorNode ?? null
  const anchorOffset = domSelection?.anchorOffset ?? null
  const textHost = isDOMText(anchorNode)
    ? anchorNode.parentElement?.closest('[data-slate-node="text"]')
    : isDOMElement(anchorNode)
      ? anchorNode.closest('[data-slate-node="text"]')
      : null
  const path = textHost ? getSlateNodePathFromDOMElement(textHost) : null
  const runtimeSelection = readRuntimeSelection(editor)
  const runtimePath =
    runtimeSelection && RangeApi.isCollapsed(runtimeSelection)
      ? runtimeSelection.anchor.path
      : null
  const nativeTextLength =
    nativeInput?.inputType === 'insertText' &&
    typeof nativeInput.data === 'string'
      ? nativeInput.data.length
      : 0
  const selectionOffset = textHost
    ? getTextHostSelectionOffset({ anchorNode, anchorOffset, textHost })
    : null
  const text = textHost?.textContent?.replace(/\uFEFF/g, '') ?? null

  if (
    path &&
    textHost &&
    selectionOffset != null &&
    text != null &&
    rootElement.contains(textHost)
  ) {
    return {
      path: [...path] as Path,
      selectionOffset,
      text,
    }
  }

  if (runtimePath) {
    const runtimeTextHost = getSlateNodeElementByPath(editor, runtimePath)
    const runtimeText =
      runtimeTextHost?.textContent?.replace(/\uFEFF/g, '') ?? null

    if (
      runtimeTextHost &&
      runtimeText != null &&
      rootElement.contains(runtimeTextHost) &&
      readRuntimeText(editor, runtimePath)
    ) {
      return {
        path: [...runtimePath] as Path,
        selectionOffset: runtimeSelection!.anchor.offset + nativeTextLength,
        text: runtimeText,
      }
    }
  }

  return null
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
  deferNativeTextInputRepair = false,
  editor,
  onHandledDOMInput,
  onReadOnlyDOMInput,
  repairDOMInput,
  readOnly,
  rootRef,
}: {
  deferNativeTextInputRepair?: boolean
  editor: ReactRuntimeEditor
  onHandledDOMInput?: (event: Event) => void
  onReadOnlyDOMInput?: () => void
  repairDOMInput: RepairDOMInput
  readOnly: boolean
  rootRef: RefObject<HTMLElement | null>
}) => {
  const deferredTextInputRepairTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null)
  const deferredTextInputRepairsRef = useRef<DeferredTextInputRepair[]>([])
  const flushDeferredTextInputRepairs = useCallback(() => {
    if (deferredTextInputRepairTimeoutRef.current !== null) {
      clearTimeout(deferredTextInputRepairTimeoutRef.current)
      deferredTextInputRepairTimeoutRef.current = null
    }

    const repairs = deferredTextInputRepairsRef.current

    deferredTextInputRepairsRef.current = []

    for (const { repair } of repairs) {
      repair()
    }
  }, [])
  const scheduleDeferredTextInputRepairs = useCallback(() => {
    if (deferredTextInputRepairTimeoutRef.current !== null) {
      clearTimeout(deferredTextInputRepairTimeoutRef.current)
    }

    deferredTextInputRepairTimeoutRef.current = setTimeout(
      flushDeferredTextInputRepairs,
      DEFERRED_NATIVE_TEXT_INPUT_REPAIR_DELAY_MS
    )
  }, [flushDeferredTextInputRepairs])

  return useCallback(
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
      const rootElement = rootRef.current
      const target =
        nativeInput.inputType === 'insertText'
          ? getDOMInputRepairTarget(editor, rootElement, nativeInput)
          : null
      const repair = () => {
        if (rootElement.isConnected) {
          repairDOMInput(
            {
              data: nativeInput.data,
              inputType: nativeInput.inputType,
              target,
            },
            rootElement
          )
        }
      }

      if (
        deferNativeTextInputRepair &&
        nativeInput.inputType === 'insertText' &&
        typeof nativeInput.data === 'string'
      ) {
        const pathKey = target?.path.join(',') ?? null
        const previousRepair = deferredTextInputRepairsRef.current.at(-1)

        if (pathKey && previousRepair?.pathKey === pathKey) {
          previousRepair.repair = repair
        } else {
          deferredTextInputRepairsRef.current.push({ pathKey, repair })
        }

        scheduleDeferredTextInputRepairs()
        return
      }

      flushDeferredTextInputRepairs()
      repair()
    },
    [
      deferNativeTextInputRepair,
      editor,
      flushDeferredTextInputRepairs,
      onHandledDOMInput,
      onReadOnlyDOMInput,
      readOnly,
      repairDOMInput,
      rootRef,
      scheduleDeferredTextInputRepairs,
    ]
  )
}

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
