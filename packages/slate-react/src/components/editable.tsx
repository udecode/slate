import type React from 'react'
import {
  type Element,
  type LeafPosition,
  type Range,
  RangeApi,
  type RuntimeId,
  type Text,
} from 'slate'
import {
  CAN_USE_DOM,
  type DOMRange,
  HAS_BEFORE_INPUT_SUPPORT,
  IS_ANDROID,
  isDOMNode,
} from 'slate-dom'
import { DOMCoverage } from 'slate-dom/internal'
import type {
  EditableRepairRequest,
  InputIntent,
} from '../editable/input-controller'
import { useEditableRootRuntime } from '../editable/runtime-root-engine'
import { readLiveSelection } from '../editable/runtime-selection-state'
import { useEditor } from '../hooks/use-editor'
import { ComposingContext } from '../hooks/use-editor-composing'
import { ReadOnlyContext } from '../hooks/use-editor-read-only'
import { useIsomorphicLayoutEffect } from '../hooks/use-isomorphic-layout-effect'
import type { ReactRuntimeEditor } from '../plugin/react-editor'
import { recordSlateReactRender } from '../render-profiler'
import type { MountedTopLevelRange } from '../rendering-strategy/rendering-strategy-commands'
import { RestoreDOM } from './restore-dom/restore-dom'

/**
 * `RenderElementProps` are passed to the `renderElement` handler.
 */

export interface RenderElementProps<TElement extends Element = any> {
  children: any
  element: TElement
  attributes: {
    'data-slate-node': 'element'
    'data-slate-inline'?: true
    'data-slate-void'?: true
    dir?: 'rtl'
    ref: any
  }
}

/**
 * `RenderLeafProps` are passed to the `renderLeaf` handler.
 */

export interface RenderLeafProps<TText extends Text = any> {
  children: any
  /**
   * The leaf node with any applied decorations.
   * If no decorations are applied, it will be identical to the `text` property.
   */
  leaf: TText
  text: TText
  attributes: {
    'data-slate-leaf': true
  }
  /**
   * The position of the leaf within the Text node, only present when the text node is split by decorations.
   */
  leafPosition?: LeafPosition
}

/**
 * `RenderTextProps` are passed to the `renderText` handler.
 */
export interface RenderTextProps {
  text: Text
  children: any
  attributes: {
    'data-slate-node': 'text'
    ref: any
  }
}

/**
 * `EditableProps` are passed to the `<Editable>` component.
 */

export type EditableDOMRootProps = {
  children?: React.ReactNode
  renderingStrategy?: {
    mountedTopLevelRuntimeIds: ReadonlySet<RuntimeId> | null
    mountedTopLevelRanges?: readonly MountedTopLevelRange[]
    type: 'staged' | 'shell' | 'virtualized'
  } | null
  renderingStrategyMetrics?: EditableRenderingStrategyMetricsBase | null
  onDOMBeforeInput?: EditableDOMBeforeInputHandler
  onKeyDown?: EditableKeyDownHandler
  onRenderingStrategyMetrics?: (
    metrics: EditableRenderingStrategyMetrics
  ) => void
  readOnly?: boolean
  scrollSelectionIntoView?: (
    editor: ReactRuntimeEditor,
    domRange: DOMRange
  ) => void
  as?: React.ElementType
  disableDefaultStyles?: boolean
} & Omit<React.ComponentPropsWithRef<'div'>, 'children' | 'onKeyDown'>

export type EditableRenderingStrategyCohort =
  | 'normal'
  | 'medium'
  | 'large'
  | 'stress'
  | 'pathological'

export type EditableRenderingStrategyEffectiveType =
  | 'full'
  | 'plain'
  | 'staged'
  | 'virtualized'
  | 'shell'

export type EditableRenderingStrategyDegradationMode =
  | 'none'
  | 'staged-warmup'
  | 'shell'
  | 'virtualized'

export type EditableRenderingStrategyMetricsBase = {
  activeSegmentIndex: number | null
  overscan: number | null
  cohort: EditableRenderingStrategyCohort
  degradationMode: EditableRenderingStrategyDegradationMode
  documentSize: number
  effectiveStrategy: EditableRenderingStrategyEffectiveType
  estimatedBlockSize: number | null
  segmentSize: number | null
  mountedGroupCount: number
  mountedTopLevelCount: number
  nativeSurfaceComplete: boolean | null
  pendingGroupCount: number
  pendingTopLevelCount: number
  requestedStrategy: string
  shellCount: number
  threshold: number | null
  virtualizerMeasuredCount: number | null
}

export type EditableRenderingStrategyMetrics =
  EditableRenderingStrategyMetricsBase & {
    domCoverageBoundaryCount: number
    domCoverageBoundaryElementCount: number
    domNodeCount: number
    editableDescendantCount: number
    renderingStrategyStagedBoundaryCount: number
    shellAggressiveBoundaryCount: number
    viewportVirtualizationBoundaryCount: number
  }

const getEditableRenderingStrategyDOMMetrics = ({
  editor,
  metrics,
  rootElement,
}: {
  editor: ReactRuntimeEditor
  metrics: EditableRenderingStrategyMetricsBase
  rootElement: HTMLElement
}): EditableRenderingStrategyMetrics => {
  const boundaries = DOMCoverage.getBoundaries(editor)

  return {
    ...metrics,
    domCoverageBoundaryCount: boundaries.length,
    domCoverageBoundaryElementCount: rootElement.querySelectorAll(
      '[data-slate-dom-coverage-boundary]'
    ).length,
    domNodeCount: rootElement.querySelectorAll('*').length + 1,
    editableDescendantCount: rootElement.querySelectorAll(
      '[data-slate-node="element"], [data-slate-node="text"], [data-slate-leaf]'
    ).length,
    renderingStrategyStagedBoundaryCount: boundaries.filter(
      (boundary) => boundary.reason === 'rendering-staged'
    ).length,
    shellAggressiveBoundaryCount: boundaries.filter(
      (boundary) => boundary.reason === 'shell-aggressive'
    ).length,
    viewportVirtualizationBoundaryCount: boundaries.filter(
      (boundary) => boundary.reason === 'viewport-virtualization'
    ).length,
  }
}

export type EditableHandlerResult = boolean | EditableRepairRequest | void

export type EditableInputEventContext = {
  data: unknown
  editor: ReactRuntimeEditor
  event?: InputEvent | React.KeyboardEvent<HTMLDivElement>
  inputType?: string
  intent: InputIntent | null
  native: boolean
  selection: Range | null
}

export type EditableDOMBeforeInputContext = EditableInputEventContext & {
  event: InputEvent
  inputType: string
}

export type EditableDOMBeforeInputHandler = (
  event: InputEvent,
  context: EditableDOMBeforeInputContext
) => EditableHandlerResult

export type EditableKeyDownContext = {
  editor: ReactRuntimeEditor
}

export type EditableKeyDownHandler = (
  event: React.KeyboardEvent<HTMLDivElement>,
  context: EditableKeyDownContext
) => EditableHandlerResult

/**
 * Editable.
 */

export const EditableDOMRoot = (props: EditableDOMRootProps) => {
  const { ref: forwardedRef, ...editableProps } = props
  recordSlateReactRender({ kind: 'editable' })

  const {
    autoFocus,
    children: customChildren,
    renderingStrategy = null,
    renderingStrategyMetrics = null,
    onKeyDown: propsOnKeyDown,
    onDOMBeforeInput: propsOnDOMBeforeInput,
    onRenderingStrategyMetrics,
    readOnly = false,
    scrollSelectionIntoView = defaultScrollSelectionIntoView,
    style: userStyle = {},
    as: Component = 'div',
    disableDefaultStyles = false,
    ...attributes
  } = editableProps
  const editor = useEditor<ReactRuntimeEditor>()
  const rootRuntime = useEditableRootRuntime({
    autoFocus,
    callbacks: attributes,
    editor,
    forwardedRef,
    renderingStrategy,
    onDOMBeforeInput: propsOnDOMBeforeInput,
    onKeyDown: propsOnKeyDown,
    readOnly,
    scrollSelectionIntoView,
  })
  const {
    editableEventBindings,
    isComposing,
    receivedUserInput,
    rootRef: ref,
    shellBackedSelection,
  } = rootRuntime

  useIsomorphicLayoutEffect(() => {
    const rootElement = ref.current

    if (
      !rootElement ||
      !renderingStrategyMetrics ||
      !onRenderingStrategyMetrics
    ) {
      return
    }

    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) {
        return
      }

      onRenderingStrategyMetrics(
        getEditableRenderingStrategyDOMMetrics({
          editor,
          metrics: renderingStrategyMetrics,
          rootElement,
        })
      )
    })

    return () => {
      cancelled = true
    }
  }, [editor, renderingStrategyMetrics, onRenderingStrategyMetrics, ref])

  return (
    <ReadOnlyContext.Provider value={readOnly}>
      <ComposingContext.Provider value={isComposing}>
        <RestoreDOM node={ref} receivedUserInput={receivedUserInput}>
          <Component
            aria-multiline={readOnly ? undefined : true}
            role={readOnly ? undefined : 'textbox'}
            translate="no"
            {...attributes}
            autoCapitalize={
              HAS_BEFORE_INPUT_SUPPORT || !CAN_USE_DOM
                ? attributes.autoCapitalize
                : 'false'
            }
            autoCorrect={
              HAS_BEFORE_INPUT_SUPPORT || !CAN_USE_DOM
                ? attributes.autoCorrect
                : 'false'
            }
            // explicitly set this
            contentEditable={!readOnly}
            data-slate-editor
            data-slate-node="value"
            data-slate-rendering-strategy-selection={
              shellBackedSelection ? 'shell-backed' : undefined
            }
            {...editableEventBindings}
            // COMPAT: Certain browsers don't support the `beforeinput` event, so we'd
            // have to use hacks to make these replacement-based features work.
            // For SSR situations HAS_BEFORE_INPUT_SUPPORT is false and results in prop
            // mismatch warning app moves to browser. Pass-through consumer props when
            // not CAN_USE_DOM (SSR) and default to falsy value
            spellCheck={
              HAS_BEFORE_INPUT_SUPPORT || !CAN_USE_DOM
                ? attributes.spellCheck
                : false
            }
            style={{
              ...(disableDefaultStyles
                ? {}
                : {
                    // Allow positioning relative to the editable element.
                    position: 'relative',
                    // Preserve adjacent whitespace and new lines.
                    whiteSpace: 'pre-wrap',
                    // Allow words to break if they are too long.
                    wordWrap: 'break-word',
                  }),
              // Work around selection expansion for decorations that depend on the current range.
              zIndex: -1,
              // Allow for passed-in styles to override anything.
              ...userStyle,
            }}
            suppressContentEditableWarning
          >
            {customChildren}
          </Component>
        </RestoreDOM>
      </ComposingContext.Provider>
    </ReadOnlyContext.Provider>
  )
}

/**
 * The props that get passed to renderPlaceholder
 */
export type RenderPlaceholderProps = {
  children: any
  attributes: {
    'data-slate-placeholder': boolean
    dir?: 'rtl'
    contentEditable: boolean
    ref: React.RefCallback<any>
    style: React.CSSProperties
  }
}

/**
 * The default placeholder element
 */

export const DefaultPlaceholder = ({
  attributes,
  children,
}: RenderPlaceholderProps) => (
  // COMPAT: Artificially add a line-break to the end on the placeholder element
  // to prevent Android IMEs to pick up its content in autocorrect and to auto-capitalize the first letter
  <span {...attributes}>
    {children}
    {IS_ANDROID && <br />}
  </span>
)

type ScrollRect = {
  bottom: number
  left: number
  right: number
  top: number
}

const SCROLL_VISIBILITY_MARGIN = 4
const SCROLLABLE_OVERFLOW_PATTERN = /(auto|scroll|overlay)/

const isUsableScrollRect = (rect: DOMRect | DOMRectReadOnly) =>
  rect.width > 0 ||
  rect.height > 0 ||
  rect.x !== 0 ||
  rect.y !== 0 ||
  rect.top !== 0 ||
  rect.left !== 0 ||
  rect.bottom !== 0 ||
  rect.right !== 0

const toScrollRect = (rect: DOMRect | DOMRectReadOnly): ScrollRect => ({
  bottom: rect.bottom,
  left: rect.left,
  right: rect.right,
  top: rect.top,
})

const offsetScrollRect = (
  rect: ScrollRect,
  delta: { left: number; top: number }
): ScrollRect => ({
  bottom: rect.bottom - delta.top,
  left: rect.left - delta.left,
  right: rect.right - delta.left,
  top: rect.top - delta.top,
})

const canScrollAxis = (element: HTMLElement, axis: 'x' | 'y') => {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  const overflow =
    axis === 'y'
      ? `${style?.overflowY ?? ''} ${style?.overflow ?? ''}`
      : `${style?.overflowX ?? ''} ${style?.overflow ?? ''}`

  if (!SCROLLABLE_OVERFLOW_PATTERN.test(overflow)) {
    return false
  }

  return axis === 'y'
    ? element.scrollHeight > element.clientHeight
    : element.scrollWidth > element.clientWidth
}

const getComposedParentElement = (element: HTMLElement) => {
  if (element.parentElement) {
    return element.parentElement
  }

  const window = element.ownerDocument.defaultView

  if (!window) {
    return null
  }

  const ShadowRootConstructor = window.ShadowRoot
  const root = element.getRootNode()

  if (ShadowRootConstructor && root instanceof ShadowRootConstructor) {
    const { host } = root

    return host instanceof window.HTMLElement ? host : null
  }

  return null
}

const scrollRectIntoViewIfNeeded = ({
  rect,
  startElement,
}: {
  rect: ScrollRect
  startElement: HTMLElement
}) => {
  let currentRect = rect

  for (
    let parent = getComposedParentElement(startElement);
    parent;
    parent = getComposedParentElement(parent)
  ) {
    const canScrollY = canScrollAxis(parent, 'y')
    const canScrollX = canScrollAxis(parent, 'x')

    if (!canScrollY && !canScrollX) {
      continue
    }

    const parentRect = parent.getBoundingClientRect()
    const topEdge = parentRect.top + SCROLL_VISIBILITY_MARGIN
    const bottomEdge = parentRect.bottom - SCROLL_VISIBILITY_MARGIN
    const leftEdge = parentRect.left + SCROLL_VISIBILITY_MARGIN
    const rightEdge = parentRect.right - SCROLL_VISIBILITY_MARGIN
    const nextTop =
      canScrollY && currentRect.top < topEdge
        ? currentRect.top - topEdge
        : canScrollY && currentRect.bottom > bottomEdge
          ? currentRect.bottom - bottomEdge
          : 0
    const nextLeft =
      canScrollX && currentRect.left < leftEdge
        ? currentRect.left - leftEdge
        : canScrollX && currentRect.right > rightEdge
          ? currentRect.right - rightEdge
          : 0

    if (nextTop === 0 && nextLeft === 0) {
      continue
    }

    const previousTop = parent.scrollTop
    const previousLeft = parent.scrollLeft

    parent.scrollTop += nextTop
    parent.scrollLeft += nextLeft

    currentRect = offsetScrollRect(currentRect, {
      left: parent.scrollLeft - previousLeft,
      top: parent.scrollTop - previousTop,
    })
  }

  const window = startElement.ownerDocument.defaultView

  if (!window) {
    return
  }

  const topEdge = SCROLL_VISIBILITY_MARGIN
  const bottomEdge = window.innerHeight - SCROLL_VISIBILITY_MARGIN
  const leftEdge = SCROLL_VISIBILITY_MARGIN
  const rightEdge = window.innerWidth - SCROLL_VISIBILITY_MARGIN
  const scrollingElement = window.document.scrollingElement
  const canScrollWindowY = scrollingElement
    ? scrollingElement.scrollHeight > scrollingElement.clientHeight
    : window.document.documentElement.scrollHeight > window.innerHeight
  const canScrollWindowX = scrollingElement
    ? scrollingElement.scrollWidth > scrollingElement.clientWidth
    : window.document.documentElement.scrollWidth > window.innerWidth
  const nextTop =
    canScrollWindowY && currentRect.top < topEdge
      ? currentRect.top - topEdge
      : canScrollWindowY && currentRect.bottom > bottomEdge
        ? currentRect.bottom - bottomEdge
        : 0
  const nextLeft =
    canScrollWindowX && currentRect.left < leftEdge
      ? currentRect.left - leftEdge
      : canScrollWindowX && currentRect.right > rightEdge
        ? currentRect.right - rightEdge
        : 0

  if (nextTop !== 0 || nextLeft !== 0) {
    try {
      window.scrollBy(nextLeft, nextTop)
    } catch {
      // Environments like jsdom expose scrollBy but do not implement it.
    }
  }
}

/**
 * A default implement to scroll dom range into view.
 */

export const defaultScrollSelectionIntoView = (
  editor: ReactRuntimeEditor,
  domRange: DOMRange
) => {
  // Scroll to the focus point of the selection, in case the selection is expanded
  const selection = readLiveSelection(editor)
  const isBackward = !!selection && RangeApi.isBackward(selection)
  const domFocusPoint = domRange.cloneRange()
  domFocusPoint.collapse(isBackward)

  if (domFocusPoint.getBoundingClientRect) {
    const leafEl = domFocusPoint.startContainer.parentElement

    if (!leafEl || typeof leafEl.getBoundingClientRect !== 'function') {
      return
    }

    // COMPAT: In Chrome, domFocusPoint.getBoundingClientRect() can return zero dimensions for valid ranges (e.g. line breaks).
    // Fall back to the leaf rect so typing through empty lines still keeps the caret visible.
    const domRect = domFocusPoint.getBoundingClientRect()
    const isZeroDimensionRect =
      domRect.width === 0 &&
      domRect.height === 0 &&
      domRect.x === 0 &&
      domRect.y === 0

    const targetRect =
      !isZeroDimensionRect && isUsableScrollRect(domRect)
        ? domRect
        : leafEl.getBoundingClientRect()

    if (!isUsableScrollRect(targetRect)) {
      return
    }

    scrollRectIntoViewIfNeeded({
      rect: toScrollRect(targetRect),
      startElement: leafEl,
    })
  }
}

/**
 * Check if an event is overrided by a handler.
 */

export const isEventHandled = <
  EventType extends React.SyntheticEvent<unknown, unknown>,
>(
  event: EventType,
  handler?: (event: EventType) => void | boolean
) => {
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

/**
 * Check if the event's target is an input element
 */
export const isDOMEventTargetInput = <
  EventType extends React.SyntheticEvent<unknown, unknown>,
>(
  event: EventType
) => {
  return (
    isDOMNode(event.target) &&
    (event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement)
  )
}

/**
 * Check if a DOM event is overrided by a handler.
 */

export const isDOMEventHandled = <E extends Event>(
  event: E,
  handler?: (event: E) => void | boolean
) => {
  if (!handler) {
    return false
  }

  // The custom event handler may return a boolean to specify whether the event
  // shall be treated as being handled or not.
  const shouldTreatEventAsHandled = handler(event)

  if (shouldTreatEventAsHandled != null) {
    return shouldTreatEventAsHandled
  }

  return event.defaultPrevented
}
