import {
  type Descendant,
  type Node,
  NodeApi,
  type Path,
  PathApi,
  type Point,
  PointApi,
  type Range,
  RangeApi,
} from 'slate'
import { ReactEditor, type ReactRuntimeEditor } from '../plugin/react-editor'
import { recordSlateReactRender } from '../render-profiler'
import {
  isSlateViewSelectionCollapsed,
  readSlateViewSelection,
  readSlateViewSelectionHistoryEntry,
  saveSlateViewSelectionHistoryEntry,
  writeSlateViewSelection,
} from '../view-selection'
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
import { createProjectedSelectionTarget } from './projected-selection-target'
import { Editor, type Editor as RuntimeEditor } from './runtime-editor-api'
import { readRuntimeSelection } from './runtime-selection-state'
import { setEditableModelSelectionPreference } from './selection-controller'
import { shouldSkipSelectionFocus } from './selection-side-effect-policy'

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
  const viewSelectionAfterHistory = readSlateViewSelectionHistoryEntry(
    editor,
    direction
  )
  const hasHistory = editor.read((state) => {
    const history = (state as { history?: unknown }).history as
      | { redos?: unknown; undos?: unknown }
      | undefined

    return (
      typeof history?.redos === 'function' &&
      typeof history?.undos === 'function'
    )
  })

  if (!hasHistory) {
    return false
  }

  editor.update((tx) => {
    const history = (
      tx as {
        history?: {
          redo?: () => void
          undo?: () => void
        }
      }
    ).history
    const fn = history?.[direction]

    if (typeof fn !== 'function') {
      throw new Error(`Editor history API does not expose ${direction}.`)
    }

    fn()
  })
  writeSlateViewSelection(editor, viewSelectionAfterHistory ?? null)
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
  readOnly = false,
}: {
  editor: Editor
  event: InputEvent
  readOnly?: boolean
}) => {
  if (readOnly) {
    return false
  }

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
  kind: 'open-line' | 'paragraph' | 'soft'
}) => {
  if (
    kind !== 'soft' &&
    applyParagraphBreakAfterSelectedBlockVoid(
      editor,
      readRuntimeSelection(editor)
    )
  ) {
    return
  }

  editor.update((tx) => {
    if (kind === 'open-line') {
      const selection = tx.selection.get()
      const blockEntry =
        selection && RangeApi.isCollapsed(selection)
          ? tx.nodes.above({
              at: selection.anchor,
              match: (node) =>
                NodeApi.isElement(node) && tx.nodes.isBlock(node),
            })
          : undefined

      if (!blockEntry) {
        tx.break.insert()
        return
      }

      const [, blockPath] = blockEntry
      const insertionPoint = { path: blockPath.concat(0), offset: 0 }

      tx.nodes.insert(createDefaultParagraph(), { at: blockPath })
      tx.selection.set({ anchor: insertionPoint, focus: insertionPoint })
      return
    }

    if (kind === 'paragraph') {
      tx.break.insert()
      return
    }

    tx.break.insertSoft()
  })
}

const clonePoint = (point: Point): Point => ({
  offset: point.offset,
  path: [...point.path],
})

const advancePointByText = (point: Point, text: string): Point => ({
  ...(point.root ? { root: point.root } : {}),
  offset: point.offset + text.length,
  path: [...point.path],
})

const applyProjectedViewSelectionTextCommand = ({
  editor,
  text,
}: {
  editor: RuntimeEditor
  text?: string
}) => {
  const viewSelection = readSlateViewSelection(editor)

  if (!viewSelection || isSlateViewSelectionCollapsed(viewSelection)) {
    return false
  }

  const target = createProjectedSelectionTarget(editor, viewSelection)

  if (!target) {
    writeSlateViewSelection(editor, null)
    return false
  }

  editor.update((tx) => {
    for (const range of [...target.ranges].reverse()) {
      if (!RangeApi.isCollapsed(range)) {
        tx.text.delete({ at: range })
      }
    }

    if (text) {
      tx.text.insert(text, { at: target.start })
    }

    const selectionPoint = text
      ? advancePointByText(target.start, text)
      : target.start

    tx.selection.set({ anchor: selectionPoint, focus: selectionPoint })
  })
  saveSlateViewSelectionHistoryEntry(editor, {
    redo: null,
    undo: viewSelection,
  })
  writeSlateViewSelection(editor, null)

  return true
}

const createRange = (anchor: Point, focus: Point): Range => ({
  anchor: clonePoint(anchor),
  focus: clonePoint(focus),
})

export const applyModelOwnedTransposeCharacterIntent = ({
  editor,
  selection,
}: {
  editor: RuntimeEditor
  selection: Range | null
}) => {
  if (!selection || !RangeApi.isCollapsed(selection)) {
    return false
  }

  const cursor = selection.anchor
  const before = Editor.before(editor, cursor, { unit: 'character' })

  if (!before) {
    return false
  }

  let start = before
  let middle = cursor
  let end = Editor.after(editor, cursor, { unit: 'character' })

  if (!end) {
    const secondBefore = Editor.before(editor, before, { unit: 'character' })

    if (!secondBefore) {
      return false
    }

    start = secondBefore
    middle = before
    end = cursor
  }

  if (
    !PathApi.equals(start.path, middle.path) ||
    !PathApi.equals(middle.path, end.path)
  ) {
    return false
  }

  const left = Editor.string(editor, createRange(start, middle))
  const right = Editor.string(editor, createRange(middle, end))

  if (!left || !right) {
    return false
  }

  const swapped = `${right}${left}`
  const nextSelection = {
    anchor: {
      offset: start.offset + swapped.length,
      path: [...start.path],
    },
    focus: {
      offset: start.offset + swapped.length,
      path: [...start.path],
    },
  }

  editor.update((tx) => {
    tx.text.delete({ at: createRange(start, end) })
    tx.text.insert(swapped, { at: clonePoint(start) })
    tx.selection.set(nextSelection)
  })

  return true
}

const createDefaultParagraph = (): Descendant =>
  ({
    type: 'paragraph',
    children: [{ text: '' }],
  }) as Descendant

const isRootBlockPath = (path: Path): boolean => path.length === 1

const deletesWholeRoot = (editor: RuntimeEditor, blockPaths: Path[]) => {
  if (!blockPaths.every(isRootBlockPath)) {
    return false
  }

  return (
    editor.read((state) => state.nodes.children().length) === blockPaths.length
  )
}

const isBlockVoid = (editor: RuntimeEditor, node: Node) =>
  NodeApi.isElement(node) &&
  Editor.isBlock(editor, node) &&
  Editor.isVoid(editor, node)

const getCollapsedBlockPath = (
  editor: RuntimeEditor,
  selection: Range | null
) => {
  if (!selection || !RangeApi.isCollapsed(selection)) {
    return null
  }

  const blockEntry = Editor.above(editor, {
    at: selection.anchor,
    match: (node) => NodeApi.isElement(node) && Editor.isBlock(editor, node),
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

  return isBlockVoid(editor, NodeApi.get(editor, blockPath)) ? blockPath : null
}

const applyBackspaceAfterBlockVoid = (
  editor: RuntimeEditor,
  selection: Range | null
) => {
  const blockPath = getCollapsedBlockPath(editor, selection)

  if (
    !selection ||
    !blockPath ||
    !PathApi.hasPrevious(blockPath) ||
    !Editor.isStart(editor, selection.anchor, blockPath)
  ) {
    return false
  }

  const block = NodeApi.get(editor, blockPath)

  if (!NodeApi.isElement(block) || NodeApi.string(block) !== '') {
    return false
  }

  const previousPath = PathApi.previous(blockPath)

  if (!Editor.hasPath(editor, previousPath)) {
    return false
  }

  const previous = NodeApi.get(editor, previousPath)

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

  const insertionPath = PathApi.next(voidPath)
  const selectionPoint = { path: insertionPath.concat(0), offset: 0 }

  editor.update((tx) => {
    tx.nodes.insert(createDefaultParagraph(), { at: insertionPath })
    tx.selection.set({ anchor: selectionPoint, focus: selectionPoint })
  })

  return true
}

const getFullySelectedBlockPaths = (
  editor: RuntimeEditor,
  selection: Range | null
): Path[] | null => {
  if (!selection || RangeApi.isCollapsed(selection)) {
    return null
  }

  const [start, end] = RangeApi.edges(selection)
  const startBlock = Editor.above(editor, {
    at: start,
    match: (node) => NodeApi.isElement(node) && Editor.isBlock(editor, node),
    mode: 'highest',
  })
  const endBlock = Editor.above(editor, {
    at: end,
    match: (node) => NodeApi.isElement(node) && Editor.isBlock(editor, node),
    mode: 'highest',
  })

  if (!startBlock || !endBlock) {
    return null
  }

  const [, blockPath] = startBlock
  const [, endBlockPath] = endBlock

  if (
    !PointApi.equals(start, Editor.point(editor, blockPath, { edge: 'start' }))
  ) {
    return null
  }

  if (PointApi.equals(end, Editor.point(editor, blockPath, { edge: 'end' }))) {
    return [blockPath]
  }

  if (
    !PointApi.equals(end, Editor.point(editor, endBlockPath, { edge: 'start' }))
  ) {
    return null
  }

  if (
    !PathApi.isSibling(blockPath, endBlockPath) ||
    !PathApi.isBefore(blockPath, endBlockPath)
  ) {
    return null
  }

  const paths: Path[] = []
  let path = blockPath

  while (!PathApi.equals(path, endBlockPath)) {
    paths.push(path)
    path = PathApi.next(path)
  }

  return paths
}

const applyFullBlockDeleteFragment = (
  editor: RuntimeEditor,
  selection: Range | null
) => {
  const blockPaths = getFullySelectedBlockPaths(editor, selection)

  if (!blockPaths) {
    return false
  }

  const shouldResetRoot = deletesWholeRoot(editor, blockPaths)
  const rootStart = { path: [0, 0], offset: 0 }

  editor.update((tx) => {
    for (const blockPath of [...blockPaths].reverse()) {
      tx.nodes.remove({ at: blockPath })
    }

    if (shouldResetRoot) {
      tx.selection.set({ anchor: rootStart, focus: rootStart })
    }
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
      if (applyProjectedViewSelectionTextCommand({ editor })) {
        return true
      }

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
        ;(
          editor.api as {
            clipboard: { insertData: (data: DataTransfer) => void }
          }
        ).clipboard.insertData(command.data)
      })
      return true

    case 'insert-text':
      if (
        applyProjectedViewSelectionTextCommand({
          editor,
          text: command.text,
        })
      ) {
        return true
      }

      editor.update((tx) => {
        tx.text.insert(command.text)
      })
      return true

    case 'transpose-character':
      return applyModelOwnedTransposeCharacterIntent({
        editor,
        selection: readRuntimeSelection(editor),
      })

    case 'select':
    case 'select-all':
      writeSlateViewSelection(editor, null)
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
  editor: ReactRuntimeEditor
}) => {
  editor.update(() => {
    editor.api.clipboard.insertData(data)
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
    RangeApi.isCollapsed(selection) &&
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
  } else if (
    selection &&
    (RangeApi.isExpanded(selection) || inputType !== 'insertText')
  ) {
    writeSlateViewSelection(editor, null)
    profileEditableMutationDuration(
      'model-text-input-insert-at-target-selection',
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
      forceRender: ReactEditor.isComposing(editor as ReactRuntimeEditor),
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
  editor: ReactRuntimeEditor
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

      if (
        'focus' in request &&
        request.focus &&
        !shouldSkipSelectionFocus(editor)
      ) {
        ReactEditor.focus(editor)
      }

      if ('forceRender' in request && request.forceRender) {
        forceRender()
      }

      if (request.kind === 'sync-selection') {
        inputController.state.selectionChangeOrigin = 'programmatic-export'
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
