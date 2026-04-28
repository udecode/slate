import { executeCommand } from '../core/command-registry'
import {
  getCurrentMarks,
  setCurrentMarks,
  withTransaction,
} from '../core/public-state'
import {
  Editor,
  Location,
  Range,
  type Location as SlateLocation,
} from '../interfaces'
import type { EditorInterface } from '../interfaces/editor'
import type { TextInsertTextOptions } from '../interfaces/transforms/text'
import { applyInsertText } from '../transforms-text/insert-text'

type InsertTextCommand = {
  options: Parameters<EditorInterface['insertText']>[2]
  text: string
  type: 'insert_text'
}

const shouldIgnoreTarget = (
  editor: Parameters<EditorInterface['insertText']>[0],
  at: SlateLocation | null | undefined,
  options: TextInsertTextOptions | undefined
) => {
  const voids = options?.voids ?? false
  const target = (() => {
    if (!at) return null
    if (Location.isPoint(at)) return at
    if (Location.isRange(at) && Range.isCollapsed(at)) return at.anchor
    return null
  })()

  return (
    target != null &&
    ((!voids && Editor.void(editor, { at: target })) ||
      Editor.elementReadOnly(editor, { at: target }))
  )
}

export const insertText: EditorInterface['insertText'] = (
  editor,
  text,
  options = {}
) => {
  executeCommand<InsertTextCommand>(
    editor,
    { options, text, type: 'insert_text' },
    (command) => {
      let handled = false

      withTransaction(editor, (tx) => {
        const hasExplicitAt = command.options?.at !== undefined
        const target = tx.resolveTarget({ at: command.options?.at })
        const marks = getCurrentMarks(editor)

        if (!target) {
          return
        }

        if (shouldIgnoreTarget(editor, target, command.options)) {
          handled = true
          return
        }

        if (marks && !hasExplicitAt) {
          const node = { text: command.text, ...marks }
          editor.insertNodes(node, {
            at: target,
            select: !hasExplicitAt,
            voids: command.options?.voids,
          })
        } else {
          applyInsertText(editor, command.text, {
            ...command.options,
            at: target,
          })
        }

        if (!hasExplicitAt) {
          setCurrentMarks(editor, null)
        }
        handled = true
      })

      return { handled }
    }
  )
}
