import type { ClipboardEvent, DragEvent } from 'react'
import { Node, Range } from 'slate'
import {
  HAS_BEFORE_INPUT_SUPPORT,
  IS_WEBKIT,
  isDOMElement,
  isDOMNode,
  isDOMText,
  isPlainTextOnlyPaste,
} from 'slate-dom'
import { getSlateNodePathFromDOMElement } from '../hooks/use-slate-node-ref'
import { isFullDocumentSelection } from '../large-document/large-document-commands'
import { ReactEditor } from '../plugin/react-editor'
import type { EditableCommand } from './editing-kernel'
import type { EditableRepairRequest } from './input-controller'
import { applyEditableCommand } from './mutation-controller'
import { Editor } from './runtime-editor-api'
import { readRuntimeNode } from './runtime-live-state'
import { readRuntimeSelection } from './runtime-selection-state'

type EditablePasteHandler = (
  event: ClipboardEvent<HTMLDivElement>
) => boolean | void

type EditableDragHandler = (event: DragEvent<HTMLDivElement>) => boolean | void

type EditableDragState = {
  isDraggingInternally: boolean
}

export type EditableClipboardResult = {
  command: EditableCommand | null
  explicitShellBackedSelection?: boolean
  repair?: EditableRepairRequest | null
}

const clipboardResult = ({
  command,
  explicitShellBackedSelection,
  repair,
}: EditableClipboardResult): EditableClipboardResult => ({
  command,
  explicitShellBackedSelection,
  repair,
})

const isClipboardEventHandled = ({
  event,
  handler,
}: {
  event: ClipboardEvent<HTMLDivElement>
  handler?: EditablePasteHandler
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

const isDragEventHandled = ({
  event,
  handler,
}: {
  event: DragEvent<HTMLDivElement>
  handler?: EditableDragHandler
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

const resolveDragTarget = (editor: ReactEditor, target: EventTarget) => {
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
    const node = readRuntimeNode(editor, path)

    if (node) {
      return { node, path }
    }
  }

  try {
    const node = ReactEditor.toSlateNode(editor, target)
    const path = ReactEditor.findPath(editor, node)

    if (!Editor.hasPath(editor, path) || Node.get(editor, path) !== node) {
      return null
    }

    return { node, path }
  } catch {
    return null
  }
}

const isClipboardEventTargetInput = ({
  event,
}: {
  event: ClipboardEvent<HTMLDivElement>
}) => {
  return (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement
  )
}

export const applyEditableCopy = ({
  editor,
  event,
  onCopy,
}: {
  editor: ReactEditor
  event: ClipboardEvent<HTMLDivElement>
  onCopy?: EditablePasteHandler
}) => {
  const clipboardData =
    event.clipboardData ??
    (event.nativeEvent as globalThis.ClipboardEvent).clipboardData

  if (
    clipboardData &&
    ReactEditor.hasSelectableTarget(editor, event.target) &&
    !isClipboardEventHandled({ event, handler: onCopy }) &&
    !isClipboardEventTargetInput({ event })
  ) {
    event.preventDefault()
    editor.dom.clipboard.writeSelection(clipboardData)
  }
}

export const applyEditableCut = ({
  editor,
  event,
  onCut,
  readOnly,
}: {
  editor: ReactEditor
  event: ClipboardEvent<HTMLDivElement>
  onCut?: EditablePasteHandler
  readOnly: boolean
}): EditableClipboardResult => {
  const clipboardData =
    event.clipboardData ??
    (event.nativeEvent as globalThis.ClipboardEvent).clipboardData

  if (
    clipboardData &&
    !readOnly &&
    ReactEditor.hasSelectableTarget(editor, event.target) &&
    !isClipboardEventHandled({ event, handler: onCut }) &&
    !isClipboardEventTargetInput({ event })
  ) {
    event.preventDefault()
    editor.dom.clipboard.writeSelection(clipboardData)
    const selection = editor.read((state) => state.selection.get())

    if (selection) {
      if (Range.isExpanded(selection)) {
        const command: EditableCommand = { kind: 'delete-fragment' }
        const inlineEntry = Editor.above(editor, {
          at: Range.start(selection),
          match: (node) =>
            Node.isElement(node) && Editor.isInline(editor, node),
        })
        const inlinePath = inlineEntry?.[1]
        const inlineBeforePoint = inlinePath
          ? Editor.before(editor, inlinePath)
          : null
        const collapsePointRef = Editor.pointRef(editor, Range.start(selection))
        applyEditableCommand({ command, editor })
        const collapsePoint = collapsePointRef.unref()
        const shouldRemoveEmptyInline =
          inlinePath &&
          Editor.hasPath(editor, inlinePath) &&
          (() => {
            const [inlineNode] = editor.read((state) =>
              state.nodes.get(inlinePath)
            )
            return (
              Node.isElement(inlineNode) &&
              Editor.isInline(editor, inlineNode) &&
              Node.string(inlineNode) === ''
            )
          })()

        if (shouldRemoveEmptyInline && inlinePath && inlineBeforePoint) {
          editor.update((tx) => {
            tx.nodes.remove({
              at: inlinePath,
              voids: true,
            })
          })
          applyEditableCommand({
            command: {
              kind: 'select',
              selection: {
                anchor: inlineBeforePoint,
                focus: inlineBeforePoint,
              },
            },
            editor,
          })
          return clipboardResult({
            command,
            repair: {
              focus: true,
              kind: 'repair-caret',
              selectionSourceTransition: {
                preferModelSelection: true,
                reason: 'model-command',
                selectionSource: 'model-owned',
              },
            },
          })
        }

        if (collapsePoint) {
          applyEditableCommand({
            command: {
              kind: 'select',
              selection: {
                anchor: collapsePoint,
                focus: collapsePoint,
              },
            },
            editor,
          })
          return clipboardResult({
            command,
            repair: {
              focus: true,
              kind: 'repair-caret',
              selectionSourceTransition: {
                preferModelSelection: true,
                reason: 'model-command',
                selectionSource: 'model-owned',
              },
            },
          })
        }

        return clipboardResult({ command })
      }
      const node = Node.parent(editor, selection.anchor.path)
      if (Node.isElement(node) && Editor.isVoid(editor, node)) {
        editor.update((tx) => {
          tx.text.delete()
        })
      }
    }
  }

  return clipboardResult({ command: null })
}

export const applyEditableDragEnd = ({
  editor,
  event,
  onDragEnd,
  readOnly,
  state,
}: {
  editor: ReactEditor
  event: DragEvent<HTMLDivElement>
  onDragEnd?: EditableDragHandler
  readOnly: boolean
  state: EditableDragState
}) => {
  if (
    !readOnly &&
    state.isDraggingInternally &&
    onDragEnd &&
    ReactEditor.hasTarget(editor, event.target)
  ) {
    onDragEnd(event)
  }
}

export const applyEditableDragOver = ({
  editor,
  event,
  onDragOver,
}: {
  editor: ReactEditor
  event: DragEvent<HTMLDivElement>
  onDragOver?: EditableDragHandler
}) => {
  if (
    ReactEditor.hasTarget(editor, event.target) &&
    !isDragEventHandled({ event, handler: onDragOver })
  ) {
    // Only when the target is void, call `preventDefault` to signal
    // that drops are allowed. Editable content is droppable by
    // default, and calling `preventDefault` hides the cursor.
    const target = resolveDragTarget(editor, event.target)
    const node = target?.node

    if (node && Node.isElement(node) && Editor.isVoid(editor, node)) {
      event.preventDefault()
    }
  }
}

export const applyEditableDragStart = ({
  editor,
  event,
  onDragStart,
  readOnly,
  state,
}: {
  editor: ReactEditor
  event: DragEvent<HTMLDivElement>
  onDragStart?: EditableDragHandler
  readOnly: boolean
  state: EditableDragState
}) => {
  if (
    !readOnly &&
    ReactEditor.hasTarget(editor, event.target) &&
    !isDragEventHandled({ event, handler: onDragStart })
  ) {
    const target = resolveDragTarget(editor, event.target)

    if (!target) {
      return
    }

    const { node, path } = target
    const voidMatch =
      (Node.isElement(node) && Editor.isVoid(editor, node)) ||
      Editor.void(editor, { at: path, voids: true })

    // If starting a drag on a void node, make sure it is selected
    // so that it shows up in the selection's fragment.
    if (voidMatch) {
      const range = Editor.range(editor, path)
      applyEditableCommand({
        command: { kind: 'select', selection: range },
        editor,
      })
    }

    state.isDraggingInternally = true

    editor.dom.clipboard.writeSelection(event.dataTransfer)
  }
}

export const applyEditableDrop = ({
  editor,
  event,
  onDrop,
  readOnly,
  state,
}: {
  editor: ReactEditor
  event: DragEvent<HTMLDivElement>
  onDrop?: EditableDragHandler
  readOnly: boolean
  state: EditableDragState
}): EditableClipboardResult => {
  if (
    !readOnly &&
    ReactEditor.hasTarget(editor, event.target) &&
    !isDragEventHandled({ event, handler: onDrop })
  ) {
    event.preventDefault()

    // Keep a reference to the dragged range before updating selection
    const draggedRange = readRuntimeSelection(editor)

    // Find the range where the drop happened
    const range = ReactEditor.findEventRange(editor, event)
    const data = event.dataTransfer
    const command: EditableCommand = { data, kind: 'insert-data' }

    applyEditableCommand({
      command: { kind: 'select', selection: range },
      editor,
    })

    if (
      state.isDraggingInternally &&
      draggedRange &&
      !Range.equals(draggedRange, range) &&
      !Editor.void(editor, { at: range, voids: true })
    ) {
      editor.update((tx) => {
        tx.text.delete({
          at: draggedRange,
        })
      })
    }

    applyEditableCommand({ command, editor })

    // When dragging from another source into the editor, it's possible
    // that the current editor does not have focus.
    if (!ReactEditor.isFocused(editor)) {
      return clipboardResult({
        command,
        repair: {
          focus: true,
          kind: 'repair-caret',
          selectionSourceTransition: {
            preferModelSelection: true,
            reason: 'model-command',
            selectionSource: 'model-owned',
          },
        },
      })
    }

    return clipboardResult({ command })
  }

  return clipboardResult({ command: null })
}

export const applyEditablePaste = ({
  editor,
  event,
  onPaste,
  readOnly,
  shellBackedSelection,
}: {
  editor: ReactEditor
  event: ClipboardEvent<HTMLDivElement>
  onPaste?: EditablePasteHandler
  readOnly: boolean
  shellBackedSelection: boolean
}): EditableClipboardResult => {
  const canHandlePaste =
    !readOnly &&
    ReactEditor.hasEditableTarget(editor, event.target) &&
    !isClipboardEventHandled({ event, handler: onPaste })

  if (shellBackedSelection && event.clipboardData && canHandlePaste) {
    const text = event.clipboardData.getData('text/plain')
    const selection = editor.read((state) => state.selection.get())
    const isFullDocumentShellSelection = isFullDocumentSelection(
      editor,
      selection
    )

    if (
      text &&
      isFullDocumentShellSelection &&
      isPlainTextOnlyPaste(event.nativeEvent)
    ) {
      event.preventDefault()
      editor.update((tx) => {
        tx.value.replace({
          children: [
            {
              type: 'paragraph',
              children: [{ text }],
            } as any,
          ],
          selection: {
            anchor: { path: [0, 0], offset: text.length },
            focus: { path: [0, 0], offset: text.length },
          },
        })
      })

      return clipboardResult({
        command: null,
        explicitShellBackedSelection: false,
        repair: { kind: 'repair-caret' },
      })
    }

    event.preventDefault()
    const command: EditableCommand = {
      data: event.clipboardData,
      kind: 'insert-data',
    }
    applyEditableCommand({ command, editor })
    return clipboardResult({
      command,
      explicitShellBackedSelection: false,
      repair: { kind: 'repair-caret' },
    })
  }

  if (
    canHandlePaste &&
    (!HAS_BEFORE_INPUT_SUPPORT ||
      isPlainTextOnlyPaste(event.nativeEvent) ||
      IS_WEBKIT)
  ) {
    // COMPAT: Certain browsers don't support the `beforeinput` event, so we
    // fall back to React's `onPaste` here instead.
    // COMPAT: Firefox, Chrome and Safari don't emit `beforeinput` events
    // when "paste without formatting" is used, so fallback. (2020/02/20)
    // COMPAT: Safari InputEvents generated by pasting won't include
    // application/x-slate-fragment items, so use the
    // ClipboardEvent here. (2023/03/15)
    event.preventDefault()
    const command: EditableCommand = {
      data: event.clipboardData,
      kind: 'insert-data',
    }
    applyEditableCommand({ command, editor })

    return clipboardResult({
      command,
      repair: { kind: 'repair-caret' },
    })
  }

  return clipboardResult({ command: null })
}
