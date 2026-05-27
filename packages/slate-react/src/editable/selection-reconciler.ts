import {
  type FocusEvent,
  type MouseEvent,
  type RefObject,
  useCallback,
} from 'react'
import { NodeApi, PathApi, type Range, RangeApi } from 'slate'
import {
  containsShadowAware,
  type DOMElement,
  type DOMRange,
  EDITOR_TO_ELEMENT,
  EDITOR_TO_USER_SELECTION,
  EDITOR_TO_WINDOW,
  ELEMENT_TO_NODE,
  getDefaultView,
  getSelection,
  IS_ANDROID,
  IS_FIREFOX,
  IS_FOCUSED,
  IS_NODE_MAP_DIRTY,
  IS_WEBKIT,
  isDOMElement,
  isDOMNode,
  isDOMText,
  NODE_TO_ELEMENT,
  TRIPLE_CLICK,
} from 'slate-dom'
import type { AndroidInputManager } from '../hooks/android-input-manager/android-input-manager'
import { useIsomorphicLayoutEffect } from '../hooks/use-isomorphic-layout-effect'
import { getSlateNodePathFromDOMElement } from '../hooks/use-slate-node-ref'
import { ReactEditor, type ReactRuntimeEditor } from '../plugin/react-editor'
import { writeSlateViewSelection } from '../view-selection'
import { applyDOMCoverageSelectionPolicy } from './dom-coverage-selection'
import { getInputEventTargetRanges } from './dom-input-event'
import {
  type EditableInputController,
  executeEditableSelectionExport,
  isEditableOutsideFocusBoundarySettling,
  isInteractiveInternalTarget,
  isSelectionInEditorView,
  type SelectionChangeOrigin,
  setEditableModelSelectionPreference,
  syncEditableDOMSelectionToEditor,
} from './input-controller'
import { Editor } from './runtime-editor-api'
import { readRuntimeNode, readRuntimeText } from './runtime-live-state'
import { writeRuntimeSelection } from './runtime-mutation-state'
import { readRuntimeSelection } from './runtime-selection-state'
import {
  shouldSkipDOMSelection,
  shouldSkipSelectionFocus,
  shouldSkipSelectionScroll,
} from './selection-side-effect-policy'

export const resolveSlateCollapsedRangeFromDOMSelection = (
  editor: Editor,
  domSelection: globalThis.Selection
): Range | null => {
  if (!domSelection.isCollapsed) {
    return null
  }

  const anchorNode = domSelection.anchorNode
  const anchorOffset = domSelection.anchorOffset
  const anchorElement = isDOMText(anchorNode)
    ? anchorNode.parentElement
    : isDOMElement(anchorNode)
      ? anchorNode
      : null
  const textHost = anchorElement?.closest('[data-slate-node="text"]')
  const stringHost = anchorElement?.closest(
    '[data-slate-string], [data-slate-zero-width]'
  )

  if (!textHost || !stringHost) {
    return null
  }

  const path = getSlateNodePathFromDOMElement(textHost)
  const slateNode = path ? readRuntimeText(editor, path) : null

  if (!path || !slateNode) return null

  const strings = Array.from(
    textHost.querySelectorAll('[data-slate-string], [data-slate-zero-width]')
  )
  let offset = 0

  for (const string of strings) {
    const lengthAttribute = string.getAttribute('data-slate-length')
    const length =
      lengthAttribute == null
        ? (string.textContent?.length ?? 0)
        : Number.parseInt(lengthAttribute, 10)

    if (string === stringHost) {
      const nextOffset = Math.max(
        0,
        Math.min(slateNode.text.length, offset + anchorOffset)
      )

      return {
        anchor: { path, offset: nextOffset },
        focus: { path, offset: nextOffset },
      }
    }

    offset += Number.isFinite(length) ? length : 0
  }

  return null
}

export const resolveSlateRangeFromDOMSelection = (
  editor: Editor,
  domSelection: globalThis.Selection,
  editorElement: HTMLElement
): Range | null => {
  if (domSelection.isCollapsed) {
    return resolveSlateCollapsedRangeFromDOMSelection(editor, domSelection)
  }

  if (
    domSelection.anchorNode === editorElement &&
    domSelection.focusNode === editorElement
  ) {
    const start = Math.min(domSelection.anchorOffset, domSelection.focusOffset)
    const end = Math.max(domSelection.anchorOffset, domSelection.focusOffset)

    if (start === 0 && end >= editorElement.childNodes.length) {
      return Editor.range(editor, [])
    }
  }

  const selectedText = domSelection.toString().replace(/\uFEFF/g, '')
  const editorText = editorElement.textContent?.replace(/\uFEFF/g, '') ?? ''

  if (selectedText && selectedText === editorText) {
    return Editor.range(editor, [])
  }

  return null
}

export type EditableSelectionReconcilerState = {
  isUpdatingSelection: boolean
  latestElement: DOMElement | null
  outsideFocusBoundarySettleUntil: number
  pendingDOMSelectionImport: boolean
  selectionChangeOrigin?: SelectionChangeOrigin | null
}

type EditableFocusHandler = (
  event: FocusEvent<HTMLDivElement>
) => boolean | void

type EditableMouseHandler = (
  event: MouseEvent<HTMLDivElement>
) => boolean | void

const isReactEventHandled = <
  EventType extends {
    isDefaultPrevented: () => boolean
    isPropagationStopped: () => boolean
  },
>({
  event,
  handler,
}: {
  event: EventType
  handler?: (event: EventType) => boolean | void
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

export const attachEditableSelectionChangeListener = ({
  scheduleOnDOMSelectionChange,
  state,
  targetDocument,
}: {
  scheduleOnDOMSelectionChange: () => void
  state: { pendingDOMSelectionImport: boolean }
  targetDocument: Document
}) => {
  const HTMLElementConstructor = targetDocument.defaultView?.HTMLElement

  // COMPAT: In Chrome, `selectionchange` events can fire when <input> and
  // <textarea> elements are appended to the DOM, causing
  // `editor.selection` to be overwritten in some circumstances.
  // (2025/01/16) https://issues.chromium.org/issues/389368412
  const handleNativeSelectionChange = ({ target }: Event) => {
    const targetElement =
      HTMLElementConstructor && target instanceof HTMLElementConstructor
        ? target
        : null
    const targetTagName = targetElement?.tagName
    if (targetTagName === 'INPUT' || targetTagName === 'TEXTAREA') {
      return
    }
    state.pendingDOMSelectionImport = true
    scheduleOnDOMSelectionChange()
  }

  // Attach a native DOM event handler for `selectionchange`, because React's
  // built-in `onSelect` handler doesn't fire for all selection changes. It's
  // a leaky polyfill that only fires on keypresses or clicks. Instead, we
  // want to fire for any change to the selection inside the editor.
  // (2019/11/04) https://github.com/facebook/react/issues/5785
  targetDocument.addEventListener(
    'selectionchange',
    handleNativeSelectionChange
  )

  return () => {
    targetDocument.removeEventListener(
      'selectionchange',
      handleNativeSelectionChange
    )
  }
}

export const applyEditableBlur = ({
  editor,
  event,
  onBlur,
  readOnly,
  state,
}: {
  editor: ReactRuntimeEditor
  event: FocusEvent<HTMLDivElement>
  onBlur?: EditableFocusHandler
  readOnly: boolean
  state: EditableSelectionReconcilerState
}) => {
  if (
    state.isUpdatingSelection ||
    !ReactEditor.hasSelectableTarget(editor, event.target) ||
    isReactEventHandled({ event, handler: onBlur })
  ) {
    return
  }

  // COMPAT: If the current `activeElement` is still the previous
  // one, this is due to the window being blurred when the tab
  // itself becomes unfocused, so we want to abort early to allow to
  // editor to stay focused when the tab becomes focused again.
  const root = ReactEditor.findDocumentOrShadowRoot(editor)
  if (state.latestElement === root.activeElement) {
    return
  }

  const { relatedTarget } = event
  const el = ReactEditor.assertDOMNode(editor, editor)

  // COMPAT: The event should be ignored if the focus is returning
  // to the editor from an embedded editable element (eg. an <input>
  // element inside a void node).
  if (relatedTarget === el) {
    return
  }

  // COMPAT: The event should be ignored if the focus is moving from
  // the editor to inside a void node's spacer element.
  if (
    isDOMElement(relatedTarget) &&
    relatedTarget.hasAttribute('data-slate-spacer')
  ) {
    return
  }

  // COMPAT: The event should be ignored if the focus is moving to a
  // non- editable section of an element that isn't a void node (eg.
  // a list item of the check list example).
  if (
    relatedTarget != null &&
    isDOMNode(relatedTarget) &&
    ReactEditor.hasDOMNode(editor, relatedTarget)
  ) {
    try {
      const node = ReactEditor.resolveSlateNode(editor, relatedTarget)

      if (node && NodeApi.isElement(node) && !Editor.isVoid(editor, node)) {
        return
      }
    } catch {
      return
    }
  }

  // COMPAT: Safari doesn't always remove the selection even if the content-
  // editable element no longer has focus. Refer to:
  // https://stackoverflow.com/questions/12353247/force-contenteditable-div-to-stop-accepting-input-after-it-loses-focus-under-web
  if (IS_WEBKIT) {
    const domSelection = getSelection(root)
    domSelection?.removeAllRanges()
  }

  IS_FOCUSED.delete(editor)
}

export const applyEditableFocus = ({
  editor,
  event,
  onFocus,
  readOnly,
  state,
}: {
  editor: ReactRuntimeEditor
  event: FocusEvent<HTMLDivElement>
  onFocus?: EditableFocusHandler
  readOnly: boolean
  state: EditableSelectionReconcilerState
}) => {
  if (isEditableOutsideFocusBoundarySettling(state)) {
    return false
  }

  if (
    !state.isUpdatingSelection &&
    ReactEditor.hasEditableTarget(editor, event.target) &&
    !isReactEventHandled({ event, handler: onFocus })
  ) {
    const el = ReactEditor.assertDOMNode(editor, editor)
    const root = ReactEditor.findDocumentOrShadowRoot(editor)
    state.latestElement = root.activeElement

    // COMPAT: If the editor has nested editable elements, the focus
    // can go to them. In Firefox, this must be prevented because it
    // results in issues with keyboard navigation. (2017/03/30)
    if (IS_FIREFOX && event.target !== el) {
      el.focus()
      return
    }

    IS_FOCUSED.set(editor, true)
    return true
  }

  return false
}

const resolveEditableClickTarget = (
  editor: ReactRuntimeEditor,
  target: EventTarget
) => {
  if (!isDOMNode(target)) {
    return null
  }

  const targetElement = isDOMText(target)
    ? target.parentElement
    : isDOMElement(target)
      ? target
      : null
  const slateHost = targetElement?.closest('[data-slate-node]')
  const path =
    slateHost instanceof Element
      ? getSlateNodePathFromDOMElement(slateHost)
      : null

  if (path != null) {
    const liveNode = readRuntimeNode(editor, path)

    if (liveNode) {
      return { node: liveNode, path }
    }

    if (Editor.hasPath(editor, path)) {
      const [node] = editor.read((state) => state.nodes.get(path))
      return { node, path }
    }
  }

  try {
    const node = ReactEditor.resolveSlateNode(editor, target)
    const fallbackPath = node ? ReactEditor.resolvePath(editor, node) : null

    // At this time, the Slate document may be arbitrarily different,
    // because onClick handlers can change the document before we get here.
    // Therefore we must check that this path actually exists,
    // and that it still refers to the same node.
    if (
      !node ||
      !fallbackPath ||
      !Editor.hasPath(editor, fallbackPath) ||
      NodeApi.get(editor, fallbackPath) !== node
    ) {
      return null
    }

    return { node, path: fallbackPath }
  } catch {
    return null
  }
}

const resolveEditableVoidClickTarget = (
  editor: ReactRuntimeEditor,
  target: EventTarget
) => {
  const resolvedTarget = resolveEditableClickTarget(editor, target)

  if (
    resolvedTarget &&
    NodeApi.isElement(resolvedTarget.node) &&
    Editor.isVoid(editor, resolvedTarget.node)
  ) {
    return resolvedTarget
  }

  return null
}

const preferModelSelectionForVoidTarget = ({
  editor,
  inputController,
  target,
}: {
  editor: ReactRuntimeEditor
  inputController: EditableInputController
  target: EventTarget | null
}) => {
  if (
    !isDOMNode(target) ||
    !ReactEditor.isTargetInsideNonReadonlyVoid(editor, target)
  ) {
    return false
  }

  setEditableModelSelectionPreference({
    inputController,
    preferModelSelection: true,
    reason: 'programmatic-export',
    selectionSource: 'model-owned',
  })
  inputController.state.selectionChangeOrigin = 'programmatic-export'
  return true
}

export const applyEditableClick = ({
  editor,
  event,
  onClick,
  inputController,
  readOnly,
}: {
  editor: ReactRuntimeEditor
  event: MouseEvent<HTMLDivElement>
  inputController: EditableInputController
  onClick?: EditableMouseHandler
  readOnly: boolean
}) => {
  if (isInteractiveInternalTarget(editor, event.target)) {
    setEditableModelSelectionPreference({
      inputController,
      preferModelSelection: true,
      selectionSource: 'app-owned',
    })
    return
  }

  if (readOnly) {
    isReactEventHandled({ event, handler: onClick })
    return
  }

  const voidTarget = isDOMNode(event.target)
    ? resolveEditableVoidClickTarget(editor, event.target)
    : null
  const voidTargetOwnsSelection = preferModelSelectionForVoidTarget({
    editor,
    inputController,
    target: event.target,
  })

  if (!voidTargetOwnsSelection) {
    setEditableModelSelectionPreference({
      inputController,
      preferModelSelection: false,
      selectionSource: 'dom-current',
    })
  }

  if (!isReactEventHandled({ event, handler: onClick })) {
    const target =
      voidTarget ?? resolveEditableClickTarget(editor, event.target)

    if (!target) {
      return
    }

    const { node, path } = target

    if (event.detail === TRIPLE_CLICK && path.length >= 1) {
      let blockPath = path
      if (!(NodeApi.isElement(node) && Editor.isBlock(editor, node))) {
        const block = Editor.above(editor, {
          match: (n) => NodeApi.isElement(n) && Editor.isBlock(editor, n),
          at: path,
        })

        blockPath = block?.[1] ?? path.slice(0, 1)
      }

      const range = Editor.range(editor, blockPath)
      writeSlateViewSelection(editor, null)
      editor.update((tx) => {
        tx.selection.set(range)
      })
      return
    }

    const start = Editor.point(editor, path, { edge: 'start' })
    const end = Editor.point(editor, path, { edge: 'end' })
    const startVoid = Editor.void(editor, { at: start })
    const endVoid = Editor.void(editor, { at: end })

    if (startVoid && endVoid && PathApi.equals(startVoid[1], endVoid[1])) {
      const range = Editor.range(editor, start)
      ReactEditor.focus(editor)
      writeSlateViewSelection(editor, null)
      editor.update((tx) => {
        tx.selection.set(range)
      })
    }
  }
}

export const applyEditableMouseDown = ({
  editor,
  event,
  inputController,
  onMouseDown,
}: {
  editor: ReactRuntimeEditor
  event: MouseEvent<HTMLDivElement>
  inputController: EditableInputController
  onMouseDown?: EditableMouseHandler
}) => {
  inputController.state.outsideFocusBoundarySettleUntil = 0

  if (isInteractiveInternalTarget(editor, event.target)) {
    setEditableModelSelectionPreference({
      inputController,
      preferModelSelection: true,
      selectionSource: 'app-owned',
    })
    onMouseDown?.(event)
    return
  }

  const voidTarget = isDOMNode(event.target)
    ? resolveEditableVoidClickTarget(editor, event.target)
    : null
  const voidTargetOwnsSelection = preferModelSelectionForVoidTarget({
    editor,
    inputController,
    target: event.target,
  })

  if (voidTargetOwnsSelection && voidTarget) {
    const start = Editor.point(editor, voidTarget.path, { edge: 'start' })
    const range = Editor.range(editor, start)

    ReactEditor.focus(editor)
    writeSlateViewSelection(editor, null)
    editor.update((tx) => {
      tx.selection.set(range)
    })
  }

  if (!voidTargetOwnsSelection) {
    setEditableModelSelectionPreference({
      inputController,
      preferModelSelection: false,
      selectionSource: 'dom-current',
    })
  }
  onMouseDown?.(event)
}

export const syncSelectionForBeforeInput = ({
  allowDOMSelectionImport = true,
  data,
  editor,
  editorElement,
  event,
  inputType: type,
  isCompositionChange,
  native,
  preferModelSelectionForInput,
  root,
  selection,
}: {
  allowDOMSelectionImport?: boolean
  data: unknown
  editor: ReactRuntimeEditor
  editorElement: HTMLElement
  event: InputEvent
  inputType: string
  isCompositionChange: boolean
  native: boolean
  preferModelSelectionForInput: boolean
  root: Document | ShadowRoot
  selection: Range | null
}): {
  native: boolean
  selection: Range | null
} => {
  let nextNative = native
  let nextSelection = selection
  const domSelection = getSelection(root)
  const domSelectionAnchorNode = domSelection?.anchorNode ?? null
  const domSelectionFocusNode = domSelection?.focusNode ?? null
  const domSelectionBelongsToEditor =
    !domSelection ||
    domSelection.rangeCount === 0 ||
    (ReactEditor.hasSelectableTarget(editor, domSelectionAnchorNode) &&
      ReactEditor.hasSelectableTarget(editor, domSelectionFocusNode))

  // COMPAT: Most deleting forward/backward input types can derive the target
  // from the current selection, but IME/focus cleanup can provide an expanded
  // beforeinput target range that must become the model delete range.
  // If the NODE_MAP is dirty, we can't trust DOM selection import.
  if (allowDOMSelectionImport && !IS_NODE_MAP_DIRTY.get(editor)) {
    const [targetRange] = getInputEventTargetRanges(event)

    if (
      targetRange &&
      domSelectionBelongsToEditor &&
      ReactEditor.hasSelectableTarget(editor, targetRange.startContainer) &&
      ReactEditor.hasSelectableTarget(editor, targetRange.endContainer)
    ) {
      const range = ReactEditor.resolveSlateRange(editor, targetRange, {
        exactMatch: false,
      })
      const shouldUseTargetRange =
        range &&
        !(
          preferModelSelectionForInput &&
          type === 'insertText' &&
          RangeApi.isCollapsed(range)
        ) &&
        (!type.startsWith('delete') ||
          type.startsWith('deleteBy') ||
          RangeApi.isExpanded(range))

      if (
        shouldUseTargetRange &&
        (!nextSelection || !RangeApi.equals(nextSelection, range))
      ) {
        nextNative = false

        const selectionRef =
          !isCompositionChange &&
          type !== 'insertText' &&
          nextSelection &&
          Editor.rangeRef(editor, nextSelection)

        writeSlateViewSelection(editor, null)
        editor.update((tx) => {
          tx.selection.set(range)
        })
        nextSelection = range

        if (selectionRef) {
          EDITOR_TO_USER_SELECTION.set(editor, selectionRef)
        }
      }
    }
  }

  if (
    allowDOMSelectionImport &&
    type === 'insertText' &&
    !preferModelSelectionForInput &&
    domSelection &&
    domSelectionBelongsToEditor
  ) {
    const range =
      resolveSlateRangeFromDOMSelection(editor, domSelection, editorElement) ??
      (IS_NODE_MAP_DIRTY.get(editor)
        ? null
        : ReactEditor.resolveSlateRange(editor, domSelection, {
            exactMatch: false,
          }))

    if (range && (!nextSelection || !RangeApi.equals(nextSelection, range))) {
      nextNative = false
      writeSlateViewSelection(editor, null)
      editor.update((tx) => {
        tx.selection.set(range)
      })
      nextSelection = range
    }
  }

  if (
    type === 'insertText' &&
    typeof data === 'string' &&
    (!nextSelection || !Editor.hasPath(editor, nextSelection.anchor.path)) &&
    Editor.string(editor, []) === ''
  ) {
    const firstText = Array.from(NodeApi.texts(editor))[0]

    if (firstText) {
      const [, path] = firstText
      const range = Editor.range(editor, { path, offset: 0 })
      writeSlateViewSelection(editor, null)
      editor.update((tx) => {
        tx.selection.set(range)
      })
      nextSelection = range
    }
  }

  if (
    allowDOMSelectionImport &&
    type.startsWith('delete') &&
    !preferModelSelectionForInput
  ) {
    const range =
      domSelectionBelongsToEditor && domSelection
        ? resolveSlateRangeFromDOMSelection(editor, domSelection, editorElement)
        : null

    if (range && (!nextSelection || !RangeApi.equals(nextSelection, range))) {
      writeSlateViewSelection(editor, null)
      editor.update((tx) => {
        tx.selection.set(range)
      })
      nextSelection = range
    }
  }

  return {
    native: nextNative,
    selection: nextSelection,
  }
}

export const restoreUserSelectionAfterBeforeInput = ({
  editor,
}: {
  editor: ReactRuntimeEditor
}) => {
  // Restore the actual user section if nothing manually set it.
  const toRestore = EDITOR_TO_USER_SELECTION.get(editor)?.unref()
  EDITOR_TO_USER_SELECTION.delete(editor)

  if (
    toRestore &&
    (!readRuntimeSelection(editor) ||
      !RangeApi.equals(readRuntimeSelection(editor)!, toRestore))
  ) {
    writeSlateViewSelection(editor, null)
    editor.update((tx) => {
      tx.selection.set(toRestore)
    })
  }
}

export const handleWebKitShadowDOMBeforeInput = ({
  editor,
  event,
  processing,
  root,
  window,
}: {
  editor: ReactRuntimeEditor
  event: InputEvent
  processing: RefObject<boolean>
  root: globalThis.Node
  window: Window & typeof globalThis
}) => {
  const rootWindow = root.ownerDocument?.defaultView ?? window
  const ShadowRootConstructor = rootWindow.ShadowRoot

  if (
    !(
      processing.current &&
      IS_WEBKIT &&
      ShadowRootConstructor &&
      root instanceof ShadowRootConstructor
    )
  ) {
    return false
  }

  const ranges = getInputEventTargetRanges(event)
  const range = ranges[0]

  if (!range) {
    return true
  }

  const newRange = new rootWindow.Range()

  newRange.setStart(range.startContainer, range.startOffset)
  newRange.setEnd(range.endContainer, range.endOffset)

  // Translate the DOM Range into a Slate Range
  const slateRange = ReactEditor.resolveSlateRange(editor, newRange, {
    exactMatch: false,
  })

  if (!slateRange) {
    return true
  }

  writeSlateViewSelection(editor, null)
  editor.update((tx) => {
    tx.selection.set(slateRange)
  })

  event.preventDefault()
  event.stopImmediatePropagation()
  return true
}

export const useEditableSelectionReconciler = ({
  androidInputManagerRef,
  editor,
  inputController,
  rootRef,
  scrollSelectionIntoView,
  partialDOMBackedSelection,
  state,
}: {
  androidInputManagerRef: RefObject<AndroidInputManager | null | undefined>
  editor: ReactRuntimeEditor
  inputController: EditableInputController
  rootRef: RefObject<HTMLDivElement | null>
  scrollSelectionIntoView: (
    editor: ReactRuntimeEditor,
    domRange: DOMRange
  ) => void
  partialDOMBackedSelection: boolean
  state: EditableSelectionReconcilerState
}) => {
  useIsomorphicLayoutEffect(() => {
    // Update element-related weak maps with the DOM element ref.
    const editorWindow = rootRef.current
      ? getDefaultView(rootRef.current)
      : null
    if (rootRef.current && editorWindow) {
      EDITOR_TO_WINDOW.set(editor, editorWindow)
      EDITOR_TO_ELEMENT.set(editor, rootRef.current)
      NODE_TO_ELEMENT.set(editor, rootRef.current)
      ELEMENT_TO_NODE.set(rootRef.current, editor)
    } else {
      NODE_TO_ELEMENT.delete(editor)
    }

    // Make sure the DOM selection state is in sync.
    const selection = readRuntimeSelection(editor)
    const root = ReactEditor.findDocumentOrShadowRoot(editor)
    const domSelection = getSelection(root)

    if (!isSelectionInEditorView(editor, selection)) {
      return
    }

    if (isEditableOutsideFocusBoundarySettling(state)) {
      return
    }

    if (!domSelection || androidInputManagerRef.current?.hasPendingAction()) {
      return
    }

    if (isInteractiveInternalTarget(editor, root.activeElement)) {
      return
    }

    const editorElementForActiveTarget = EDITOR_TO_ELEMENT.get(editor)
    if (
      !editorElementForActiveTarget ||
      (root.activeElement &&
        root.activeElement !==
          editorElementForActiveTarget.ownerDocument.body &&
        root.activeElement !==
          editorElementForActiveTarget.ownerDocument.documentElement &&
        !containsShadowAware(editorElementForActiveTarget, root.activeElement))
    ) {
      return
    }

    if (shouldSkipDOMSelection(editor)) {
      return
    }

    if (
      state.pendingDOMSelectionImport &&
      containsShadowAware(
        editorElementForActiveTarget,
        domSelection.anchorNode
      ) &&
      containsShadowAware(editorElementForActiveTarget, domSelection.focusNode)
    ) {
      return
    }

    if (partialDOMBackedSelection) {
      domSelection.removeAllRanges()
      return
    }

    const clearUpdatingSelection = () => {
      setTimeout(() => {
        state.isUpdatingSelection = false
      })
    }

    const setDomSelection = (forceChange?: boolean) => {
      const hasDomSelection = domSelection.type !== 'None'

      // If the DOM selection is properly unset, we're done.
      if (!selection && !hasDomSelection) {
        return
      }

      // Get anchorNode and focusNode
      const focusNode = domSelection.focusNode
      let anchorNode: globalThis.Node | null = null

      // COMPAT: In firefox the normal selection way does not work
      // (https://github.com/ianstormtaylor/slate/pull/5486#issue-1820720223)
      if (IS_FIREFOX && domSelection.rangeCount > 1) {
        const firstRange = domSelection.getRangeAt(0)
        const lastRange = domSelection.getRangeAt(domSelection.rangeCount - 1)

        // Right to left
        if (firstRange.startContainer === focusNode) {
          anchorNode = lastRange.endContainer
        } else {
          // Left to right
          anchorNode = firstRange.startContainer
        }
      } else {
        anchorNode = domSelection.anchorNode
      }

      // verify that the dom selection is in the editor
      const editorElement = EDITOR_TO_ELEMENT.get(editor)!
      let hasDomSelectionInEditor = false
      if (
        containsShadowAware(editorElement, anchorNode) &&
        containsShadowAware(editorElement, focusNode)
      ) {
        hasDomSelectionInEditor = true
      }

      // If the DOM selection is in the editor and the editor selection is already correct, we're done.
      if (
        hasDomSelection &&
        hasDomSelectionInEditor &&
        selection &&
        !forceChange
      ) {
        const slateRange = ReactEditor.resolveSlateRange(editor, domSelection, {
          exactMatch: true,

          // domSelection is not necessarily a valid Slate range
          // (e.g. when clicking on contentEditable:false element)
        })

        const isCollapsedElementSelection =
          domSelection.isCollapsed && !isDOMText(anchorNode)

        if (
          slateRange &&
          RangeApi.equals(slateRange, selection) &&
          !isCollapsedElementSelection
        ) {
          return
        }
      }

      // when <Editable/> is being controlled through external value
      // then its children might just change - DOM responds to it on its own
      // but Slate's value is not being updated through any operation
      // and thus it doesn't transform selection on its own
      if (selection && !ReactEditor.hasRange(editor, selection)) {
        writeRuntimeSelection(
          editor,
          ReactEditor.resolveSlateRange(editor, domSelection, {
            exactMatch: false,
          })
        )
        return
      }

      if (
        selection &&
        applyDOMCoverageSelectionPolicy({
          domSelection,
          editor,
          selection,
        })
      ) {
        return
      }

      // Otherwise the DOM selection is out of sync, so update it.
      state.isUpdatingSelection = true
      state.selectionChangeOrigin = 'programmatic-export'

      let newDomRange: DOMRange | null = null

      newDomRange = selection
        ? ReactEditor.resolveDOMRange(editor, selection)
        : null

      if (newDomRange) {
        if (ReactEditor.isComposing(editor) && !IS_ANDROID) {
          if (domSelection.rangeCount > 0) {
            domSelection.collapseToEnd()
          } else {
            domSelection.setBaseAndExtent(
              newDomRange.endContainer,
              newDomRange.endOffset,
              newDomRange.endContainer,
              newDomRange.endOffset
            )
          }
        } else if (RangeApi.isBackward(selection!)) {
          domSelection.setBaseAndExtent(
            newDomRange.endContainer,
            newDomRange.endOffset,
            newDomRange.startContainer,
            newDomRange.startOffset
          )
        } else {
          domSelection.setBaseAndExtent(
            newDomRange.startContainer,
            newDomRange.startOffset,
            newDomRange.endContainer,
            newDomRange.endOffset
          )
        }
        if (!shouldSkipSelectionScroll(editor)) {
          scrollSelectionIntoView(editor, newDomRange)
        }
      } else {
        domSelection.removeAllRanges()
      }

      return newDomRange
    }

    // In firefox if there is more then 1 range and we call setDomSelection we remove the ability to select more cells in a table
    if (domSelection.rangeCount <= 1) {
      try {
        setDomSelection()
      } catch (_e) {
        clearUpdatingSelection()
        return
      }
    }

    const ensureSelection =
      androidInputManagerRef.current?.isFlushing() === 'action'

    if (!IS_ANDROID || !ensureSelection) {
      clearUpdatingSelection()
      return
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const animationFrameId = requestAnimationFrame(() => {
      if (ensureSelection) {
        const ensureDomSelection = (forceChange?: boolean) => {
          try {
            const el = ReactEditor.assertDOMNode(editor, editor)
            if (!shouldSkipSelectionFocus(editor)) {
              el.focus()
            }

            setDomSelection(forceChange)
          } catch (_e) {
            // Ignore, dom and state might be out of sync
          }
        }

        // Compat: Android IMEs try to force their selection by manually re-applying it even after we set it.
        // This essentially would make setting the slate selection during an update meaningless, so we force it
        // again here. We can't only do it in the setTimeout after the animation frame since that would cause a
        // visible flicker.
        ensureDomSelection()

        timeoutId = setTimeout(() => {
          // COMPAT: While setting the selection in an animation frame visually correctly sets the selection,
          // it doesn't update GBoards spellchecker state. We have to manually trigger a selection change after
          // the animation frame to ensure it displays the correct state.
          ensureDomSelection(true)
          state.isUpdatingSelection = false
        })
      }
    })

    return () => {
      cancelAnimationFrame(animationFrameId)
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  })

  const syncDOMSelectionToEditor = useCallback(() => {
    executeEditableSelectionExport({
      exportSelection: () => {
        syncEditableDOMSelectionToEditor({
          editor,
          scrollSelectionIntoView,
          partialDOMBackedSelection,
          state,
        })
      },
      selectionPolicy: { kind: 'export-model', reason: 'model-owned' },
    })
  }, [editor, scrollSelectionIntoView, partialDOMBackedSelection, state])

  return { syncDOMSelectionToEditor }
}
