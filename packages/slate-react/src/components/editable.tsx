import type React from 'react'
import scrollIntoView from 'scroll-into-view-if-needed'
import {
  type Element,
  type LeafPosition,
  Range,
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
import type { EditableRepairRequest } from '../editable/input-controller'
import { useEditableRootRuntime } from '../editable/runtime-root-engine'
import { readLiveSelection } from '../editable/runtime-selection-state'
import { useEditor } from '../hooks/use-editor'
import { ComposingContext } from '../hooks/use-editor-composing'
import { ReadOnlyContext } from '../hooks/use-editor-read-only'
import type { MountedTopLevelRange } from '../large-document/large-document-commands'
import type { ReactEditor } from '../plugin/react-editor'
import { recordSlateReactRender } from '../render-profiler'
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
  inputRules?: readonly EditableInputRule[]
  largeDocument?: {
    mode: 'dom-present' | 'shell'
    mountedTopLevelRuntimeIds: ReadonlySet<RuntimeId> | null
    mountedTopLevelRanges?: readonly MountedTopLevelRange[]
  } | null
  onDOMBeforeInput?: (event: InputEvent) => void
  onKeyDown?: EditableKeyDownHandler
  readOnly?: boolean
  scrollSelectionIntoView?: (editor: ReactEditor, domRange: DOMRange) => void
  as?: React.ElementType
  disableDefaultStyles?: boolean
} & Omit<React.ComponentPropsWithRef<'div'>, 'children' | 'onKeyDown'>

export type EditableInputRuleContext = {
  data: unknown
  editor: ReactEditor
  event?: InputEvent
  inputType: string
  selection: Range | null
}

export type EditableInputRuleResult = boolean | EditableRepairRequest | void

export type EditableInputRule = (
  context: EditableInputRuleContext
) => EditableInputRuleResult

export type EditableKeyDownContext = {
  editor: ReactEditor
}

export type EditableKeyDownHandler = (
  event: React.KeyboardEvent<HTMLDivElement>,
  context: EditableKeyDownContext
) => EditableInputRuleResult

/**
 * Editable.
 */

export const EditableDOMRoot = (props: EditableDOMRootProps) => {
  const { ref: forwardedRef, ...editableProps } = props
  recordSlateReactRender({ kind: 'editable' })

  const {
    autoFocus,
    children: customChildren,
    inputRules,
    largeDocument = null,
    onKeyDown: propsOnKeyDown,
    onDOMBeforeInput: propsOnDOMBeforeInput,
    readOnly = false,
    scrollSelectionIntoView = defaultScrollSelectionIntoView,
    style: userStyle = {},
    as: Component = 'div',
    disableDefaultStyles = false,
    ...attributes
  } = editableProps
  const editor = useEditor()
  const rootRuntime = useEditableRootRuntime({
    autoFocus,
    callbacks: attributes,
    editor,
    forwardedRef,
    inputRules,
    largeDocument,
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
            data-slate-large-document-selection={
              shellBackedSelection ? 'shell-backed' : undefined
            }
            data-slate-node="value"
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
              // Allow for passed-in styles to override anything.
              ...userStyle,
            }}
            suppressContentEditableWarning
            // in some cases, a decoration needs access to the range / selection to decorate a text node,
            // then you will select the whole text node when you select part the of text
            // this magic zIndex="-1" will fix it
            zindex={-1}
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

/**
 * A default implement to scroll dom range into view.
 */

export const defaultScrollSelectionIntoView = (
  editor: ReactEditor,
  domRange: DOMRange
) => {
  // Scroll to the focus point of the selection, in case the selection is expanded
  const selection = readLiveSelection(editor)
  const isBackward = !!selection && Range.isBackward(selection)
  const domFocusPoint = domRange.cloneRange()
  domFocusPoint.collapse(isBackward)

  if (domFocusPoint.getBoundingClientRect) {
    const leafEl = domFocusPoint.startContainer.parentElement!

    if (typeof leafEl.getBoundingClientRect !== 'function') {
      return
    }

    // COMPAT: In Chrome, domFocusPoint.getBoundingClientRect() can return zero dimensions for valid ranges (e.g. line breaks).
    // When this happens, do not scroll like most editors do.
    const domRect = domFocusPoint.getBoundingClientRect()
    const isZeroDimensionRect =
      domRect.width === 0 &&
      domRect.height === 0 &&
      domRect.x === 0 &&
      domRect.y === 0

    if (isZeroDimensionRect) {
      const leafRect = leafEl.getBoundingClientRect()
      const leafHasDimensions = leafRect.width > 0 || leafRect.height > 0

      if (leafHasDimensions) {
        return
      }
    }

    // Default behavior: use domFocusPoint's getBoundingClientRect
    leafEl.getBoundingClientRect =
      domFocusPoint.getBoundingClientRect.bind(domFocusPoint)
    scrollIntoView(leafEl, {
      scrollMode: 'if-needed',
    })

    // @ts-expect-error an unorthodox delete D:
    leafEl.getBoundingClientRect = undefined
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
