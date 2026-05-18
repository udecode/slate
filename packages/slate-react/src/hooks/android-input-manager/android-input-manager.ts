import type { DebouncedFunc } from 'lodash'
import type { RefObject } from 'react'
import {
  LocationApi,
  NodeApi,
  type Path,
  PathApi,
  type Point,
  type Range,
  RangeApi,
} from 'slate'
import {
  applyStringDiff,
  EDITOR_TO_FORCE_RENDER,
  EDITOR_TO_PENDING_ACTION,
  EDITOR_TO_PENDING_DIFFS,
  EDITOR_TO_PENDING_INSERTION_MARKS,
  EDITOR_TO_PENDING_SELECTION,
  EDITOR_TO_PLACEHOLDER_ELEMENT,
  EDITOR_TO_USER_MARKS,
  IS_COMPOSING,
  IS_NODE_MAP_DIRTY,
  isDOMElement,
  isDOMSelection,
  isDOMText,
  isTrackedMutation,
  mergeStringDiffs,
  normalizePoint,
  normalizeRange,
  normalizeStringDiff,
  type StringDiff,
  targetRange,
  verifyDiffState,
} from 'slate-dom'
import {
  getInputEventData,
  getInputEventTargetRanges,
} from '../../editable/dom-input-event'
import {
  type EditableCommand,
  getEditableCommandFromBeforeInputType,
} from '../../editable/editing-kernel'
import { applyEditableCommand } from '../../editable/mutation-controller'
import {
  Editor,
  hasEditorTransformMiddleware,
} from '../../editable/runtime-editor-api'
import { writeRuntimeMarks } from '../../editable/runtime-mutation-state'
import { readRuntimeSelection } from '../../editable/runtime-selection-state'
import { ReactEditor, type ReactRuntimeEditor } from '../../plugin/react-editor'
import { isDOMTextSyncMutation } from '../use-slate-node-ref'

export type Action = { at?: Point | Range; run: () => void }

const DOUBLE_NEWLINE_AT_END_RE = /.*\n.*\n$/
const NON_WHITESPACE_OR_END_RE = /\S|$/

// https://github.com/facebook/draft-js/blob/main/src/component/handlers/composition/DraftEditorCompositionHandler.js#L41
// When using keyboard English association function, conpositionEnd triggered too fast, resulting in after `insertText` still maintain association state.
const RESOLVE_DELAY = 25

// Time with no user interaction before the current user action is considered as done.
const FLUSH_DELAY = 200

// Replace with `const debug = console.log` to debug
const debug = (..._: unknown[]) => {}

// Type guard to check if a value is a DataTransfer
const isDataTransfer = (value: any): value is DataTransfer =>
  value?.constructor.name === 'DataTransfer'

const clonePoint = (point: Point): Point => ({
  path: [...point.path],
  offset: point.offset,
})

const cloneRange = (range: Range): Range => ({
  anchor: clonePoint(range.anchor),
  focus: clonePoint(range.focus),
})

export const shouldFlushStoredTextDiffForTransformMiddleware = (
  editor: ReactRuntimeEditor,
  diff: StringDiff
) => diff.text.length > 0 && hasEditorTransformMiddleware(editor, 'insertText')

export type CreateAndroidInputManagerOptions = {
  editor: ReactRuntimeEditor
  receivedUserInput: RefObject<boolean>

  scheduleOnDOMSelectionChange: DebouncedFunc<() => void>
  onDOMSelectionChange: DebouncedFunc<() => void>
}

export type AndroidInputManager = {
  flush: () => void
  scheduleFlush: () => void

  hasPendingDiffs: () => boolean
  hasPendingAction: () => boolean
  hasPendingChanges: () => boolean
  isFlushing: () => boolean | 'action'

  handleUserSelect: (range: Range | null) => void
  handleCompositionEnd: (event: React.CompositionEvent<HTMLDivElement>) => void
  handleCompositionStart: (
    event: React.CompositionEvent<HTMLDivElement>
  ) => void
  handleDOMBeforeInput: (event: InputEvent) => void
  handleKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void

  handleDomMutations: (mutations: MutationRecord[]) => void
  handleInput: () => void
}

export function createAndroidInputManager({
  editor,
  receivedUserInput,
  scheduleOnDOMSelectionChange,
  onDOMSelectionChange,
}: CreateAndroidInputManagerOptions): AndroidInputManager {
  let flushing: 'action' | boolean = false
  let compositionEndTimeoutId: ReturnType<typeof setTimeout> | null = null
  let flushTimeoutId: ReturnType<typeof setTimeout> | null = null
  let actionTimeoutId: ReturnType<typeof setTimeout> | null = null

  let idCounter = 0
  let insertPositionHint: StringDiff | null | false = false

  const applyPendingSelection = () => {
    const pendingSelection = EDITOR_TO_PENDING_SELECTION.get(editor)
    EDITOR_TO_PENDING_SELECTION.delete(editor)

    if (pendingSelection) {
      const selection = readRuntimeSelection(editor)
      const normalized = normalizeRange(editor, pendingSelection)

      debug('apply pending selection', pendingSelection, normalized)

      if (
        normalized &&
        (!selection || !RangeApi.equals(normalized, selection))
      ) {
        editor.update((tx) => {
          tx.selection.set(normalized)
        })
      }
    }
  }

  const performAction = () => {
    const action = EDITOR_TO_PENDING_ACTION.get(editor)
    EDITOR_TO_PENDING_ACTION.delete(editor)
    if (!action) {
      return
    }

    if (action.at) {
      const target = LocationApi.isPoint(action.at)
        ? normalizePoint(editor, action.at)
        : normalizeRange(editor, action.at)

      if (!target) {
        return
      }

      const targetRange = Editor.range(editor, target)
      const selection = readRuntimeSelection(editor)
      if (!selection || !RangeApi.equals(selection, targetRange)) {
        editor.update((tx) => {
          tx.selection.set(target)
        })
      }
    }

    action.run()
  }

  const flush = () => {
    if (flushTimeoutId) {
      clearTimeout(flushTimeoutId)
      flushTimeoutId = null
    }

    if (actionTimeoutId) {
      clearTimeout(actionTimeoutId)
      actionTimeoutId = null
    }

    if (!hasPendingDiffs() && !hasPendingAction()) {
      applyPendingSelection()
      return
    }

    if (!flushing) {
      flushing = true
      setTimeout(() => (flushing = false))
    }

    if (hasPendingAction()) {
      flushing = 'action'
    }

    const liveSelection = readRuntimeSelection(editor)
    const selectionRef =
      liveSelection &&
      Editor.rangeRef(editor, liveSelection, { affinity: 'forward' })
    EDITOR_TO_USER_MARKS.set(
      editor,
      editor.read((state) => state.marks.get())
    )

    debug(
      'flush',
      EDITOR_TO_PENDING_ACTION.get(editor),
      EDITOR_TO_PENDING_DIFFS.get(editor)
    )

    let scheduleSelectionChange = hasPendingDiffs()

    while (true) {
      const diff = EDITOR_TO_PENDING_DIFFS.get(editor)?.[0]
      if (!diff) break
      const pendingMarks = EDITOR_TO_PENDING_INSERTION_MARKS.get(editor)

      if (pendingMarks !== undefined) {
        EDITOR_TO_PENDING_INSERTION_MARKS.delete(editor)
        writeRuntimeMarks(editor, pendingMarks)
      }

      if (pendingMarks && insertPositionHint === false) {
        insertPositionHint = null
        debug('insert after mark placeholder')
      }

      const range = targetRange(diff)
      const selection = readRuntimeSelection(editor)
      if (!selection || !RangeApi.equals(selection, range)) {
        editor.update((tx) => {
          tx.selection.set(range)
        })
      }

      if (diff.diff.text) {
        applyEditableCommand({
          command: { kind: 'insert-text', text: diff.diff.text },
          editor,
        })
      } else {
        applyEditableCommand({
          command: { kind: 'delete-fragment' },
          editor,
        })
      }

      // Remove diff only after we have applied it to account for it when transforming
      // pending ranges.
      EDITOR_TO_PENDING_DIFFS.set(
        editor,
        EDITOR_TO_PENDING_DIFFS.get(editor)?.filter(
          ({ id }) => id !== diff.id
        ) ?? []
      )

      if (!verifyDiffState(editor, diff)) {
        debug('invalid diff state')
        scheduleSelectionChange = false
        EDITOR_TO_PENDING_ACTION.delete(editor)
        EDITOR_TO_USER_MARKS.delete(editor)
        flushing = 'action'

        // Ensure we don't restore the pending user (dom) selection
        // since the document and dom state do not match.
        EDITOR_TO_PENDING_SELECTION.delete(editor)
        scheduleOnDOMSelectionChange.cancel()
        onDOMSelectionChange.cancel()
        selectionRef?.unref()
      }
    }

    const selection = selectionRef?.unref()
    if (
      selection &&
      !EDITOR_TO_PENDING_SELECTION.get(editor) &&
      (!readRuntimeSelection(editor) ||
        !RangeApi.equals(selection, readRuntimeSelection(editor)!))
    ) {
      editor.update((tx) => {
        tx.selection.set(selection)
      })
    }

    if (hasPendingAction()) {
      performAction()
      return
    }

    // COMPAT: The selectionChange event is fired after the action is performed,
    // so we have to manually schedule it to ensure we don't 'throw away' the selection
    // while rendering if we have pending changes.
    if (scheduleSelectionChange) {
      debug('scheduleOnDOMSelectionChange pending changes')
      scheduleOnDOMSelectionChange()
    }

    scheduleOnDOMSelectionChange.flush()
    onDOMSelectionChange.flush()

    applyPendingSelection()

    const userMarks = EDITOR_TO_USER_MARKS.get(editor)
    EDITOR_TO_USER_MARKS.delete(editor)
    if (userMarks !== undefined) {
      editor.update(() => {
        writeRuntimeMarks(editor, userMarks)
      })
    }
  }

  const handleCompositionEnd = (
    _event: React.CompositionEvent<HTMLDivElement>
  ) => {
    if (compositionEndTimeoutId) {
      clearTimeout(compositionEndTimeoutId)
    }

    compositionEndTimeoutId = setTimeout(() => {
      IS_COMPOSING.set(editor, false)
      flush()
    }, RESOLVE_DELAY)
  }

  const handleCompositionStart = (
    _event: React.CompositionEvent<HTMLDivElement>
  ) => {
    debug('composition start')

    IS_COMPOSING.set(editor, true)

    if (compositionEndTimeoutId) {
      clearTimeout(compositionEndTimeoutId)
      compositionEndTimeoutId = null
    }
  }

  const updatePlaceholderVisibility = (forceHide = false) => {
    const placeholderElement = EDITOR_TO_PLACEHOLDER_ELEMENT.get(editor)
    if (!placeholderElement) {
      return
    }

    if (hasPendingDiffs() || forceHide) {
      placeholderElement.style.display = 'none'
      return
    }

    placeholderElement.style.removeProperty('display')
  }

  const storeDiff = (path: Path, diff: StringDiff) => {
    debug('storeDiff', path, diff)

    const pendingDiffs = EDITOR_TO_PENDING_DIFFS.get(editor) ?? []
    EDITOR_TO_PENDING_DIFFS.set(editor, pendingDiffs)

    const target = NodeApi.leaf(editor, path)
    const idx = pendingDiffs.findIndex((change) =>
      PathApi.equals(change.path, path)
    )
    if (idx < 0) {
      const normalized = normalizeStringDiff(target.text, diff)
      if (normalized) {
        pendingDiffs.push({ path, diff, id: idCounter++ })
      }

      updatePlaceholderVisibility()
      return
    }

    const merged = mergeStringDiffs(target.text, pendingDiffs[idx].diff, diff)
    if (!merged) {
      pendingDiffs.splice(idx, 1)
      updatePlaceholderVisibility()
      return
    }

    pendingDiffs[idx] = {
      ...pendingDiffs[idx],
      diff: merged,
    }
  }

  const canStoreDOMTextDiffAtRange = (range: Range) => {
    if (IS_NODE_MAP_DIRTY.get(editor)) {
      return false
    }

    const [start] = RangeApi.edges(range)

    const domPoint = ReactEditor.resolveDOMPoint(editor, start)

    if (!domPoint) {
      return false
    }

    const [domNode] = domPoint
    const element = isDOMText(domNode)
      ? domNode.parentElement
      : isDOMElement(domNode)
        ? domNode
        : null
    const textHost = element?.closest('[data-slate-node="text"]')

    return textHost?.getAttribute('data-slate-dom-sync') === 'true'
  }

  const scheduleAction = (
    run: () => void,
    { at }: { at?: Point | Range } = {}
  ): void => {
    insertPositionHint = false
    debug('scheduleAction', { at, run })

    EDITOR_TO_PENDING_SELECTION.delete(editor)
    scheduleOnDOMSelectionChange.cancel()
    onDOMSelectionChange.cancel()

    if (hasPendingAction()) {
      flush()
    }

    EDITOR_TO_PENDING_ACTION.set(editor, { at, run })

    // COMPAT: When deleting before a non-contenteditable element chrome only fires a beforeinput,
    // (no input) and doesn't perform any dom mutations. Without a flush timeout we would never flush
    // in this case and thus never actually perform the action.
    actionTimeoutId = setTimeout(flush)
  }

  const scheduleCommand = (
    command: EditableCommand,
    { at }: { at?: Point | Range } = {}
  ) => {
    scheduleAction(() => applyEditableCommand({ command, editor }), { at })
  }

  const handleDOMBeforeInput = (event: InputEvent): void => {
    if (flushTimeoutId) {
      clearTimeout(flushTimeoutId)
      flushTimeoutId = null
    }

    if (IS_NODE_MAP_DIRTY.get(editor)) {
      return
    }

    const { inputType: type } = event
    let targetRange: Range | null = null
    const data: DataTransfer | string | undefined =
      getInputEventData(event) ?? undefined

    if (
      insertPositionHint !== false &&
      type !== 'insertText' &&
      type !== 'insertCompositionText'
    ) {
      insertPositionHint = false
    }

    let nativeTargetRange: StaticRange | globalThis.Selection | undefined =
      getInputEventTargetRanges(event)[0]
    if (nativeTargetRange) {
      targetRange = ReactEditor.resolveSlateRange(editor, nativeTargetRange, {
        exactMatch: false,
      })
    }

    // COMPAT: SelectionChange event is fired after the action is performed, so we
    // have to manually get the selection here to ensure it's up-to-date.
    const window = ReactEditor.getWindow(editor)
    const domSelection = window.getSelection()
    if (!targetRange && domSelection) {
      nativeTargetRange = domSelection
      targetRange = ReactEditor.resolveSlateRange(editor, domSelection, {
        exactMatch: false,
      })
    }

    targetRange = targetRange ?? readRuntimeSelection(editor)
    if (!targetRange) {
      return
    }

    // By default, the input manager tries to store text diffs so that we can
    // defer flushing them at a later point in time. We don't want to flush
    // for every input event as this can be expensive. However, there are some
    // scenarios where we cannot safely store the text diff and must instead
    // schedule an action to let Slate normalize the editor state.
    let canStoreDiff = true
    const commandForTargetRange = () =>
      getEditableCommandFromBeforeInputType({
        data,
        inputType: type,
        selection: targetRange,
      })

    if (type.startsWith('delete')) {
      const direction = type.endsWith('Backward') ? 'backward' : 'forward'
      let [start, end] = RangeApi.edges(targetRange)
      let [leaf, path] = Editor.leaf(editor, start.path)

      if (
        RangeApi.isExpanded(targetRange) &&
        leaf.text.length === start.offset &&
        end.offset === 0
      ) {
        const next = Editor.next(editor, {
          at: start.path,
          match: NodeApi.isText,
        })
        if (next && PathApi.equals(next[1], end.path)) {
          // when deleting a linebreak, targetRange will span across the break (ie start in the node before and end in the node after)
          // if the node before is empty, this will look like a hanging range and get unhung later--which will take the break we want to remove out of the range
          // so to avoid this we collapse the target range to default to single character deletion
          if (direction === 'backward') {
            targetRange = { anchor: end, focus: end }
            start = end
            ;[leaf, path] = next
          } else {
            targetRange = { anchor: start, focus: start }
            end = start
          }
        }
      }

      const diff = {
        text: '',
        start: start.offset,
        end: end.offset,
      }
      const pendingDiffs = EDITOR_TO_PENDING_DIFFS.get(editor)
      const relevantPendingDiffs = pendingDiffs?.find((change) =>
        PathApi.equals(change.path, path)
      )
      const diffs = relevantPendingDiffs
        ? [relevantPendingDiffs.diff, diff]
        : [diff]
      const text = applyStringDiff(leaf.text, ...diffs)

      if (text.length === 0) {
        // Text leaf will be removed, so we need to schedule an
        // action to remove it so that Slate can normalize instead
        // of storing as a diff
        canStoreDiff = false
      }

      if (RangeApi.isExpanded(targetRange)) {
        if (
          canStoreDiff &&
          PathApi.equals(targetRange.anchor.path, targetRange.focus.path)
        ) {
          const point = { path: targetRange.anchor.path, offset: start.offset }
          const range = Editor.range(editor, point, point)
          handleUserSelect(range)

          storeDiff(targetRange.anchor.path, {
            text: '',
            end: end.offset,
            start: start.offset,
          })
          return
        }

        const command = commandForTargetRange()
        if (command) {
          scheduleCommand(command, { at: targetRange })
        }
        return
      }
    }

    switch (type) {
      case 'deleteByComposition':
      case 'deleteByCut':
      case 'deleteByDrag': {
        const command = commandForTargetRange()
        if (command) {
          scheduleCommand(command, { at: targetRange })
        }
        return
      }

      case 'deleteContent':
      case 'deleteContentForward': {
        const { anchor } = targetRange
        if (canStoreDiff && RangeApi.isCollapsed(targetRange)) {
          const targetNode = NodeApi.leaf(editor, anchor.path)

          if (anchor.offset < targetNode.text.length) {
            storeDiff(anchor.path, {
              text: '',
              start: anchor.offset,
              end: anchor.offset + 1,
            })
            return
          }
        }

        const command = commandForTargetRange()
        if (command) {
          scheduleCommand(command, { at: targetRange })
        }
        return
      }

      case 'deleteContentBackward': {
        const { anchor } = targetRange

        // If we have a mismatch between the native and slate selection being collapsed
        // we are most likely deleting a zero-width placeholder and thus should perform it
        // as an action to ensure correct behavior (mostly happens with mark placeholders)
        const nativeCollapsed = isDOMSelection(nativeTargetRange)
          ? nativeTargetRange.isCollapsed
          : !!nativeTargetRange?.collapsed

        if (
          canStoreDiff &&
          nativeCollapsed &&
          RangeApi.isCollapsed(targetRange) &&
          anchor.offset > 0
        ) {
          storeDiff(anchor.path, {
            text: '',
            start: anchor.offset - 1,
            end: anchor.offset,
          })
          return
        }

        const command = commandForTargetRange()
        if (command) {
          scheduleCommand(command, { at: targetRange })
        }
        return
      }

      case 'deleteEntireSoftLine': {
        const command = commandForTargetRange()
        if (command) {
          scheduleCommand(command, { at: targetRange })
        }
        return
      }

      case 'deleteHardLineBackward': {
        const command = commandForTargetRange()
        if (command) {
          scheduleCommand(command, { at: targetRange })
        }
        return
      }

      case 'deleteSoftLineBackward': {
        const command = commandForTargetRange()
        if (command) {
          scheduleCommand(command, { at: targetRange })
        }
        return
      }

      case 'deleteHardLineForward': {
        const command = commandForTargetRange()
        if (command) {
          scheduleCommand(command, { at: targetRange })
        }
        return
      }

      case 'deleteSoftLineForward': {
        const command = commandForTargetRange()
        if (command) {
          scheduleCommand(command, { at: targetRange })
        }
        return
      }

      case 'deleteWordBackward': {
        const command = commandForTargetRange()
        if (command) {
          scheduleCommand(command, { at: targetRange })
        }
        return
      }

      case 'deleteWordForward': {
        const command = commandForTargetRange()
        if (command) {
          scheduleCommand(command, { at: targetRange })
        }
        return
      }

      case 'insertLineBreak': {
        const command = commandForTargetRange()
        if (command) {
          scheduleCommand(command, { at: targetRange })
        }
        return
      }

      case 'insertParagraph': {
        const command = commandForTargetRange()
        if (command) {
          scheduleCommand(command, { at: targetRange })
        }
        return
      }
      case 'insertCompositionText':
      case 'deleteCompositionText':
      case 'insertFromComposition':
      case 'insertFromDrop':
      case 'insertFromPaste':
      case 'insertFromYank':
      case 'insertReplacementText':
      case 'insertText': {
        if (isDataTransfer(data)) {
          scheduleCommand({ data, kind: 'insert-data' }, { at: targetRange })
          return
        }

        let text = data ?? ''

        // COMPAT: If we are writing inside a placeholder, the ime inserts the text inside
        // the placeholder itself and thus includes the zero-width space inside edit events.
        if (EDITOR_TO_PENDING_INSERTION_MARKS.get(editor)) {
          text = text.replace('\uFEFF', '')
        }

        // Pastes from the Android clipboard will generate `insertText` events.
        // If the copied text contains any newlines, Android will append an
        // extra newline to the end of the copied text.
        if (type === 'insertText' && DOUBLE_NEWLINE_AT_END_RE.test(text)) {
          text = text.slice(0, -1)
        }

        // If the text includes a newline, split it at newlines and paste each component
        // string, with soft breaks in between each.
        if (text.includes('\n')) {
          scheduleAction(
            () => {
              const parts = text.split('\n')
              parts.forEach((line, i) => {
                if (line) {
                  applyEditableCommand({
                    command: { kind: 'insert-text', text: line },
                    editor,
                  })
                }
                if (i !== parts.length - 1) {
                  applyEditableCommand({
                    command: { kind: 'insert-break', variant: 'soft' },
                    editor,
                  })
                }
              })
            },
            {
              at: targetRange,
            }
          )
          return
        }

        if (PathApi.equals(targetRange.anchor.path, targetRange.focus.path)) {
          canStoreDiff = canStoreDiff && canStoreDOMTextDiffAtRange(targetRange)
          if (!canStoreDiff && event.cancelable) {
            event.preventDefault()
          }

          const [start, end] = RangeApi.edges(targetRange)

          const diff = {
            start: start.offset,
            end: end.offset,
            text,
          }

          // COMPAT: Swiftkey has a weird bug where the target range of the 2nd word
          // inserted after a mark placeholder is inserted with an anchor offset off by 1.
          // So writing 'some text' will result in 'some ttext'. Luckily all 'normal' insert
          // text events are fired with the correct target ranges, only the final 'insertComposition'
          // isn't, so we can adjust the target range start offset if we are confident this is the
          // swiftkey insert causing the issue.
          if (text && insertPositionHint && type === 'insertCompositionText') {
            const hintPosition =
              insertPositionHint.start +
              insertPositionHint.text.search(NON_WHITESPACE_OR_END_RE)
            const diffPosition =
              diff.start + diff.text.search(NON_WHITESPACE_OR_END_RE)

            if (
              diffPosition === hintPosition + 1 &&
              diff.end ===
                insertPositionHint.start + insertPositionHint.text.length
            ) {
              debug('adjusting swiftKey insert position using hint')
              diff.start -= 1
              insertPositionHint = null
              scheduleFlush()
            } else {
              insertPositionHint = false
            }
          } else if (type === 'insertText') {
            if (insertPositionHint === null) {
              insertPositionHint = diff
            } else if (
              insertPositionHint &&
              RangeApi.isCollapsed(targetRange) &&
              insertPositionHint.end + insertPositionHint.text.length ===
                start.offset
            ) {
              insertPositionHint = {
                ...insertPositionHint,
                text: insertPositionHint.text + text,
              }
            } else {
              insertPositionHint = false
            }
          } else {
            insertPositionHint = false
          }

          if (canStoreDiff) {
            const currentSelection = readRuntimeSelection(editor)
            storeDiff(start.path, diff)

            if (currentSelection) {
              const newPoint = {
                path: start.path,
                offset: start.offset + text.length,
              }

              scheduleAction(
                () => {
                  editor.update((tx) => {
                    tx.selection.set({
                      anchor: newPoint,
                      focus: newPoint,
                    })
                  })
                },
                { at: newPoint }
              )
            }
            if (shouldFlushStoredTextDiffForTransformMiddleware(editor, diff)) {
              scheduleFlush()
            }
            return
          }
        }

        scheduleCommand(
          { kind: 'insert-text', text },
          {
            at: cloneRange(
              canStoreDiff
                ? targetRange
                : (readRuntimeSelection(editor) ?? targetRange)
            ),
          }
        )
        return
      }
    }
  }

  const hasPendingAction = () => {
    return !!EDITOR_TO_PENDING_ACTION.get(editor)
  }

  const hasPendingDiffs = () => {
    return !!EDITOR_TO_PENDING_DIFFS.get(editor)?.length
  }

  const hasPendingChanges = () => {
    return hasPendingAction() || hasPendingDiffs()
  }

  const isFlushing = () => {
    return flushing
  }

  const handleUserSelect = (range: Range | null) => {
    EDITOR_TO_PENDING_SELECTION.set(editor, range)

    if (flushTimeoutId) {
      clearTimeout(flushTimeoutId)
      flushTimeoutId = null
    }

    const selection = editor.read((state) => state.selection.get())
    if (!range) {
      return
    }

    const pathChanged =
      !selection || !PathApi.equals(selection.anchor.path, range.anchor.path)
    const parentPathChanged =
      !selection ||
      !PathApi.equals(
        selection.anchor.path.slice(0, -1),
        range.anchor.path.slice(0, -1)
      )

    if ((pathChanged && insertPositionHint) || parentPathChanged) {
      insertPositionHint = false
    }

    if (pathChanged || hasPendingDiffs()) {
      flushTimeoutId = setTimeout(flush, FLUSH_DELAY)
    }
  }

  const handleInput = () => {
    if (hasPendingAction() || !hasPendingDiffs()) {
      debug('flush input')
      flush()
    }
  }

  const handleKeyDown = (_: React.KeyboardEvent) => {
    // COMPAT: Swiftkey closes the keyboard when typing inside a empty node
    // directly next to a non-contenteditable element (= the placeholder).
    // The only event fired soon enough for us to allow hiding the placeholder
    // without swiftkey picking it up is the keydown event, so we have to hide it
    // here. See https://github.com/ianstormtaylor/slate/pull/4988#issuecomment-1201050535
    if (!hasPendingDiffs()) {
      updatePlaceholderVisibility(true)
      setTimeout(updatePlaceholderVisibility)
    }
  }

  const scheduleFlush = () => {
    if (!hasPendingAction()) {
      actionTimeoutId = setTimeout(flush)
    }
  }

  const handleDomMutations = (mutations: MutationRecord[]) => {
    if (hasPendingDiffs() || hasPendingAction()) {
      return
    }

    if (!receivedUserInput.current) {
      return
    }

    if (
      mutations.some(
        (mutation) =>
          !isDOMTextSyncMutation(mutation) &&
          isTrackedMutation(editor, mutation, mutations)
      )
    ) {
      // Cause a re-render to restore the dom state if we encounter tracked mutations without
      // a corresponding pending action.
      EDITOR_TO_FORCE_RENDER.get(editor)?.()
    }
  }

  return {
    flush,
    scheduleFlush,

    hasPendingDiffs,
    hasPendingAction,
    hasPendingChanges,

    isFlushing,

    handleUserSelect,
    handleCompositionEnd,
    handleCompositionStart,
    handleDOMBeforeInput,
    handleKeyDown,

    handleDomMutations,
    handleInput,
  }
}
