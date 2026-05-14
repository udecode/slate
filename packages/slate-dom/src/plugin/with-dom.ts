import {
  LocationApi,
  NodeApi,
  type NodeEntry,
  type Path,
  PathApi,
  type PathRef,
  RangeApi,
} from 'slate'
import {
  Editor,
  getEditorTransformRegistry,
  setEditorTransformRegistry,
} from 'slate/internal'
import {
  type TextDiff,
  transformPendingPoint,
  transformPendingRange,
  transformTextDiff,
} from '../utils/diff-text'
import type { Key } from '../utils/key'
import { findCurrentLineRange } from '../utils/lines'
import {
  EDITOR_TO_KEY_TO_ELEMENT,
  EDITOR_TO_PENDING_ACTION,
  EDITOR_TO_PENDING_DIFFS,
  EDITOR_TO_PENDING_INSERTION_MARKS,
  EDITOR_TO_PENDING_SELECTION,
  EDITOR_TO_SCHEDULE_FLUSH,
  EDITOR_TO_USER_MARKS,
  EDITOR_TO_USER_SELECTION,
  IS_NODE_MAP_DIRTY,
  NODE_TO_KEY,
} from '../utils/weak-maps'
import { setDOMClipboardFormatKey } from './dom-clipboard-runtime'
import { createDOMEditorCapability, DOMEditor } from './dom-editor'

const DEFAULT_CLIPBOARD_FORMAT_KEY = 'x-slate-fragment'

export interface DOMEditorOptions {
  /**
   * Bare `DataTransfer` subtype for Slate's internal fragment payload.
   *
   * Slate writes and reads `application/${clipboardFormatKey}`.
   */
  clipboardFormatKey?: string
}

/**
 * `withDOM` adds DOM specific behaviors to the editor.
 *
 * TypeScript value generics are preserved from the editor passed to this
 * plugin.
 */

export const withDOM = <
  V extends import('slate').Value,
  T extends import('slate').Editor<V>,
>(
  editor: T,
  options: DOMEditorOptions = {}
): T & DOMEditor<V> => {
  const e = editor as unknown as T & DOMEditor<V>
  const transforms = getEditorTransformRegistry(e)
  const { clipboardFormatKey = DEFAULT_CLIPBOARD_FORMAT_KEY } = options

  setDOMClipboardFormatKey(e, clipboardFormatKey)
  e.dom = createDOMEditorCapability(e)

  // The WeakMap which maps a key to a specific HTMLElement must be scoped to the editor instance to
  // avoid collisions between editors in the DOM that share the same value.
  EDITOR_TO_KEY_TO_ELEMENT.set(e, new WeakMap())

  setEditorTransformRegistry(e, {
    ...transforms,
    addMark: (key, value) => {
      EDITOR_TO_SCHEDULE_FLUSH.get(e)?.()

      if (
        !EDITOR_TO_PENDING_INSERTION_MARKS.get(e) &&
        EDITOR_TO_PENDING_DIFFS.get(e)?.length
      ) {
        // Ensure the current pending diffs originating from changes before the addMark
        // are applied with the current formatting
        EDITOR_TO_PENDING_INSERTION_MARKS.set(e, null)
      }

      EDITOR_TO_USER_MARKS.delete(e)

      transforms.addMark(key, value)
    },

    removeMark: (key) => {
      if (
        !EDITOR_TO_PENDING_INSERTION_MARKS.get(e) &&
        EDITOR_TO_PENDING_DIFFS.get(e)?.length
      ) {
        // Ensure the current pending diffs originating from changes before the addMark
        // are applied with the current formatting
        EDITOR_TO_PENDING_INSERTION_MARKS.set(e, null)
      }

      EDITOR_TO_USER_MARKS.delete(e)

      transforms.removeMark(key)
    },

    deleteBackward: (unit) => {
      if (unit !== 'line') {
        return transforms.deleteBackward(unit)
      }

      const selection = e.read((state) => state.selection.get())

      if (selection && RangeApi.isCollapsed(selection)) {
        const parentBlockEntry = Editor.above(e, {
          match: (n) => NodeApi.isElement(n) && Editor.isBlock(e, n),
          at: selection,
        })

        if (parentBlockEntry) {
          const [, parentBlockPath] = parentBlockEntry
          const parentElementRange = Editor.range(
            e,
            parentBlockPath,
            selection.anchor
          )

          const currentLineRange = findCurrentLineRange(e, parentElementRange)

          if (!RangeApi.isCollapsed(currentLineRange)) {
            transforms.delete({ at: currentLineRange })
          }
        }
      }
    },
  })

  // This attempts to reset the NODE_TO_KEY entry to the correct value
  // as operation application changes object references and invalidates NODE_TO_KEY.
  e.extend({
    name: 'slate-dom-operation-middleware',
    operationMiddlewares: [
      ({ operation: op }, next) => {
        const matches: [Path, Key][] = []
        const pathRefMatches: [PathRef, Key][] = []

        const pendingDiffs = EDITOR_TO_PENDING_DIFFS.get(e)
        if (pendingDiffs?.length) {
          const transformed = pendingDiffs
            .map((textDiff) => transformTextDiff(textDiff, op))
            .filter(Boolean) as TextDiff[]

          EDITOR_TO_PENDING_DIFFS.set(e, transformed)
        }

        const pendingSelection = EDITOR_TO_PENDING_SELECTION.get(e)
        if (pendingSelection) {
          EDITOR_TO_PENDING_SELECTION.set(
            e,
            transformPendingRange(e, pendingSelection, op)
          )
        }

        const pendingAction = EDITOR_TO_PENDING_ACTION.get(e)
        if (pendingAction?.at) {
          const at = LocationApi.isPoint(pendingAction?.at)
            ? transformPendingPoint(e, pendingAction.at, op)
            : transformPendingRange(e, pendingAction.at, op)

          EDITOR_TO_PENDING_ACTION.set(e, at ? { ...pendingAction, at } : null)
        }

        switch (op.type) {
          case 'insert_text':
          case 'remove_text':
          case 'set_node':
          case 'split_node': {
            matches.push(...getMatches(e, op.path))
            break
          }

          case 'set_selection': {
            // Selection was manually set, don't restore the user selection after the change.
            EDITOR_TO_USER_SELECTION.get(e)?.unref()
            EDITOR_TO_USER_SELECTION.delete(e)
            break
          }

          case 'insert_node':
          case 'remove_node': {
            pathRefMatches.push(
              ...getPathRefMatches(e, PathApi.parent(op.path))
            )
            break
          }

          case 'merge_node': {
            const prevPath = PathApi.previous(op.path)
            matches.push(...getMatches(e, prevPath))
            break
          }

          case 'move_node': {
            const commonPath = PathApi.common(
              PathApi.parent(op.path),
              PathApi.parent(op.newPath)
            )
            matches.push(...getMatches(e, commonPath))

            let changedPath: Path
            if (PathApi.isBefore(op.path, op.newPath)) {
              matches.push(...getMatches(e, PathApi.parent(op.path)))
              changedPath = op.newPath
            } else {
              matches.push(...getMatches(e, PathApi.parent(op.newPath)))
              changedPath = op.path
            }

            const changedNode = NodeApi.get(e, PathApi.parent(changedPath))
            const changedNodeKey = DOMEditor.findKey(e, changedNode)
            const changedPathRef = Editor.pathRef(
              e,
              PathApi.parent(changedPath)
            )
            pathRefMatches.push([changedPathRef, changedNodeKey])

            break
          }
        }

        next(op)

        switch (op.type) {
          case 'insert_node':
          case 'remove_node':
          case 'merge_node':
          case 'move_node':
          case 'split_node':
          case 'insert_text':
          case 'remove_text': {
            // FIXME: Rename to something like IS_DOM_EDITOR_DESYNCED
            // to better reflect reality, see #5792
            IS_NODE_MAP_DIRTY.set(e, true)
          }
        }

        for (const [path, key] of matches) {
          const [node] = e.read((state) => state.nodes.get(path))
          NODE_TO_KEY.set(node, key)
        }

        for (const [pathRef, key] of pathRefMatches) {
          if (pathRef.current) {
            const [node] = e.read((state) => state.nodes.get(pathRef.current!))
            NODE_TO_KEY.set(node, key)
          }

          pathRef.unref()
        }
      },
    ],
  })

  return e
}

const getMatches = (e: DOMEditor<any>, path: Path) => {
  const matches: [Path, Key][] = []
  for (const [n, p] of Editor.levels(e, { at: path })) {
    const key = DOMEditor.findKey(e, n)
    matches.push([p, key])
  }
  return matches
}

const getPathRefMatches = (e: DOMEditor<any>, path: Path) => {
  const matches: [PathRef, Key][] = []

  const entries = e.read((state) => {
    const matches: NodeEntry[] = []

    for (const entry of state.nodes.entries({
      at: path,
      mode: 'all',
      voids: true,
    })) {
      matches.push(entry)
    }

    return matches
  })

  for (const [n, p] of entries) {
    const key = DOMEditor.findKey(e, n)
    const pathRef = Editor.pathRef(e, p)

    matches.push([pathRef, key])
  }

  return matches
}
