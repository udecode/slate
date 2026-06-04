import {
  type Descendant,
  type Node,
  NodeApi,
  type Operation,
  type Path,
  PathApi,
  type Point,
  PointApi,
  type Range,
  RangeApi,
  type RangeRef,
  type RootKey,
} from 'slate'
import { getDOMClipboardFormatKey } from 'slate-dom/internal'
import { ReactEditor, type ReactRuntimeEditor } from '../plugin/react-editor'
import { recordSlateReactRender } from '../render-profiler'
import {
  isSlateViewSelectionCollapsed,
  readSlateViewSelection,
  readSlateViewSelectionHistoryEntry,
  saveSlateViewSelectionHistoryEntry,
  writeSlateViewSelection,
} from '../view-selection'
import { applyContentRootSelectionMoveCommand } from './content-root-navigation'
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
import { resolveProjectedSelectionTarget } from './projected-selection-target'
import {
  Editor,
  getEditorCurrentMarks,
  getEditorExtensionRegistry,
  type Editor as RuntimeEditor,
  withOperationRootChildren,
} from './runtime-editor-api'
import { readRuntimeSelection } from './runtime-selection-state'
import {
  armModelOwnedTextInputGuard,
  setEditableModelSelectionPreference,
} from './selection-controller'
import { shouldSkipSelectionFocus } from './selection-side-effect-policy'

const now = () => globalThis.performance?.now?.() ?? Date.now()
const MAIN_ROOT_KEY: RootKey = 'main'
const DEFAULT_SLATE_CLIPBOARD_FORMAT_KEY = 'x-slate-fragment'
const EDITOR_TO_HISTORY_FOCUS_ROOT = new WeakMap<Editor, RootKey | null>()

type ClipboardInsertDataHandler = (
  editor: RuntimeEditor,
  data: DataTransfer
) => boolean

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
  const focusRoot = getHistoryBatchSingleOperationRoot(editor, direction)
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
  EDITOR_TO_HISTORY_FOCUS_ROOT.set(editor, focusRoot)
  writeSlateViewSelection(editor, viewSelectionAfterHistory ?? null)
  return true
}

const getOperationRoot = (operation: Operation): RootKey =>
  ((operation as { root?: RootKey }).root ?? MAIN_ROOT_KEY) as RootKey

const getHistoryBatchSingleOperationRoot = (
  editor: Editor,
  direction: 'redo' | 'undo'
): RootKey | null =>
  editor.read((state) => {
    const history = (state as { history?: unknown }).history as
      | {
          redos?: () => readonly { operations?: readonly Operation[] }[]
          undos?: () => readonly { operations?: readonly Operation[] }[]
        }
      | undefined
    const stack = direction === 'undo' ? history?.undos?.() : history?.redos?.()
    const batch = stack?.at(-1)
    const roots = new Set(
      (batch?.operations ?? [])
        .filter((operation) => operation.type !== 'set_selection')
        .map(getOperationRoot)
    )

    return roots.size === 1 ? (roots.values().next().value ?? null) : null
  })

export const consumeModelOwnedHistoryFocusRoot = (
  editor: Editor
): RootKey | null => {
  const root = EDITOR_TO_HISTORY_FOCUS_ROOT.get(editor) ?? null

  EDITOR_TO_HISTORY_FOCUS_ROOT.delete(editor)

  return root
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
  const selection = readRuntimeSelection(editor)

  if (
    direction === 'backward' &&
    unit == null &&
    (applyBackspaceAtLeadingInlineVoidBlockBoundary(editor, selection) ||
      applyBackspaceAfterBlockVoid(editor, selection))
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

const getCanonicalRuntimeEditor = (editor: RuntimeEditor): RuntimeEditor =>
  ((editor as { runtime?: { editor?: RuntimeEditor } }).runtime?.editor ??
    editor) as RuntimeEditor

const withProjectedMutationRoot = <T>(
  editor: RuntimeEditor,
  root: RootKey | undefined,
  fn: () => T
): T => {
  if (!root) {
    return fn()
  }

  const rootPoint = { offset: 0, path: [0, 0], root }

  return withOperationRootChildren(
    editor,
    {
      newProperties: null,
      properties: { anchor: rootPoint, focus: rootPoint },
      root,
      type: 'set_selection',
    } as Operation,
    fn
  )
}

const getProjectedClipboardFragmentData = (
  editor: RuntimeEditor,
  data: DataTransfer
) => {
  const clipboardFormatKey = getDOMClipboardFormatKey(editor)
  const clipboardFragment = data.getData(`application/${clipboardFormatKey}`)

  if (clipboardFragment) {
    return clipboardFragment
  }

  const html = data.getData('text/html')
  const DOMParser = globalThis.DOMParser

  if (!html || typeof DOMParser !== 'function') {
    return ''
  }

  const document = new DOMParser().parseFromString(html, 'text/html')
  const htmlFragment = document.querySelector('[data-slate-fragment]')

  if (!htmlFragment) {
    return ''
  }

  const htmlFragmentData =
    htmlFragment.getAttribute('data-slate-fragment') ?? ''

  if (!htmlFragmentData) {
    return ''
  }

  const fragmentFormat =
    htmlFragment.getAttribute('data-slate-fragment-format') ?? undefined

  if (fragmentFormat) {
    return fragmentFormat === clipboardFormatKey ? htmlFragmentData : ''
  }

  return clipboardFormatKey === DEFAULT_SLATE_CLIPBOARD_FORMAT_KEY
    ? htmlFragmentData
    : ''
}

const decodeProjectedClipboardFragment = (
  editor: RuntimeEditor,
  data: DataTransfer
): Descendant[] | null => {
  const fragment = getProjectedClipboardFragmentData(editor, data)

  if (!fragment || typeof globalThis.atob !== 'function') {
    return null
  }

  try {
    const decoded = decodeURIComponent(globalThis.atob(fragment))
    const parsed = JSON.parse(decoded)

    return Array.isArray(parsed) ? (parsed as Descendant[]) : null
  } catch {
    return null
  }
}

const getProjectedClipboardInsertDataHandlers = (editor: RuntimeEditor) =>
  (getEditorExtensionRegistry(editor).capabilities.get(
    'clipboard.insertData'
  ) as ClipboardInsertDataHandler[] | undefined) ?? []

const applyProjectedClipboardInsertDataHandlers = (
  editor: RuntimeEditor,
  data: DataTransfer
) => {
  for (const handler of getProjectedClipboardInsertDataHandlers(editor)) {
    if (handler(editor, data)) {
      return true
    }
  }

  return false
}

const deleteProjectedRangeRefs = (
  tx: { text: { delete: (options: { at: Range }) => void } },
  rangeRefs: RangeRef[]
) => {
  const ranges = rangeRefs
    .map((rangeRef) => rangeRef.unref())
    .filter((range): range is Range => !!range)

  for (const range of ranges.reverse()) {
    if (!RangeApi.isCollapsed(range)) {
      tx.text.delete({ at: range })
    }
  }
}

const hasActiveMarks = (marks: Record<string, unknown> | null) =>
  !!marks && Object.keys(marks).length > 0

const isUnmarkedTextNode = (node: Node) =>
  NodeApi.isText(node) && Object.keys(node).length === 1

const getTextNodeMarks = (node: Node) => {
  if (!NodeApi.isText(node)) {
    return null
  }

  const { text: _text, ...marks } = node

  return Object.keys(marks).length > 0 ? marks : null
}

const getTextNodeMarksKey = (marks: Record<string, unknown> | null) =>
  marks === null
    ? ''
    : JSON.stringify(
        Object.keys(marks)
          .sort()
          .map((key) => [key, marks[key]])
      )

const getConsistentTextMarksInBlocks = (
  editor: RuntimeEditor,
  blockPaths: Path[]
) =>
  editor.read((state) => {
    let firstMarks: Record<string, unknown> | null = null
    let firstMarksKey: string | null = null
    let sawText = false

    for (const blockPath of blockPaths) {
      const [block] = state.nodes.get(blockPath)

      for (const [node] of NodeApi.texts(block)) {
        if (node.text.length === 0) {
          continue
        }

        const marks = getTextNodeMarks(node)
        const marksKey = getTextNodeMarksKey(marks)

        if (!sawText) {
          sawText = true
          firstMarks = marks
          firstMarksKey = marksKey
          continue
        }

        if (marksKey !== firstMarksKey) {
          return null
        }
      }
    }

    return sawText ? firstMarks : null
  })

const createTextReplacementNode = (
  editor: RuntimeEditor,
  blockPaths: Path[],
  marks: Record<string, unknown> | null,
  text: string
): Descendant => {
  const children = [marks ? { ...marks, text } : { text }]

  if (blockPaths.length !== 1) {
    return {
      ...createDefaultParagraph(),
      children,
    } as Descendant
  }

  return editor.read((state) => {
    const [block] = state.nodes.get(blockPaths[0]!)
    const { schema } = state

    if (
      NodeApi.isElement(block) &&
      !STRUCTURAL_TEXT_REPLACEMENT_BLOCK_TYPES.has(
        typeof block.type === 'string' ? block.type : ''
      ) &&
      !schema.isInline(block) &&
      !schema.isVoid(block) &&
      block.children.every(
        (child) =>
          NodeApi.isText(child) ||
          (NodeApi.isElement(child) && schema.isInline(child))
      )
    ) {
      return {
        ...block,
        children,
      } as Descendant
    }

    return {
      ...createDefaultParagraph(),
      children,
    } as Descendant
  })
}

const isPlainTextLeafStart = ({
  editor,
  selection,
}: {
  editor: Editor
  selection: Range
}) =>
  editor.read((state) => {
    const { path } = selection.anchor

    if (path.length < 2 || selection.anchor.offset !== 0) {
      return false
    }

    const [node] = state.nodes.get(path)

    if (!isUnmarkedTextNode(node)) {
      return false
    }

    const [block] = state.nodes.get([path[0]!])
    const targetRelativePath = path.slice(1)
    let previousTextNode: Node | null = null

    for (const [textNode, textPath] of NodeApi.texts(block)) {
      if (PathApi.equals(textPath, targetRelativePath)) {
        return previousTextNode === null || isUnmarkedTextNode(previousTextNode)
      }

      previousTextNode = textNode
    }

    return false
  })

const canUseExplicitCollapsedTextInsert = ({
  editor,
  marks,
  selection,
}: {
  editor: Editor
  marks: Record<string, unknown> | null
  selection: Range
}) => {
  if (hasActiveMarks(marks)) {
    return false
  }
  if (marks == null) {
    return true
  }

  return editor.read((state) => {
    const [node] = state.nodes.get(selection.anchor.path)

    return isUnmarkedTextNode(node)
  })
}

const canUseCachedCollapsedTextInsert = ({
  editor,
  selection,
}: {
  editor: Editor
  selection: Range
}) => {
  const marks = getEditorCurrentMarks(editor)

  if (hasActiveMarks(marks)) {
    return false
  }

  const unmarkedTextNode = editor.read((state) => {
    const [node] = state.nodes.get(selection.anchor.path)

    return isUnmarkedTextNode(node)
  })

  if (!unmarkedTextNode) {
    return false
  }

  if (marks !== null || selection.anchor.offset > 0) {
    return true
  }

  if (isPlainTextLeafStart({ editor, selection })) {
    return true
  }

  return canUseExplicitCollapsedTextInsert({
    editor,
    marks: profileEditableMutationDuration('model-text-input-read-marks', () =>
      editor.read((state) => state.marks.get())
    ),
    selection,
  })
}

const releaseProjectedRangeRefs = (rangeRefs: RangeRef[]) => {
  for (const rangeRef of rangeRefs) {
    rangeRef.unref()
  }
}

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

  const runtimeEditor = getCanonicalRuntimeEditor(editor)
  const resolution = resolveProjectedSelectionTarget(
    runtimeEditor,
    viewSelection
  )

  if (resolution.kind === 'ambiguous') {
    return true
  }
  if (resolution.kind === 'stale') {
    writeSlateViewSelection(editor, null)
    return false
  }

  const { target } = resolution

  runtimeEditor.update((tx) => {
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
  saveSlateViewSelectionHistoryEntry(runtimeEditor, {
    redo: null,
    undo: viewSelection,
  })
  writeSlateViewSelection(editor, null)

  return true
}

const applyProjectedViewSelectionDataCommand = ({
  data,
  editor,
}: {
  data: DataTransfer
  editor: RuntimeEditor
}) => {
  const viewSelection = readSlateViewSelection(editor)

  if (!viewSelection || isSlateViewSelectionCollapsed(viewSelection)) {
    return false
  }

  const runtimeEditor = getCanonicalRuntimeEditor(editor)
  const resolution = resolveProjectedSelectionTarget(
    runtimeEditor,
    viewSelection
  )

  if (resolution.kind === 'ambiguous') {
    return true
  }
  if (resolution.kind === 'stale') {
    writeSlateViewSelection(editor, null)
    return false
  }

  const { target } = resolution
  const fragment = decodeProjectedClipboardFragment(runtimeEditor, data)
  const text = data.getData('text/plain')
  const hasFragmentPayload = !!fragment && fragment.length > 0
  const hasFallbackPayload = !!text || hasFragmentPayload
  const hasInsertDataHandlers =
    getProjectedClipboardInsertDataHandlers(runtimeEditor).length > 0
  let handled = false

  if (!hasFallbackPayload && !hasInsertDataHandlers) {
    return true
  }

  if (!hasFallbackPayload) {
    const previousSelection = runtimeEditor.read((state) =>
      state.selection.get()
    )

    runtimeEditor.update((tx) => {
      const rangeRefs = target.ranges.map((range) =>
        Editor.rangeRef(runtimeEditor, range, { affinity: 'inward' })
      )

      try {
        tx.selection.set({ anchor: target.start, focus: target.start })
        handled = withProjectedMutationRoot(
          runtimeEditor,
          target.start.root,
          () => applyProjectedClipboardInsertDataHandlers(runtimeEditor, data)
        )

        if (handled) {
          deleteProjectedRangeRefs(tx, rangeRefs)
        } else {
          releaseProjectedRangeRefs(rangeRefs)
          tx.selection.set(previousSelection)
        }
      } catch (error) {
        releaseProjectedRangeRefs(rangeRefs)
        throw error
      }
    })

    if (handled) {
      saveSlateViewSelectionHistoryEntry(runtimeEditor, {
        redo: null,
        undo: viewSelection,
      })
      writeSlateViewSelection(editor, null)
    }

    return true
  }

  runtimeEditor.update((tx) => {
    const rangeRefs = target.ranges.map((range) =>
      Editor.rangeRef(runtimeEditor, range, { affinity: 'inward' })
    )

    try {
      tx.selection.set({ anchor: target.start, focus: target.start })
      handled = withProjectedMutationRoot(
        runtimeEditor,
        target.start.root,
        () => applyProjectedClipboardInsertDataHandlers(runtimeEditor, data)
      )

      if (handled) {
        deleteProjectedRangeRefs(tx, rangeRefs)
        return
      }

      deleteProjectedRangeRefs(tx, rangeRefs)
      if (hasFragmentPayload) {
        withProjectedMutationRoot(runtimeEditor, target.start.root, () => {
          tx.fragment.insert(fragment)
        })
      } else {
        withProjectedMutationRoot(runtimeEditor, target.start.root, () => {
          ;(
            runtimeEditor.api as {
              clipboard: { insertTextData: (data: DataTransfer) => boolean }
            }
          ).clipboard.insertTextData(data)
        })
      }
    } catch (error) {
      releaseProjectedRangeRefs(rangeRefs)
      throw error
    }
  })
  saveSlateViewSelectionHistoryEntry(runtimeEditor, {
    redo: null,
    undo: viewSelection,
  })
  writeSlateViewSelection(editor, null)

  return true
}

const applyProjectedViewSelectionLineBreakCommand = ({
  editor,
  kind,
}: {
  editor: RuntimeEditor
  kind: 'open-line' | 'paragraph' | 'soft'
}) => {
  const viewSelection = readSlateViewSelection(editor)

  if (!viewSelection || isSlateViewSelectionCollapsed(viewSelection)) {
    return false
  }

  const runtimeEditor = getCanonicalRuntimeEditor(editor)
  const resolution = resolveProjectedSelectionTarget(
    runtimeEditor,
    viewSelection
  )

  if (resolution.kind === 'ambiguous') {
    return true
  }
  if (resolution.kind === 'stale') {
    writeSlateViewSelection(editor, null)
    return false
  }

  const { target } = resolution

  runtimeEditor.update((tx) => {
    for (const range of [...target.ranges].reverse()) {
      if (!RangeApi.isCollapsed(range)) {
        tx.text.delete({ at: range })
      }
    }

    tx.selection.set({ anchor: target.start, focus: target.start })

    withProjectedMutationRoot(runtimeEditor, target.start.root, () => {
      if (kind !== 'open-line') {
        if (kind === 'paragraph') {
          tx.break.insert()
          return
        }

        tx.break.insertSoft()
        return
      }

      const blockEntry = tx.nodes.above({
        at: target.start,
        match: (node) => NodeApi.isElement(node) && tx.nodes.isBlock(node),
      })

      if (!blockEntry) {
        tx.break.insert()
        return
      }

      const [, blockPath] = blockEntry
      const insertionPoint = { path: blockPath.concat(0), offset: 0 }

      tx.nodes.insert(createDefaultParagraph(), { at: blockPath })
      tx.selection.set({ anchor: insertionPoint, focus: insertionPoint })
    })
  })
  saveSlateViewSelectionHistoryEntry(runtimeEditor, {
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

type SelectionMoveCommand = Extract<EditableCommand, { kind: 'move-selection' }>

const getSelectionMoveUnit = (
  command: SelectionMoveCommand
): 'line' | 'word' | undefined =>
  command.axis === 'line' || command.axis === 'word' ? command.axis : undefined

const applyRootLocalSelectionMoveCommand = ({
  command,
  editor,
}: {
  command: SelectionMoveCommand
  editor: RuntimeEditor
}) => {
  const selection = readRuntimeSelection(editor)

  if (!selection) {
    return false
  }

  writeSlateViewSelection(editor, null)
  editor.update((tx) => {
    if (command.extend) {
      tx.selection.move({
        edge: 'focus',
        reverse: command.reverse,
        unit: getSelectionMoveUnit(command),
      })
      return
    }

    if (RangeApi.isCollapsed(selection)) {
      tx.selection.move({
        reverse: command.reverse,
        unit: getSelectionMoveUnit(command),
      })
      return
    }

    tx.selection.collapse({
      edge: command.reverse ? 'start' : 'end',
    })
  })

  return true
}

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

const STRUCTURAL_TEXT_REPLACEMENT_BLOCK_TYPES = new Set([
  'bulleted-list',
  'code-block',
  'numbered-list',
  'table',
  'table-cell',
  'table-row',
])

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

const getPointWithRoot = (point: Point, root: RootKey | undefined): Point =>
  root === undefined ? point : { ...point, root }

const applyBackspaceAtLeadingInlineVoidBlockBoundary = (
  editor: RuntimeEditor,
  selection: Range | null
) => {
  if (!selection || RangeApi.isExpanded(selection)) {
    return false
  }

  const point = selection.anchor

  if (point.offset !== 0) {
    return false
  }

  const target = editor.read((state) => {
    const isInlineVoidAt = (location: Path | Point) => {
      if (PathApi.isPath(location)) {
        if (!state.nodes.hasPath(location)) {
          return false
        }

        const [node] = state.nodes.get(location)

        return (
          NodeApi.isElement(node) &&
          Editor.isInline(editor, node) &&
          Editor.isVoid(editor, node)
        )
      }

      return !!Editor.above(editor, {
        at: location,
        match: (node) =>
          NodeApi.isElement(node) &&
          Editor.isInline(editor, node) &&
          Editor.isVoid(editor, node),
        mode: 'lowest',
        voids: true,
      })
    }
    const block = Editor.above(editor, {
      at: point,
      match: (node) => NodeApi.isElement(node) && Editor.isBlock(editor, node),
      mode: 'lowest',
      voids: true,
    })

    if (!block) {
      return null
    }

    const [, blockPath] = block

    if (blockPath.length !== 1 || !PathApi.hasPrevious(blockPath)) {
      return null
    }

    const [blockNode] = block
    const previousBlockPath = PathApi.previous(blockPath)
    const [previousBlockNode] = state.nodes.get(previousBlockPath)

    if (
      !NodeApi.isElement(blockNode) ||
      !NodeApi.isElement(previousBlockNode) ||
      !Editor.isBlock(editor, previousBlockNode)
    ) {
      return null
    }

    const blockStart = getPointWithRoot(
      Editor.point(editor, blockPath, { edge: 'start' }),
      point.root
    )

    if (!PointApi.equals(point, blockStart)) {
      return null
    }

    const nextSiblingPath = PathApi.next(point.path)

    if (
      !isInlineVoidAt(point) &&
      (!Editor.hasPath(editor, nextSiblingPath) ||
        !isInlineVoidAt(nextSiblingPath))
    ) {
      return null
    }

    const firstChild = blockNode.children[0]
    const sourceChildIndex =
      point.path.length === blockPath.length + 1 &&
      point.path.at(-1) === 0 &&
      NodeApi.isText(firstChild) &&
      firstChild.text === ''
        ? 1
        : 0
    const moveCount = blockNode.children.length - sourceChildIndex

    return {
      blockStart,
      blockPath,
      insertPath: [...previousBlockPath, previousBlockNode.children.length],
      moveCount,
      previousBlockEnd: getPointWithRoot(
        Editor.point(editor, previousBlockPath, { edge: 'end' }),
        point.root
      ),
      sourcePath: [...blockPath, sourceChildIndex],
    }
  })

  if (!target) {
    return false
  }

  editor.update((tx) => {
    const insertIndex = target.insertPath.at(-1)!
    const insertParentPath = target.insertPath.slice(0, -1)

    for (let index = 0; index < target.moveCount; index++) {
      tx.nodes.move({
        at: target.sourcePath,
        to: [...insertParentPath, insertIndex + index],
        voids: true,
      })
    }
    tx.nodes.remove({
      at: target.blockPath,
      voids: true,
    })
    tx.selection.set({
      anchor: target.previousBlockEnd,
      focus: target.previousBlockEnd,
    })
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
  selection: Range | null,
  {
    includeAllSiblings = false,
    includeOnlyChild = false,
  }: {
    includeAllSiblings?: boolean
    includeOnlyChild?: boolean
  } = {}
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

  if (PathApi.equals(blockPath, endBlockPath)) {
    if (
      !PointApi.equals(end, Editor.point(editor, blockPath, { edge: 'end' }))
    ) {
      return null
    }

    const parentPath = PathApi.parent(blockPath)
    const parentChildCount = editor.read((state) => {
      if (parentPath.length === 0) {
        return state.nodes.children().length
      }

      const [parentNode] = state.nodes.get(parentPath)

      return NodeApi.isAncestor(parentNode) &&
        'children' in parentNode &&
        Array.isArray(parentNode.children)
        ? parentNode.children.length
        : 0
    })

    return parentChildCount > 1 || includeOnlyChild ? [blockPath] : null
  }

  if (PointApi.equals(end, Editor.point(editor, blockPath, { edge: 'end' }))) {
    return [blockPath]
  }

  const endsAtEndBlockStart = PointApi.equals(
    end,
    Editor.point(editor, endBlockPath, { edge: 'start' })
  )
  const endsAtEndBlockEnd = PointApi.equals(
    end,
    Editor.point(editor, endBlockPath, { edge: 'end' })
  )

  if (!endsAtEndBlockStart && !endsAtEndBlockEnd) {
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
  const stopPath = endsAtEndBlockEnd ? PathApi.next(endBlockPath) : endBlockPath

  while (!PathApi.equals(path, stopPath)) {
    paths.push(path)
    path = PathApi.next(path)
  }

  const parentPath = PathApi.parent(blockPath)
  const parentChildCount = editor.read((state) => {
    if (parentPath.length === 0) {
      return state.nodes.children().length
    }

    const [parentNode] = state.nodes.get(parentPath)

    return NodeApi.isAncestor(parentNode) &&
      'children' in parentNode &&
      Array.isArray(parentNode.children)
      ? parentNode.children.length
      : 0
  })

  return paths.length < parentChildCount || includeAllSiblings ? paths : null
}

const getFullySelectedTopLevelBlockPaths = (
  editor: RuntimeEditor,
  selection: Range | null
): Path[] | null => {
  if (!selection || RangeApi.isCollapsed(selection)) {
    return null
  }

  const childCount = editor.read((state) => state.nodes.children().length)

  if (childCount === 0) {
    return null
  }

  const [start, end] = RangeApi.edges(selection)
  const firstPath = [0]
  const lastPath = [childCount - 1]

  if (
    !PointApi.equals(start, Editor.point(editor, firstPath, { edge: 'start' }))
  ) {
    return null
  }

  if (!PointApi.equals(end, Editor.point(editor, lastPath, { edge: 'end' }))) {
    return null
  }

  return Array.from({ length: childCount }, (_, index) => [index])
}

const applyFullBlockDeleteFragment = (
  editor: RuntimeEditor,
  selection: Range | null
) => {
  const blockPaths = getFullySelectedBlockPaths(editor, selection)

  if (blockPaths) {
    editor.update((tx) => {
      for (const blockPath of [...blockPaths].reverse()) {
        tx.nodes.remove({ at: blockPath })
      }
    })

    return true
  }

  const topLevelBlockPaths = getFullySelectedTopLevelBlockPaths(
    editor,
    selection
  )

  if (!topLevelBlockPaths) {
    return false
  }

  const marks = getConsistentTextMarksInBlocks(editor, topLevelBlockPaths)
  const selectionPoint = getPointWithRoot(
    { path: [0, 0], offset: 0 },
    selection?.anchor.root
  )
  const paragraph = {
    ...createDefaultParagraph(),
    children: [marks ? { ...marks, text: '' } : { text: '' }],
  } as Descendant

  editor.update((tx) => {
    for (const blockPath of [...topLevelBlockPaths].reverse()) {
      tx.nodes.remove({ at: blockPath })
    }
    tx.nodes.insert(paragraph, { at: [0] })
    tx.selection.set({ anchor: selectionPoint, focus: selectionPoint })
    if (marks) {
      for (const [key, value] of Object.entries(marks)) {
        tx.marks.add(key, value)
      }
    }
  })

  return true
}

const applyFullBlockTextReplacement = (
  editor: RuntimeEditor,
  selection: Range | null,
  text: string
) => {
  const blockPaths =
    getFullySelectedBlockPaths(editor, selection, {
      includeAllSiblings: true,
      includeOnlyChild: true,
    }) ?? getFullySelectedTopLevelBlockPaths(editor, selection)

  if (!blockPaths?.length) {
    return false
  }

  const insertionPath = [...blockPaths[0]!]
  const marks =
    getEditorCurrentMarks(editor) ??
    getConsistentTextMarksInBlocks(editor, blockPaths)
  const nextPoint = { path: insertionPath.concat(0), offset: text.length }
  const replacement = createTextReplacementNode(editor, blockPaths, marks, text)

  editor.update((tx) => {
    for (const blockPath of [...blockPaths].reverse()) {
      tx.nodes.remove({ at: blockPath })
    }

    tx.nodes.insert(replacement, { at: insertionPath })
    tx.selection.set({ anchor: nextPoint, focus: nextPoint })
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
      if (applyProjectedViewSelectionTextCommand({ editor })) {
        return true
      }

      applyModelOwnedDeleteIntent({
        direction: command.direction,
        editor,
        unit: command.unit,
      })
      return true

    case 'delete-both':
      if (applyProjectedViewSelectionTextCommand({ editor })) {
        return true
      }

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

      {
        const selection = command.selection ?? readRuntimeSelection(editor)

        if (applyFullBlockDeleteFragment(editor, selection)) {
          return true
        }

        if (selection && RangeApi.isCollapsed(selection)) {
          return true
        }

        editor.update((tx) => {
          if (selection && RangeApi.isExpanded(selection)) {
            tx.fragment.delete({
              at: selection,
              ...(command.direction ? { direction: command.direction } : {}),
            })
            return
          }

          tx.fragment.delete(
            command.direction ? { direction: command.direction } : undefined
          )
        })
        return true
      }

    case 'history':
      return applyModelOwnedHistoryIntent({
        direction: command.direction,
        editor,
      })

    case 'insert-break':
      if (
        applyProjectedViewSelectionLineBreakCommand({
          editor,
          kind: command.variant,
        })
      ) {
        return true
      }

      applyModelOwnedLineBreak({
        editor,
        kind: command.variant,
      })
      return true

    case 'insert-data':
      if (
        applyProjectedViewSelectionDataCommand({
          data: command.data,
          editor,
        })
      ) {
        return true
      }

      editor.update(() => {
        ;(
          editor.api as {
            clipboard: { insertData: (data: DataTransfer) => boolean }
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
      if (
        applyContentRootSelectionMoveCommand({
          command,
          editor: editor as ReactRuntimeEditor,
          selection: readRuntimeSelection(editor),
        }).handled
      ) {
        return true
      }

      return applyRootLocalSelectionMoveCommand({ command, editor })

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
}) =>
  applyEditableCommand({
    command: { data, kind: 'insert-data' },
    editor,
  })

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
  const hasExplicitTargetSelection =
    !!selection &&
    (RangeApi.isExpanded(selection) || inputType !== 'insertText')

  if (
    !hasExplicitTargetSelection &&
    applyProjectedViewSelectionTextCommand({ editor, text: data })
  ) {
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

  const canUseSyncedCollapsedTarget =
    inputType === 'insertText' &&
    selection &&
    RangeApi.isCollapsed(selection) &&
    canUseCachedCollapsedTextInsert({ editor, selection })

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
    if (!applyFullBlockTextReplacement(editor, selection, data)) {
      profileEditableMutationDuration(
        'model-text-input-insert-at-target-selection',
        () =>
          editor.update((tx) => {
            tx.text.insert(data, { at: selection })
          })
      )
    }
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
          reason:
            request.selectionSourceTransition.reason === 'native-selection-move'
              ? 'native-selection'
              : request.selectionSourceTransition.reason === 'unknown-selection'
                ? 'unknown'
                : request.selectionSourceTransition.reason,
          selectionSource: request.selectionSourceTransition.selectionSource,
        })
        if (
          request.selectionSourceTransition.preferModelSelection &&
          request.selectionSourceTransition.reason === 'model-command'
        ) {
          armModelOwnedTextInputGuard({ inputController })
        }
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
