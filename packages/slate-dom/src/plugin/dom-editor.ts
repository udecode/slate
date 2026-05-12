import {
  Node,
  type Path,
  type Point,
  Range,
  type RuntimeId,
  Scrubber,
  Text,
  type Value,
} from 'slate'
import { Editor, getEditorLiveSelection } from 'slate/internal'
import type { TextDiff } from '../utils/diff-text'
import {
  closestShadowAware,
  containsShadowAware,
  type DOMElement,
  type DOMNode,
  type DOMPoint,
  type DOMRange,
  type DOMSelection,
  type DOMStaticRange,
  getSelection,
  isAfter,
  isBefore,
  isDOMElement,
  isDOMNode,
  isDOMSelection,
  isDOMText,
  normalizeDOMPoint,
} from '../utils/dom'
import { IS_ANDROID, IS_FIREFOX } from '../utils/environment'

import { Key } from '../utils/key'
import {
  EDITOR_TO_ELEMENT,
  EDITOR_TO_KEY_TO_ELEMENT,
  EDITOR_TO_PENDING_DIFFS,
  EDITOR_TO_SCHEDULE_FLUSH,
  EDITOR_TO_WINDOW,
  ELEMENT_TO_NODE,
  IS_COMPOSING,
  IS_FOCUSED,
  IS_NODE_MAP_DIRTY,
  IS_READ_ONLY,
  NODE_TO_ELEMENT,
  NODE_TO_INDEX,
  NODE_TO_KEY,
  NODE_TO_PARENT,
  NODE_TO_RUNTIME_ID,
} from '../utils/weak-maps'
import {
  insertDOMData,
  insertDOMFragmentData,
  insertDOMTextData,
  writeDOMSelectionData,
} from './dom-clipboard-runtime'
import { DOMCoverage } from './dom-coverage'

/**
 * A DOM-specific version of the `Editor` interface.
 */

export interface DOMEditor<V extends Value = Value> extends Editor<V> {
  dom: DOMEditorCapability
}

export interface DOMEditorCapability {
  androidPendingDiffs: () => TextDiff[] | undefined
  androidScheduleFlush: () => void
  blur: () => void
  deselect: () => void
  findDocumentOrShadowRoot: () => Document | ShadowRoot
  findEventRange: (event: any) => Range
  findKey: (node: Node) => Key
  findPath: (node: Node) => Path
  focus: (options?: { retries: number }) => void
  getWindow: () => Window
  hasDOMNode: (target: DOMNode, options?: { editable?: boolean }) => boolean
  hasEditableTarget: (target: EventTarget | null) => target is DOMNode
  hasRange: (range: Range) => boolean
  hasSelectableTarget: (target: EventTarget | null) => boolean
  hasTarget: (target: EventTarget | null) => target is DOMNode
  clipboard: DOMEditorClipboardCapability
  isComposing: () => boolean
  isFocused: () => boolean
  isReadOnly: () => boolean
  isTargetInsideNonReadonlyVoid: (target: EventTarget | null) => boolean
  toDOMNode: (node: Node) => HTMLElement
  toDOMPoint: (point: Point) => DOMPoint
  toDOMRange: (range: Range) => DOMRange
  toSlateNode: (domNode: DOMNode) => Node
  toSlatePoint: <T extends boolean>(
    domPoint: DOMPoint,
    options: {
      exactMatch: T
      searchDirection?: 'backward' | 'forward'
      suppressThrow?: boolean
    }
  ) => T extends true ? Point : Point | null
  toSlateRange: <T extends boolean>(
    domRange: DOMRange | DOMSelection | DOMStaticRange | globalThis.Selection,
    options: {
      exactMatch: T
      suppressThrow?: boolean
    }
  ) => T extends true ? Range : Range | null
}

export interface DOMEditorClipboardCapability {
  /**
   * Insert data from a `DataTransfer` into the editor.
   */
  insertData: (data: DataTransfer) => void

  /**
   * Insert fragment data from a `DataTransfer` into the editor.
   */
  insertFragmentData: (data: DataTransfer) => boolean

  /**
   * Insert text data from a `DataTransfer` into the editor.
   */
  insertTextData: (data: DataTransfer) => boolean

  /**
   * Write the current selection to a `DataTransfer`.
   */
  writeSelection: (data: Pick<DataTransfer, 'getData' | 'setData'>) => void
}

export type DOMClipboardInsertDataHandler<V extends Value = Value> = (
  editor: DOMEditor<V>,
  data: DataTransfer
) => boolean | void

export interface DOMEditorClipboardInterface {
  /**
   * Insert data from a `DataTransfer` into the editor.
   */
  insertData: (editor: DOMEditor<any>, data: DataTransfer) => void

  /**
   * Insert fragment data from a `DataTransfer` into the editor.
   */
  insertFragmentData: (editor: DOMEditor<any>, data: DataTransfer) => boolean

  /**
   * Insert text data from a `DataTransfer` into the editor.
   */
  insertTextData: (editor: DOMEditor<any>, data: DataTransfer) => boolean

  /**
   * Write the currently selected fragment to a `DataTransfer`.
   */
  writeSelection: (
    editor: DOMEditor<any>,
    data: Pick<DataTransfer, 'getData' | 'setData'>
  ) => void
}

export interface DOMEditorInterface {
  /**
   * Experimental and android specific: Get pending diffs
   */
  androidPendingDiffs: (editor: Editor<any>) => TextDiff[] | undefined

  /**
   * Experimental and android specific: Flush all pending diffs and cancel composition at the next possible time.
   */
  androidScheduleFlush: (editor: Editor<any>) => void

  /**
   * Blur the editor.
   */
  blur: (editor: DOMEditor<any>) => void

  /**
   * Deselect the editor.
   */
  deselect: (editor: DOMEditor<any>) => void

  /**
   * Find the DOM node that implements DocumentOrShadowRoot for the editor.
   */
  findDocumentOrShadowRoot: (editor: DOMEditor<any>) => Document | ShadowRoot

  /**
   * Get the target range from a DOM `event`.
   */
  findEventRange: (editor: DOMEditor<any>, event: any) => Range

  /**
   * Find a key for a Slate node.
   */
  findKey: (editor: DOMEditor<any>, node: Node) => Key

  /**
   * Find the path of Slate node.
   */
  findPath: (editor: DOMEditor<any>, node: Node) => Path

  /**
   * Focus the editor.
   */
  focus: (editor: DOMEditor<any>, options?: { retries: number }) => void

  /**
   * Return the host window of the current editor.
   */
  getWindow: (editor: DOMEditor<any>) => Window

  /**
   * Check if a DOM node is within the editor.
   */
  hasDOMNode: (
    editor: DOMEditor<any>,
    target: DOMNode,
    options?: { editable?: boolean }
  ) => boolean

  /**
   * Check if the target is editable and in the editor.
   */
  hasEditableTarget: (
    editor: DOMEditor<any>,
    target: EventTarget | null
  ) => target is DOMNode

  /**
   *
   */
  hasRange: (editor: DOMEditor<any>, range: Range) => boolean

  /**
   * Check if the target can be selectable
   */
  hasSelectableTarget: (
    editor: DOMEditor<any>,
    target: EventTarget | null
  ) => boolean

  /**
   * Check if the target is in the editor.
   */
  hasTarget: (
    editor: DOMEditor<any>,
    target: EventTarget | null
  ) => target is DOMNode

  clipboard: DOMEditorClipboardInterface

  /**
   * Check if the user is currently composing inside the editor.
   */
  isComposing: (editor: DOMEditor<any>) => boolean

  /**
   * Check if the editor is focused.
   */
  isFocused: (editor: DOMEditor<any>) => boolean

  /**
   * Check if the editor is in read-only mode.
   */
  isReadOnly: (editor: DOMEditor<any>) => boolean

  /**
   * Check if the target is inside void and in an non-readonly editor.
   */
  isTargetInsideNonReadonlyVoid: (
    editor: DOMEditor<any>,
    target: EventTarget | null
  ) => boolean

  /**
   * Find the native DOM element from a Slate node.
   */
  toDOMNode: (editor: DOMEditor<any>, node: Node) => HTMLElement

  /**
   * Find a native DOM selection point from a Slate point.
   */
  toDOMPoint: (editor: DOMEditor<any>, point: Point) => DOMPoint

  /**
   * Find a native DOM range from a Slate `range`.
   *
   * Notice: the returned range will always be ordinal regardless of the direction of Slate `range` due to DOM API limit.
   *
   * there is no way to create a reverse DOM Range using Range.setStart/setEnd
   * according to https://dom.spec.whatwg.org/#concept-range-bp-set.
   */
  toDOMRange: (editor: DOMEditor<any>, range: Range) => DOMRange

  /**
   * Find a Slate node from a native DOM `element`.
   */
  toSlateNode: (editor: DOMEditor<any>, domNode: DOMNode) => Node

  /**
   * Find a Slate point from a DOM selection's `domNode` and `domOffset`.
   */
  toSlatePoint: <T extends boolean>(
    editor: DOMEditor<any>,
    domPoint: DOMPoint,
    options: {
      exactMatch: boolean
      suppressThrow: T
      /**
       * The direction to search for Slate leaf nodes if `domPoint` is
       * non-editable and non-void.
       */
      searchDirection?: 'forward' | 'backward'
    }
  ) => T extends true ? Point | null : Point

  /**
   * Find a Slate range from a DOM range or selection.
   */
  toSlateRange: <T extends boolean>(
    editor: DOMEditor<any>,
    domRange: DOMRange | DOMStaticRange | DOMSelection,
    options: {
      exactMatch: boolean
      suppressThrow: T
    }
  ) => T extends true ? Range | null : Range
}

const parseSlateDOMPath = (value: string | null): Path | null => {
  if (!value) {
    return null
  }

  const path = value.split(',').map((part) => Number.parseInt(part, 10))

  return path.every(Number.isFinite) ? (path as Path) : null
}

const getSlateDOMRuntimePath = (
  editor: DOMEditor<any>,
  element: HTMLElement
): Path | null => {
  const runtimeId = element.getAttribute(
    'data-slate-runtime-id'
  ) as RuntimeId | null

  return runtimeId ? Editor.getPathByRuntimeId(editor, runtimeId) : null
}

const findMountedDOMNodeByPath = (
  editor: DOMEditor<any>,
  path: Path
): HTMLElement | null => {
  const editorEl = EDITOR_TO_ELEMENT.get(editor)

  if (!editorEl) {
    return null
  }

  const pathAttr = path.join(',')
  const runtimeId = Editor.getRuntimeId(editor, path)
  const elements = Array.from(
    editorEl.querySelectorAll(`[data-slate-path="${pathAttr}"]`)
  )

  const domEl = elements.find(
    (element) =>
      isDOMElement(element) &&
      element.getAttribute('data-slate-node') &&
      (!runtimeId ||
        element.getAttribute('data-slate-runtime-id') === runtimeId)
  )

  return domEl ? (domEl as HTMLElement) : null
}

const toMountedDOMNodeByPath = (
  editor: DOMEditor<any>,
  node: Node
): HTMLElement | null => {
  if (node === editor) {
    return null
  }

  try {
    return findMountedDOMNodeByPath(editor, DOMEditor.findPath(editor, node))
  } catch {
    return null
  }
}

const cacheSlateDOMNode = (
  editor: DOMEditor<any>,
  node: Node,
  domNode: HTMLElement
) => {
  const key = DOMEditor.findKey(editor, node)
  const keyToElement = EDITOR_TO_KEY_TO_ELEMENT.get(editor) ?? new WeakMap()

  if (!EDITOR_TO_KEY_TO_ELEMENT.has(editor)) {
    EDITOR_TO_KEY_TO_ELEMENT.set(editor, keyToElement)
  }

  keyToElement.set(key, domNode)
  ELEMENT_TO_NODE.set(domNode, node)
  NODE_TO_ELEMENT.set(node, domNode)

  return domNode
}

const toSlatePointFromDOMCoverageBoundary = (
  editor: DOMEditor<any>,
  domPoint: DOMPoint
): Point | null => {
  const boundaryPoint = DOMCoverage.toSlatePointFromBoundary(editor, domPoint)

  if (boundaryPoint?.type !== 'boundary-point') {
    return null
  }

  const [coveredRange] = boundaryPoint.boundary.coveredPathRanges
  let targetPath: Path | undefined

  if (boundaryPoint.edge === 'owner') {
    targetPath = boundaryPoint.boundary.ownerPath
  } else if (boundaryPoint.edge === 'focus') {
    targetPath = coveredRange?.focus
  } else {
    targetPath = coveredRange?.anchor
  }

  if (!targetPath || !Editor.hasPath(editor, targetPath)) {
    return null
  }

  return Editor.point(editor, targetPath, {
    edge: boundaryPoint.edge === 'focus' ? 'end' : 'start',
  })
}

const resolveSlateTextPoint = <T extends boolean>({
  domPoint,
  exactMatch,
  offset,
  path,
  slateNode,
  suppressThrow,
}: {
  domPoint: DOMPoint
  exactMatch: boolean
  offset: number
  path: Path
  slateNode: Node
  suppressThrow: T
}): Point | null => {
  if (!Text.isText(slateNode)) {
    return { path, offset }
  }

  const textLength = slateNode.text.length

  if (Number.isFinite(offset) && offset >= 0 && offset <= textLength) {
    return { path, offset }
  }

  if (!exactMatch) {
    const finiteOffset = Number.isFinite(offset) ? offset : 0

    return {
      path,
      offset: Math.max(0, Math.min(textLength, finiteOffset)),
    }
  }

  if (suppressThrow) {
    return null
  }

  throw new Error(`Cannot resolve a Slate point from DOM point: ${domPoint}`)
}

// eslint-disable-next-line no-redeclare
export const DOMEditor: DOMEditorInterface = {
  androidPendingDiffs: (editor) => EDITOR_TO_PENDING_DIFFS.get(editor),

  androidScheduleFlush: (editor) => {
    EDITOR_TO_SCHEDULE_FLUSH.get(editor)?.()
  },

  blur: (editor) => {
    const el = DOMEditor.toDOMNode(editor, editor)
    const root = DOMEditor.findDocumentOrShadowRoot(editor)
    IS_FOCUSED.set(editor, false)

    if (root.activeElement === el) {
      el.blur()
    }
  },

  deselect: (editor) => {
    const selection = editor.read((state) => state.selection.get())
    const root = DOMEditor.findDocumentOrShadowRoot(editor)
    const domSelection = getSelection(root)

    if (domSelection && domSelection.rangeCount > 0) {
      domSelection.removeAllRanges()
    }

    if (selection) {
      editor.update((tx) => {
        tx.selection.clear()
      })
    }
  },

  findDocumentOrShadowRoot: (editor) => {
    const el = DOMEditor.toDOMNode(editor, editor)
    const root = el.getRootNode()

    if (root instanceof Document || root instanceof ShadowRoot) {
      return root
    }

    return el.ownerDocument
  },

  findEventRange: (editor, event) => {
    const resolvedEvent = 'nativeEvent' in event ? event.nativeEvent : event

    const { clientX: x, clientY: y, target } = resolvedEvent

    if (x == null || y == null) {
      throw new Error(`Cannot resolve a Slate range from a DOM event: ${event}`)
    }

    let node: Node | null = null
    let path: Path | null = null

    try {
      node = DOMEditor.toSlateNode(editor, event.target)
      path = DOMEditor.findPath(editor, node)
    } catch (error) {
      if (!isDOMNode(target) || !DOMEditor.hasDOMNode(editor, target)) {
        throw error
      }
    }

    // If the drop target is inside a void node, move it into either the
    // next or previous node, depending on which side the `x` and `y`
    // coordinates are closest to.
    if (node && path && Node.isElement(node) && Editor.isVoid(editor, node)) {
      const rect = target.getBoundingClientRect()
      const isPrev = Editor.isInline(editor, node)
        ? x - rect.left < rect.left + rect.width - x
        : y - rect.top < rect.top + rect.height - y

      const edge = Editor.point(editor, path, {
        edge: isPrev ? 'start' : 'end',
      })
      const point = isPrev
        ? Editor.before(editor, edge)
        : Editor.after(editor, edge)

      if (point) {
        const range = Editor.range(editor, point)
        return range
      }
    }

    // Else resolve a range from the caret position where the drop occured.
    let domRange: globalThis.Range | null = null
    const { document } = DOMEditor.getWindow(editor)

    // COMPAT: In Firefox, `caretRangeFromPoint` doesn't exist. (2016/07/25)
    if (document.caretRangeFromPoint) {
      domRange = document.caretRangeFromPoint(x, y)
    } else {
      const position = document.caretPositionFromPoint(x, y)

      if (position) {
        domRange = document.createRange()
        domRange.setStart(position.offsetNode, position.offset)
        domRange.setEnd(position.offsetNode, position.offset)
      }
    }

    if (!domRange) {
      throw new Error(`Cannot resolve a Slate range from a DOM event: ${event}`)
    }

    // Resolve a Slate range from the DOM range.
    const range = DOMEditor.toSlateRange(editor, domRange, {
      exactMatch: false,
      suppressThrow: false,
    })
    return range
  },

  findKey: (editor, node) => {
    let key = NODE_TO_KEY.get(node)

    if (!key) {
      key = new Key()
      NODE_TO_KEY.set(node, key)
    }

    return key
  },

  findPath: (editor, node) => {
    const runtimeId = NODE_TO_RUNTIME_ID.get(node)
    const runtimePath = runtimeId
      ? Editor.getPathByRuntimeId(editor, runtimeId)
      : null

    if (runtimePath) {
      return runtimePath
    }

    const path: Path = []
    let child = node

    while (true) {
      const parent = NODE_TO_PARENT.get(child)

      if (parent == null) {
        if (child === editor) {
          return path
        }
        break
      }

      const i = NODE_TO_INDEX.get(child)

      if (i == null) {
        break
      }

      path.unshift(i)
      child = parent
    }

    throw new Error(
      `Unable to find the path for Slate node: ${Scrubber.stringify(node)}`
    )
  },

  focus: (editor, options = { retries: 50 }) => {
    // Return if already focused
    if (IS_FOCUSED.get(editor)) {
      return
    }

    // Return if no dom node is associated with the editor, which means the editor is not yet mounted
    // or has been unmounted. This can happen especially, while retrying to focus the editor.
    if (!EDITOR_TO_ELEMENT.get(editor)) {
      return
    }

    // Retry setting focus if the editor has pending operations.
    // The DOM (selection) is unstable while changes are applied.
    // Retry until retries are exhausted or editor is focused.
    if (options.retries <= 0) {
      throw new Error(
        'Could not set focus, editor seems stuck with pending operations'
      )
    }
    if (IS_NODE_MAP_DIRTY.get(editor)) {
      setTimeout(() => {
        DOMEditor.focus(editor, { retries: options.retries - 1 })
      }, 10)
      return
    }

    const el = DOMEditor.toDOMNode(editor, editor)
    const root = DOMEditor.findDocumentOrShadowRoot(editor)
    const selectionAtFocus = getEditorLiveSelection(editor)
      ? {
          anchor: { ...getEditorLiveSelection(editor)!.anchor },
          focus: { ...getEditorLiveSelection(editor)!.focus },
        }
      : null
    // Create a new selection in the top of the document if missing
    if (!getEditorLiveSelection(editor)) {
      editor.update((tx) => {
        tx.selection.set(Editor.point(editor, [], { edge: 'start' }))
      })
    }

    const syncDomSelection = () => {
      const selection = getEditorLiveSelection(editor)

      if (selection && root instanceof Document) {
        const domSelection = getSelection(root)
        const domRange = DOMEditor.toDOMRange(editor, selection)

        if (domSelection) {
          if (Range.isBackward(selection)) {
            domSelection.setBaseAndExtent(
              domRange.endContainer,
              domRange.endOffset,
              domRange.startContainer,
              domRange.startOffset
            )
          } else {
            domSelection.setBaseAndExtent(
              domRange.startContainer,
              domRange.startOffset,
              domRange.endContainer,
              domRange.endOffset
            )
          }
        }
      }
    }
    const trySyncDomSelection = () => {
      try {
        syncDomSelection()
        return true
      } catch {
        return false
      }
    }

    if (root.activeElement !== el) {
      // IS_FOCUSED should be set before calling el.focus() to ensure that
      // FocusedContext is updated to the correct value
      IS_FOCUSED.set(editor, true)
      el.focus({ preventScroll: true })
      trySyncDomSelection()
      if (selectionAtFocus && root instanceof Document) {
        queueMicrotask(() => {
          if (root.activeElement !== el) {
            return
          }

          if (
            !getEditorLiveSelection(editor) ||
            !Range.equals(getEditorLiveSelection(editor)!, selectionAtFocus)
          ) {
            return
          }

          trySyncDomSelection()
        })
      }
      return
    }

    IS_FOCUSED.set(editor, true)
    trySyncDomSelection()
  },

  getWindow: (editor) => {
    const window = EDITOR_TO_WINDOW.get(editor)
    if (!window) {
      throw new Error('Unable to find a host window element for this editor')
    }
    return window
  },

  hasDOMNode: (editor, target, options = {}) => {
    const { editable = false } = options
    const editorEl = DOMEditor.toDOMNode(editor, editor)
    let targetEl: HTMLElement | null | undefined

    // COMPAT: In Firefox, reading `target.nodeType` will throw an error if
    // target is originating from an internal "restricted" element (e.g. a
    // stepper arrow on a number input). (2018/05/04)
    // https://github.com/ianstormtaylor/slate/issues/1819
    try {
      targetEl = (
        isDOMElement(target) ? target : target.parentElement
      ) as HTMLElement
    } catch (err) {
      if (
        err instanceof Error &&
        !err.message.includes('Permission denied to access property "nodeType"')
      ) {
        throw err
      }
    }

    if (!targetEl) {
      return false
    }

    return (
      closestShadowAware(targetEl, '[data-slate-editor]') === editorEl &&
      (!editable || targetEl.isContentEditable
        ? true
        : (typeof targetEl.isContentEditable === 'boolean' && // isContentEditable exists only on HTMLElement, and on other nodes it will be undefined
            // this is the core logic that lets you know you got the right editor.selection instead of null when editor is contenteditable="false"(readOnly)
            closestShadowAware(targetEl, '[contenteditable="false"]') ===
              editorEl) ||
          !!targetEl.getAttribute('data-slate-zero-width'))
    )
  },

  hasEditableTarget: (editor, target): target is DOMNode =>
    isDOMNode(target) &&
    DOMEditor.hasDOMNode(editor, target, { editable: true }),

  hasRange: (editor, range) => {
    const { anchor, focus } = range
    return (
      Editor.hasPath(editor, anchor.path) && Editor.hasPath(editor, focus.path)
    )
  },

  hasSelectableTarget: (editor, target) =>
    DOMEditor.hasEditableTarget(editor, target) ||
    DOMEditor.isTargetInsideNonReadonlyVoid(editor, target),

  hasTarget: (editor, target): target is DOMNode =>
    isDOMNode(target) && DOMEditor.hasDOMNode(editor, target),

  clipboard: {
    insertData: (editor, data) => {
      insertDOMData(editor, data)
    },

    insertFragmentData: (editor, data) => insertDOMFragmentData(editor, data),

    insertTextData: (editor, data) => insertDOMTextData(editor, data),

    writeSelection: (editor, data) => {
      writeDOMSelectionData(editor, data)
    },
  },

  isComposing: (editor) => {
    return !!IS_COMPOSING.get(editor)
  },

  isFocused: (editor) => !!IS_FOCUSED.get(editor),

  isReadOnly: (editor) => !!IS_READ_ONLY.get(editor),

  isTargetInsideNonReadonlyVoid: (editor, target) => {
    if (IS_READ_ONLY.get(editor)) return false
    if (!DOMEditor.hasTarget(editor, target)) return false

    let slateNode: Node
    try {
      slateNode = DOMEditor.toSlateNode(editor, target)
    } catch {
      return false
    }

    return Node.isElement(slateNode) && Editor.isVoid(editor, slateNode)
  },

  toDOMNode: (editor, node) => {
    const domNode =
      node === editor
        ? EDITOR_TO_ELEMENT.get(editor)
        : EDITOR_TO_KEY_TO_ELEMENT.get(editor)?.get(
            DOMEditor.findKey(editor, node)
          )

    if (domNode) {
      return domNode
    }

    const fallbackDOMNode = toMountedDOMNodeByPath(editor, node)

    if (fallbackDOMNode) {
      return cacheSlateDOMNode(editor, node, fallbackDOMNode)
    }

    throw new Error(
      `Cannot resolve a DOM node from Slate node: ${Scrubber.stringify(node)}`
    )
  },

  toDOMPoint: (editor, point) => {
    const resolvedPoint = Editor.void(editor, { at: point })
      ? { path: point.path, offset: 0 }
      : point
    const [node] = editor.read((state) => state.nodes.get(resolvedPoint.path))
    let el: HTMLElement

    try {
      el = DOMEditor.toDOMNode(editor, node)
    } catch (error) {
      const fallbackDOMNode = findMountedDOMNodeByPath(
        editor,
        resolvedPoint.path
      )

      if (!fallbackDOMNode) {
        throw error
      }

      el = cacheSlateDOMNode(editor, node, fallbackDOMNode)
    }

    let domPoint: DOMPoint | undefined

    // For each leaf, we need to isolate its content, which means filtering
    // to its direct text and zero-width spans. (We have to filter out any
    // other siblings that may have been rendered alongside them.)
    const selector = '[data-slate-string], [data-slate-zero-width]'
    const texts = Array.from(el.querySelectorAll(selector))
    let start = 0

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i]
      const domNode = text.childNodes[0] as HTMLElement

      if (domNode == null || domNode.textContent == null) {
        continue
      }

      const { length } = domNode.textContent
      const attr = text.getAttribute('data-slate-length')
      const trueLength = attr == null ? length : Number.parseInt(attr, 10)
      const end = start + trueLength

      // Prefer putting the selection inside the mark placeholder to ensure
      // composed text is displayed with the correct marks.
      const nextText = texts[i + 1]
      if (
        resolvedPoint.offset === end &&
        nextText?.hasAttribute('data-slate-mark-placeholder')
      ) {
        const domText = nextText.childNodes[0]

        domPoint = [
          // COMPAT: If we don't explicity set the dom point to be on the
          // actual dom text element, chrome will put the selection behind
          // the actual dom text element, causing
          // domRange.getBoundingClientRect() calls on a collapsed selection
          // to return incorrect zero values
          // (https://bugs.chromium.org/p/chromium/issues/detail?id=435438)
          // which will cause issues when scrolling to it.
          isDOMText(domText) ? domText : nextText,
          nextText.textContent?.startsWith('\uFEFF') ? 1 : 0,
        ]
        break
      }

      if (resolvedPoint.offset <= end) {
        const offset = Math.min(
          length,
          Math.max(0, resolvedPoint.offset - start)
        )
        domPoint = [domNode, offset]
        break
      }

      start = end
    }

    if (!domPoint) {
      throw new Error(
        `Cannot resolve a DOM point from Slate point: ${Scrubber.stringify(
          resolvedPoint
        )}`
      )
    }

    return domPoint
  },

  toDOMRange: (editor, range) => {
    const { anchor, focus } = range
    const isBackward = Range.isBackward(range)
    const domAnchor = DOMEditor.toDOMPoint(editor, anchor)
    const domFocus = Range.isCollapsed(range)
      ? domAnchor
      : DOMEditor.toDOMPoint(editor, focus)

    const window = DOMEditor.getWindow(editor)
    const domRange = window.document.createRange()
    const [startNode, startOffset] = isBackward ? domFocus : domAnchor
    const [endNode, endOffset] = isBackward ? domAnchor : domFocus

    // A slate Point at zero-width Leaf always has an offset of 0 but a native DOM selection at
    // zero-width node has an offset of 1 so we have to check if we are in a zero-width node and
    // adjust the offset accordingly.
    const startEl = (
      isDOMElement(startNode) ? startNode : startNode.parentElement
    ) as HTMLElement
    const isStartAtZeroWidth = !!startEl.getAttribute('data-slate-zero-width')
    const endEl = (
      isDOMElement(endNode) ? endNode : endNode.parentElement
    ) as HTMLElement
    const isEndAtZeroWidth = !!endEl.getAttribute('data-slate-zero-width')

    domRange.setStart(startNode, isStartAtZeroWidth ? 1 : startOffset)
    domRange.setEnd(endNode, isEndAtZeroWidth ? 1 : endOffset)
    return domRange
  },

  toSlateNode: (editor, domNode) => {
    let domEl = isDOMElement(domNode) ? domNode : domNode.parentElement

    if (domEl && !domEl.hasAttribute('data-slate-node')) {
      domEl = domEl.closest('[data-slate-node]')
    }

    const belongsToEditor =
      domEl && DOMEditor.hasDOMNode(editor, domEl as HTMLElement)
    const node = belongsToEditor
      ? ELEMENT_TO_NODE.get(domEl as HTMLElement)
      : null

    if (node) {
      return node
    }

    const fallbackPath =
      domEl && belongsToEditor
        ? (getSlateDOMRuntimePath(editor, domEl as HTMLElement) ??
          parseSlateDOMPath(domEl.getAttribute('data-slate-path')))
        : null

    if (fallbackPath && Editor.hasPath(editor, fallbackPath)) {
      const [fallbackNode] = editor.read((state) =>
        state.nodes.get(fallbackPath)
      )
      const fallbackElement = domEl as HTMLElement
      const key = DOMEditor.findKey(editor, fallbackNode)
      const keyToElement = EDITOR_TO_KEY_TO_ELEMENT.get(editor) ?? new WeakMap()

      if (!EDITOR_TO_KEY_TO_ELEMENT.has(editor)) {
        EDITOR_TO_KEY_TO_ELEMENT.set(editor, keyToElement)
      }

      keyToElement.set(key, fallbackElement)
      ELEMENT_TO_NODE.set(fallbackElement, fallbackNode)
      NODE_TO_ELEMENT.set(fallbackNode, fallbackElement)

      return fallbackNode
    }

    throw new Error(`Cannot resolve a Slate node from DOM node: ${domEl}`)
  },

  toSlatePoint: <T extends boolean>(
    editor: DOMEditor<any>,
    domPoint: DOMPoint,
    options: {
      exactMatch: boolean
      suppressThrow: T
      searchDirection?: 'forward' | 'backward'
    }
  ): T extends true ? Point | null : Point => {
    const { exactMatch, suppressThrow } = options
    const boundarySlatePoint = toSlatePointFromDOMCoverageBoundary(
      editor,
      domPoint
    )

    if (boundarySlatePoint) {
      return boundarySlatePoint as T extends true ? Point | null : Point
    }

    const [nearestNode, nearestOffset] = exactMatch
      ? domPoint
      : normalizeDOMPoint(domPoint)
    const parentNode = nearestNode.parentNode as DOMElement
    let searchDirection = options.searchDirection
    let textNode: DOMElement | null = null
    let offset = 0

    if (parentNode) {
      const editorEl = DOMEditor.toDOMNode(editor, editor)
      const potentialVoidNode = parentNode.closest('[data-slate-void="true"]')
      // Need to ensure that the closest void node is actually a void node
      // within this editor, and not a void node within some parent editor. This can happen
      // if this editor is within a void node of another editor ("nested editors", like in
      // the "Editable Voids" example on the docs site).
      const voidNode =
        potentialVoidNode && containsShadowAware(editorEl, potentialVoidNode)
          ? potentialVoidNode
          : null
      const potentialNonEditableNode = parentNode.closest(
        '[contenteditable="false"]'
      )
      const nonEditableNode =
        potentialNonEditableNode &&
        containsShadowAware(editorEl, potentialNonEditableNode)
          ? potentialNonEditableNode
          : null
      let leafNode = parentNode.closest('[data-slate-leaf]')
      let domNode: DOMElement | null = null

      // Calculate how far into the text node the `nearestNode` is, so that we
      // can determine what the offset relative to the text node is.
      if (leafNode) {
        textNode = leafNode.closest('[data-slate-node="text"]')

        if (textNode) {
          const window = DOMEditor.getWindow(editor)
          const range = window.document.createRange()
          range.setStart(textNode, 0)
          range.setEnd(nearestNode, nearestOffset)

          const contents = range.cloneContents()
          const removals = [
            ...Array.prototype.slice.call(
              contents.querySelectorAll('[data-slate-zero-width]')
            ),
            ...Array.prototype.slice.call(
              contents.querySelectorAll('[contenteditable=false]')
            ),
          ]

          removals.forEach((el) => {
            // COMPAT: While composing at the start of a text node, some keyboards put
            // the text content inside the zero width space.
            if (
              IS_ANDROID &&
              !exactMatch &&
              el.hasAttribute('data-slate-zero-width') &&
              el.textContent.length > 0 &&
              el.textContext !== '\uFEFF'
            ) {
              if (el.textContent.startsWith('\uFEFF')) {
                el.textContent = el.textContent.slice(1)
              }

              return
            }

            el!.parentNode!.removeChild(el)
          })

          // COMPAT: Edge has a bug where Range.prototype.toString() will
          // convert \n into \r\n. The bug causes a loop when slate-dom
          // attempts to reposition its cursor to match the native position. Use
          // textContent.length instead.
          // https://developer.microsoft.com/en-us/microsoft-edge/platform/issues/10291116/
          offset = contents.textContent!.length
          domNode = textNode
        }
      } else if (voidNode) {
        // For void nodes, the element with the offset key will be a cousin, not an
        // ancestor, so find it by going down from the nearest void parent and taking the
        // first one that isn't inside a nested editor.
        const leafNodes = voidNode.querySelectorAll('[data-slate-leaf]')
        for (const current of leafNodes) {
          if (DOMEditor.hasDOMNode(editor, current)) {
            leafNode = current
            break
          }
        }

        // COMPAT: In read-only editors the leaf is not rendered.
        if (leafNode) {
          textNode = leafNode.closest('[data-slate-node="text"]')!
          domNode = leafNode
          offset = domNode.textContent!.length
          domNode.querySelectorAll('[data-slate-zero-width]').forEach((el) => {
            offset -= el.textContent!.length
          })
        } else {
          offset = 1
        }
      } else if (nonEditableNode) {
        const boundarySlatePoint = toSlatePointFromDOMCoverageBoundary(editor, [
          nonEditableNode,
          0,
        ])

        if (boundarySlatePoint) {
          return boundarySlatePoint as T extends true ? Point | null : Point
        }

        // Find the edge of the nearest leaf in `searchDirection`
        const getLeafNodes = (node: DOMElement | null | undefined) =>
          node
            ? node.querySelectorAll(
                // Exclude leaf nodes in nested editors
                '[data-slate-leaf]:not(:scope [data-slate-editor] [data-slate-leaf])'
              )
            : []
        const elementNode = nonEditableNode.closest(
          '[data-slate-node="element"]'
        )

        if (searchDirection === 'backward' || !searchDirection) {
          const leafNodes = [
            ...getLeafNodes(elementNode?.previousElementSibling),
            ...getLeafNodes(elementNode),
          ]

          leafNode =
            leafNodes.findLast((leaf) => isBefore(nonEditableNode, leaf)) ??
            null

          if (leafNode) {
            searchDirection = 'backward'
          }
        }

        if (searchDirection === 'forward' || !searchDirection) {
          const leafNodes = [
            ...getLeafNodes(elementNode),
            ...getLeafNodes(elementNode?.nextElementSibling),
          ]

          leafNode =
            leafNodes.find((leaf) => isAfter(nonEditableNode, leaf)) ?? null

          if (leafNode) {
            searchDirection = 'forward'
          }
        }

        if (leafNode) {
          textNode = leafNode.closest('[data-slate-node="text"]')!
          domNode = leafNode
          if (searchDirection === 'forward') {
            offset = 0
          } else {
            offset = domNode.textContent!.length
            domNode
              .querySelectorAll('[data-slate-zero-width]')
              .forEach((el) => {
                offset -= el.textContent!.length
              })
          }
        }
      }

      if (
        domNode &&
        offset === domNode.textContent!.length &&
        // COMPAT: Android IMEs might remove the zero width space while composing,
        // and we don't add it for line-breaks.
        IS_ANDROID &&
        domNode.getAttribute('data-slate-zero-width') === 'z' &&
        domNode.textContent?.startsWith('\uFEFF') &&
        // COMPAT: If the parent node is a Slate zero-width space, editor is
        // because the text node should have no characters. However, during IME
        // composition the ASCII characters will be prepended to the zero-width
        // space, so subtract 1 from the offset to account for the zero-width
        // space character.
        (parentNode.hasAttribute('data-slate-zero-width') ||
          // COMPAT: In Firefox, `range.cloneContents()` returns an extra trailing '\n'
          // when the document ends with a new-line character. This results in the offset
          // length being off by one, so we need to subtract one to account for this.
          (IS_FIREFOX && domNode.textContent?.endsWith('\n\n')))
      ) {
        offset--
      }
    }

    if (IS_ANDROID && !textNode && !exactMatch) {
      const node = parentNode.hasAttribute('data-slate-node')
        ? parentNode
        : parentNode.closest('[data-slate-node]')

      if (node && DOMEditor.hasDOMNode(editor, node, { editable: true })) {
        let slateNode: Node
        let nodePath: Path
        try {
          slateNode = DOMEditor.toSlateNode(editor, node)
          nodePath = DOMEditor.findPath(editor, slateNode)
        } catch (e) {
          if (suppressThrow) {
            return null as T extends true ? Point | null : Point
          }
          throw e
        }
        let { path, offset } = Editor.point(editor, nodePath, {
          edge: 'start',
        })

        if (!node.querySelector('[data-slate-leaf]')) {
          offset = nearestOffset
        }

        return { path, offset } as T extends true ? Point | null : Point
      }
    }

    if (!textNode) {
      if (suppressThrow) {
        return null as T extends true ? Point | null : Point
      }
      throw new Error(
        `Cannot resolve a Slate point from DOM point: ${domPoint}`
      )
    }

    // COMPAT: If someone is clicking from one Slate editor into another,
    // the select event fires twice, once for the old editor's `element`
    // first, and then afterwards for the correct `element`. (2017/03/03)
    let slateNode: Node
    let path: Path
    try {
      slateNode = DOMEditor.toSlateNode(editor, textNode!)
      path = DOMEditor.findPath(editor, slateNode)
    } catch (e) {
      const fallbackPath = parseSlateDOMPath(
        textNode?.getAttribute('data-slate-path') ?? null
      )

      if (fallbackPath && Editor.hasPath(editor, fallbackPath)) {
        const [fallbackNode] = editor.read((state) =>
          state.nodes.get(fallbackPath)
        )
        const point = resolveSlateTextPoint({
          domPoint,
          exactMatch,
          offset,
          path: fallbackPath,
          slateNode: fallbackNode,
          suppressThrow,
        })

        return point as T extends true ? Point | null : Point
      }

      if (suppressThrow) {
        return null as T extends true ? Point | null : Point
      }
      throw e
    }
    const point = resolveSlateTextPoint({
      domPoint,
      exactMatch,
      offset,
      path,
      slateNode,
      suppressThrow,
    })

    return point as T extends true ? Point | null : Point
  },

  toSlateRange: <T extends boolean>(
    editor: DOMEditor<any>,
    domRange: DOMRange | DOMStaticRange | DOMSelection,
    options: {
      exactMatch: boolean
      suppressThrow: T
    }
  ): T extends true ? Range | null : Range => {
    const { exactMatch, suppressThrow } = options
    const el = isDOMSelection(domRange)
      ? domRange.anchorNode
      : domRange.startContainer
    let anchorNode: globalThis.Node | null = null
    let anchorOffset = 0
    let focusNode: globalThis.Node | null = null
    let focusOffset = 0
    let isCollapsed = false

    if (el) {
      if (isDOMSelection(domRange)) {
        // COMPAT: In firefox the normal seletion way does not work
        // (https://github.com/ianstormtaylor/slate/pull/5486#issue-1820720223)
        if (IS_FIREFOX && domRange.rangeCount > 1) {
          focusNode = domRange.focusNode // Focus node works fine
          const firstRange = domRange.getRangeAt(0)
          const lastRange = domRange.getRangeAt(domRange.rangeCount - 1)

          // Here we are in the contenteditable mode of a table in firefox
          if (
            focusNode instanceof HTMLTableRowElement &&
            firstRange.startContainer instanceof HTMLTableRowElement &&
            lastRange.startContainer instanceof HTMLTableRowElement
          ) {
            // HTMLElement, becouse Element is a slate element
            function getLastChildren(element: HTMLElement): HTMLElement {
              if (element.childElementCount > 0) {
                return getLastChildren(<HTMLElement>element.children[0])
              }
              return element
            }

            const firstNodeRow = <HTMLTableRowElement>firstRange.startContainer
            const lastNodeRow = <HTMLTableRowElement>lastRange.startContainer

            // This should never fail as "The HTMLElement interface represents any HTML element."
            const firstNode = getLastChildren(
              <HTMLElement>firstNodeRow.children[firstRange.startOffset]
            )
            const lastNode = getLastChildren(
              <HTMLElement>lastNodeRow.children[lastRange.startOffset]
            )

            // Zero, as we allways take the right one as the anchor point
            focusOffset = 0

            if (lastNode.childNodes.length > 0) {
              anchorNode = lastNode.childNodes[0]
            } else {
              anchorNode = lastNode
            }

            if (firstNode.childNodes.length > 0) {
              focusNode = firstNode.childNodes[0]
            } else {
              focusNode = firstNode
            }

            if (lastNode instanceof HTMLElement) {
              anchorOffset = (<HTMLElement>lastNode).innerHTML.length
            } else {
              // Fallback option
              anchorOffset = 0
            }
          } else if (firstRange.startContainer === focusNode) {
            // This is the read only mode of a firefox table
            // Right to left
            anchorNode = lastRange.endContainer
            anchorOffset = lastRange.endOffset
            focusOffset = firstRange.startOffset
          } else {
            // Left to right
            anchorNode = firstRange.startContainer
            anchorOffset = firstRange.endOffset
            focusOffset = lastRange.startOffset
          }
        } else {
          anchorNode = domRange.anchorNode
          anchorOffset = domRange.anchorOffset
          focusNode = domRange.focusNode
          focusOffset = domRange.focusOffset
        }

        // Endpoint equality is the only collapsed signal Slate can trust across
        // browser timing windows. Some engines expose stale `isCollapsed` while
        // anchor/focus already describe an expanded selection.
        isCollapsed =
          domRange.anchorNode === domRange.focusNode &&
          domRange.anchorOffset === domRange.focusOffset
      } else {
        anchorNode = domRange.startContainer
        anchorOffset = domRange.startOffset
        focusNode = domRange.endContainer
        focusOffset = domRange.endOffset
        isCollapsed = domRange.collapsed
      }
    }

    if (
      anchorNode == null ||
      focusNode == null ||
      anchorOffset == null ||
      focusOffset == null
    ) {
      if (suppressThrow) {
        return null as T extends true ? Range | null : Range
      }

      throw new Error(
        `Cannot resolve a Slate range from DOM range: ${domRange}`
      )
    }

    // COMPAT: Firefox sometimes includes an extra \n (rendered by TextString
    // when isTrailing is true) in the focusOffset, resulting in an invalid
    // Slate point. (2023/11/01)
    if (
      IS_FIREFOX &&
      focusNode.textContent?.endsWith('\n\n') &&
      focusOffset === focusNode.textContent.length
    ) {
      focusOffset--
    }

    const anchor = DOMEditor.toSlatePoint(editor, [anchorNode, anchorOffset], {
      exactMatch,
      suppressThrow,
    })
    if (!anchor) {
      return null as T extends true ? Range | null : Range
    }

    const focusBeforeAnchor =
      isBefore(anchorNode, focusNode) ||
      (anchorNode === focusNode && focusOffset < anchorOffset)
    const focus = isCollapsed
      ? anchor
      : DOMEditor.toSlatePoint(editor, [focusNode, focusOffset], {
          exactMatch,
          suppressThrow,
          searchDirection: focusBeforeAnchor ? 'forward' : 'backward',
        })
    if (!focus) {
      return null as T extends true ? Range | null : Range
    }

    let range: Range = { anchor: anchor as Point, focus: focus as Point }
    // if the selection is a hanging range that ends in a void
    // and the DOM focus is an Element
    // (meaning that the selection ends before the element)
    // unhang the range to avoid mistakenly including the void
    if (
      Range.isExpanded(range) &&
      Range.isForward(range) &&
      isDOMElement(focusNode) &&
      Editor.void(editor, { at: range.focus, mode: 'highest' })
    ) {
      range = Editor.unhangRange(editor, range, { voids: true })
    }

    return range as unknown as T extends true ? Range | null : Range
  },
}

export const createDOMEditorCapability = (
  editor: DOMEditor<any>
): DOMEditorCapability => {
  const capability: DOMEditorCapability = {
    androidPendingDiffs: () => DOMEditor.androidPendingDiffs(editor),
    androidScheduleFlush: () => DOMEditor.androidScheduleFlush(editor),
    blur: () => DOMEditor.blur(editor),
    deselect: () => DOMEditor.deselect(editor),
    findDocumentOrShadowRoot: () => DOMEditor.findDocumentOrShadowRoot(editor),
    findEventRange: (event) => DOMEditor.findEventRange(editor, event),
    findKey: (node) => DOMEditor.findKey(editor, node),
    findPath: (node) => DOMEditor.findPath(editor, node),
    focus: (options) => DOMEditor.focus(editor, options),
    getWindow: () => DOMEditor.getWindow(editor),
    hasDOMNode: (target, options) =>
      DOMEditor.hasDOMNode(editor, target, options),
    hasEditableTarget: (target) => DOMEditor.hasEditableTarget(editor, target),
    hasRange: (range) => DOMEditor.hasRange(editor, range),
    hasSelectableTarget: (target) =>
      DOMEditor.hasSelectableTarget(editor, target),
    hasTarget: (target) => DOMEditor.hasTarget(editor, target),
    clipboard: Object.freeze({
      insertData: (data: DataTransfer) =>
        DOMEditor.clipboard.insertData(editor, data),
      insertFragmentData: (data: DataTransfer) =>
        DOMEditor.clipboard.insertFragmentData(editor, data),
      insertTextData: (data: DataTransfer) =>
        DOMEditor.clipboard.insertTextData(editor, data),
      writeSelection: (data: Pick<DataTransfer, 'getData' | 'setData'>) =>
        DOMEditor.clipboard.writeSelection(editor, data),
    }),
    isComposing: () => DOMEditor.isComposing(editor),
    isFocused: () => DOMEditor.isFocused(editor),
    isReadOnly: () => DOMEditor.isReadOnly(editor),
    isTargetInsideNonReadonlyVoid: (target) =>
      DOMEditor.isTargetInsideNonReadonlyVoid(editor, target),
    toDOMNode: (node) => DOMEditor.toDOMNode(editor, node),
    toDOMPoint: (point) => DOMEditor.toDOMPoint(editor, point),
    toDOMRange: (range) => DOMEditor.toDOMRange(editor, range),
    toSlateNode: (domNode) => DOMEditor.toSlateNode(editor, domNode),
    toSlatePoint: <T extends boolean>(
      domPoint: DOMPoint,
      options: {
        exactMatch: T
        searchDirection?: 'backward' | 'forward'
        suppressThrow?: boolean
      }
    ) =>
      DOMEditor.toSlatePoint(editor, domPoint, {
        ...options,
        suppressThrow: options.suppressThrow ?? false,
      }) as T extends true ? Point : Point | null,
    toSlateRange: <T extends boolean>(
      domRange: DOMRange | DOMSelection | DOMStaticRange | globalThis.Selection,
      options: {
        exactMatch: T
        suppressThrow?: boolean
      }
    ) =>
      DOMEditor.toSlateRange(editor, domRange, {
        ...options,
        suppressThrow: options.suppressThrow ?? false,
      }) as T extends true ? Range : Range | null,
  }

  return Object.freeze(capability)
}
