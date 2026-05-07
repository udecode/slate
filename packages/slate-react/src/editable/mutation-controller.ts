import { type Descendant, Node, Path, Point, Range } from 'slate'
import { ReactEditor } from '../plugin/react-editor'
import { recordSlateReactRender } from '../render-profiler'
import type { DOMRepairQueue } from './dom-repair-queue'
import {
  type EditableCommand,
  type EditableRepairPolicy,
  getEditableRepairPolicy,
} from './editing-kernel'
import type {
  EditableInputController,
  EditableSelectionSourceTransition,
} from './input-state'
import { Editor, type Editor as RuntimeEditor } from './runtime-editor-api'
import { readRuntimeSelection } from './runtime-selection-state'
import { setEditableModelSelectionPreference } from './selection-controller'

const now = () => globalThis.performance?.now?.() ?? Date.now()

const profileEditableMutationDuration = <T>(
  id: string,
  callback: () => T
): T => {
  if (!globalThis.__SLATE_REACT_RENDER_PROFILER__) {
    return callback()
  }

  const start = now()

  try {
    return callback()
  } finally {
    recordSlateReactRender({
      duration: now() - start,
      id,
      kind: 'runtime-time',
    })
  }
}

export const applyModelOwnedHistoryIntent = ({
  direction,
  editor,
}: {
  direction: 'redo' | 'undo'
  editor: Editor
}) => {
  const maybeHistoryEditor: any = editor
  const fn = maybeHistoryEditor[direction]

  if (typeof fn !== 'function') {
    return false
  }

  fn()
  return true
}

export const shouldForceRenderAfterModelOwnedHistory = (editor: Editor) => {
  const commit = editor.read((state) => state.value.lastCommit())

  return (
    !commit ||
    commit.operations.some(
      (operation) =>
        operation.type !== 'insert_text' &&
        operation.type !== 'remove_text' &&
        operation.type !== 'set_selection'
    )
  )
}

export const applyModelOwnedNativeHistoryEvent = ({
  editor,
  event,
}: {
  editor: Editor
  event: InputEvent
}) => {
  if (
    event.inputType === 'historyUndo' &&
    applyModelOwnedHistoryIntent({ direction: 'undo', editor })
  ) {
    return true
  }
  if (
    event.inputType === 'historyRedo' &&
    applyModelOwnedHistoryIntent({ direction: 'redo', editor })
  ) {
    return true
  }
  return false
}

export const applyModelOwnedDeleteIntent = ({
  direction,
  editor,
  unit,
}: {
  direction: 'backward' | 'forward'
  editor: Editor
  unit?: 'block' | 'line' | 'word'
}) => {
  if (
    direction === 'backward' &&
    unit == null &&
    applyBackspaceAfterBlockVoid(editor, readRuntimeSelection(editor))
  ) {
    return
  }

  editor.update((tx) => {
    if (direction === 'backward') {
      tx.text.deleteBackward({ unit: unit ?? 'character' })
      return
    }

    tx.text.deleteForward({ unit: unit ?? 'character' })
  })
}

export const applyModelOwnedExpandedDelete = ({
  direction,
  editor,
}: {
  direction: 'backward' | 'forward'
  editor: Editor
}) => {
  editor.update((tx) => {
    tx.fragment.delete({ direction })
  })
}

export const applyModelOwnedLineBreak = ({
  editor,
  kind,
}: {
  editor: RuntimeEditor
  kind: 'paragraph' | 'soft'
}) => {
  if (
    kind === 'paragraph' &&
    applyParagraphBreakAfterSelectedBlockVoid(
      editor,
      readRuntimeSelection(editor)
    )
  ) {
    return
  }

  editor.update((tx) => {
    if (kind === 'paragraph') {
      tx.break.insert()
      return
    }

    tx.break.insertSoft()
  })
}

const createDefaultParagraph = (): Descendant =>
  ({
    type: 'paragraph',
    children: [{ text: '' }],
  }) as Descendant

const isBlockVoid = (editor: RuntimeEditor, node: Node) =>
  Node.isElement(node) &&
  Editor.isBlock(editor, node) &&
  Editor.isVoid(editor, node)

const getCollapsedBlockPath = (
  editor: RuntimeEditor,
  selection: Range | null
) => {
  if (!selection || !Range.isCollapsed(selection)) {
    return null
  }

  const blockEntry = Editor.above(editor, {
    at: selection.anchor,
    match: (node) => Node.isElement(node) && Editor.isBlock(editor, node),
    mode: 'highest',
    voids: true,
  })

  return blockEntry?.[1] ?? null
}

const getSelectedBlockVoidPath = (
  editor: RuntimeEditor,
  selection: Range | null
) => {
  const blockPath = getCollapsedBlockPath(editor, selection)

  if (!blockPath || !Editor.hasPath(editor, blockPath)) {
    return null
  }

  return isBlockVoid(editor, Node.get(editor, blockPath)) ? blockPath : null
}

const applyBackspaceAfterBlockVoid = (
  editor: RuntimeEditor,
  selection: Range | null
) => {
  const blockPath = getCollapsedBlockPath(editor, selection)

  if (
    !selection ||
    !blockPath ||
    !Path.hasPrevious(blockPath) ||
    !Editor.isStart(editor, selection.anchor, blockPath)
  ) {
    return false
  }

  const block = Node.get(editor, blockPath)

  if (!Node.isElement(block) || Node.string(block) !== '') {
    return false
  }

  const previousPath = Path.previous(blockPath)

  if (!Editor.hasPath(editor, previousPath)) {
    return false
  }

  const previous = Node.get(editor, previousPath)

  if (!isBlockVoid(editor, previous)) {
    return false
  }

  const selectionPoint = Editor.point(editor, previousPath, { edge: 'start' })

  editor.update((tx) => {
    tx.nodes.remove({ at: blockPath })
    tx.selection.set({ anchor: selectionPoint, focus: selectionPoint })
  })

  return true
}

const applyParagraphBreakAfterSelectedBlockVoid = (
  editor: RuntimeEditor,
  selection: Range | null
) => {
  const voidPath = getSelectedBlockVoidPath(editor, selection)

  if (!voidPath) {
    return false
  }

  const insertionPath = Path.next(voidPath)
  const selectionPoint = { path: insertionPath.concat(0), offset: 0 }

  editor.update((tx) => {
    tx.nodes.insert(createDefaultParagraph(), { at: insertionPath })
    tx.selection.set({ anchor: selectionPoint, focus: selectionPoint })
  })

  return true
}

const getFullySelectedBlockPath = (
  editor: RuntimeEditor,
  selection: Range | null
) => {
  if (!selection || Range.isCollapsed(selection)) {
    return null
  }

  const [start, end] = Range.edges(selection)
  const startBlock = Editor.above(editor, {
    at: start,
    match: (node) => Node.isElement(node) && Editor.isBlock(editor, node),
    mode: 'highest',
  })
  const endBlock = Editor.above(editor, {
    at: end,
    match: (node) => Node.isElement(node) && Editor.isBlock(editor, node),
    mode: 'highest',
  })

  if (!startBlock || !endBlock) {
    return null
  }

  const [, blockPath] = startBlock
  const [, endBlockPath] = endBlock

  if (
    !Point.equals(start, Editor.point(editor, blockPath, { edge: 'start' }))
  ) {
    return null
  }

  if (Point.equals(end, Editor.point(editor, blockPath, { edge: 'end' }))) {
    return blockPath
  }

  if (
    !Point.equals(end, Editor.point(editor, endBlockPath, { edge: 'start' }))
  ) {
    return null
  }

  return blockPath
}

const applyFullBlockDeleteFragment = (
  editor: RuntimeEditor,
  selection: Range | null
) => {
  const blockPath = getFullySelectedBlockPath(editor, selection)

  if (!blockPath) {
    return false
  }

  editor.update((tx) => {
    tx.nodes.remove({ at: blockPath })
  })

  return true
}

export const applyEditableCommand = ({
  command,
  editor,
}: {
  command: EditableCommand
  editor: RuntimeEditor
}) => {
  switch (command.kind) {
    case 'delete':
      applyModelOwnedDeleteIntent({
        direction: command.direction,
        editor,
        unit: command.unit,
      })
      return true

    case 'delete-both':
      applyModelOwnedDeleteIntent({
        direction: 'backward',
        editor,
        unit: command.unit,
      })
      applyModelOwnedDeleteIntent({
        direction: 'forward',
        editor,
        unit: command.unit,
      })
      return true

    case 'delete-fragment':
      if (
        applyFullBlockDeleteFragment(
          editor,
          command.selection ?? readRuntimeSelection(editor)
        )
      ) {
        return true
      }

      editor.update((tx) => {
        tx.fragment.delete(
          command.direction ? { direction: command.direction } : undefined
        )
      })
      return true

    case 'history':
      return applyModelOwnedHistoryIntent({
        direction: command.direction,
        editor,
      })

    case 'insert-break':
      applyModelOwnedLineBreak({
        editor,
        kind: command.variant,
      })
      return true

    case 'insert-data':
      editor.update(() => {
        const domEditor = editor as ReactEditor

        domEditor.dom.clipboard.insertData(command.data)
      })
      return true

    case 'insert-text':
      editor.update((tx) => {
        tx.text.insert(command.text)
      })
      return true

    case 'select':
    case 'select-all':
      editor.update((tx) => {
        tx.selection.set(
          command.kind === 'select'
            ? command.selection
            : {
                anchor: tx.points.start([]),
                focus: tx.points.end([]),
              }
        )
      })
      return true

    case 'move-selection':
    case 'set-block':
    case 'toggle-mark':
      return false
  }
}

export const applyModelOwnedDataTransferInput = ({
  data,
  editor,
}: {
  data: DataTransfer
  editor: ReactEditor
}) => {
  editor.update(() => {
    editor.dom.clipboard.insertData(data)
  })
}

export type EditableRepairRequest =
  | {
      focus?: boolean
      forceRender?: boolean
      kind: 'force-render' | 'sync-selection'
      selectionSourceTransition?: EditableSelectionSourceTransition
    }
  | {
      focus?: boolean
      forceRender?: boolean
      kind: 'repair-caret' | 'repair-caret-after-text-insert'
      selectionSourceTransition?: EditableSelectionSourceTransition
    }
  | { kind: 'none' | 'skip-dom-sync' }

export const executeEditableRepairPolicy = ({
  repair,
  repairPolicy,
}: {
  repair: () => void
  repairPolicy: EditableRepairPolicy
}) => {
  if (repairPolicy.kind === 'none') {
    return false
  }

  repair()
  return true
}

export const applyModelOwnedTextInput = ({
  data,
  editor,
  inputType,
  selection,
}: {
  data: string
  editor: Editor
  inputType: string
  selection?: Range | null
}): EditableRepairRequest => {
  const canUseSyncedCollapsedTarget =
    inputType === 'insertText' &&
    selection &&
    Range.isCollapsed(selection) &&
    !profileEditableMutationDuration('model-text-input-read-marks', () =>
      editor.read((state) => state.marks.get())
    )

  if (canUseSyncedCollapsedTarget) {
    profileEditableMutationDuration(
      'model-text-input-insert-at-selection',
      () =>
        editor.update((tx) => {
          tx.text.insert(data, { at: selection })
        })
    )
  } else {
    profileEditableMutationDuration('model-text-input-apply-command', () =>
      applyEditableCommand({
        command: { inputType, kind: 'insert-text', text: data },
        editor,
      })
    )
  }

  if (inputType === 'insertText') {
    return {
      forceRender: ReactEditor.isComposing(editor as ReactEditor),
      kind: 'repair-caret-after-text-insert',
      selectionSourceTransition: {
        preferModelSelection: true,
        reason: 'model-command',
        selectionSource: 'model-owned',
      },
    }
  }

  return { kind: 'none' }
}

export const applyEditableRepairRequest = ({
  domRepairQueue,
  editor,
  forceRender,
  inputController,
  request,
  syncDOMSelectionToEditor,
}: {
  domRepairQueue: DOMRepairQueue
  editor: ReactEditor
  forceRender: () => void
  inputController: EditableInputController
  request: EditableRepairRequest
  syncDOMSelectionToEditor: () => void
}) => {
  if (request.kind === 'none' || request.kind === 'skip-dom-sync') {
    return
  }

  const repairPolicy = getEditableRepairPolicy({ repair: request })

  executeEditableRepairPolicy({
    repair: () => {
      if (
        'selectionSourceTransition' in request &&
        request.selectionSourceTransition
      ) {
        setEditableModelSelectionPreference({
          inputController,
          preferModelSelection:
            request.selectionSourceTransition.preferModelSelection,
          selectionSource: request.selectionSourceTransition.selectionSource,
        })
      }

      if ('focus' in request && request.focus) {
        ReactEditor.focus(editor)
      }

      if ('forceRender' in request && request.forceRender) {
        forceRender()
      }

      if (request.kind === 'sync-selection') {
        syncDOMSelectionToEditor()
        return
      }

      if (request.kind === 'repair-caret') {
        domRepairQueue.repair(repairPolicy)
        return
      }

      if (request.kind === 'repair-caret-after-text-insert') {
        domRepairQueue.repair(repairPolicy)
      }
    },
    repairPolicy,
  })
}
