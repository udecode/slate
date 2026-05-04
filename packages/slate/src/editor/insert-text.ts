import { executeCommand } from '../core/command-registry'
import {
  getCurrentMarks,
  runEditorTransaction,
  setCurrentMarks,
} from '../core/public-state'
import { getEditorTransformRegistry } from '../core/transform-registry'
import { Location, Range, type Location as SlateLocation } from '../interfaces'
import type { EditorStaticApi } from '../interfaces/editor'
import { Editor } from '../interfaces/editor'
import type { TextInsertTextOptions } from '../interfaces/transforms/text'
import { applyInsertText } from '../transforms-text/insert-text'
import { elementReadOnly } from './element-read-only'

type InsertTextCommand = {
  options: Parameters<EditorStaticApi['insertText']>[2]
  text: string
  type: 'insert_text'
}

const shouldIgnoreTarget = (
  editor: Parameters<EditorStaticApi['insertText']>[0],
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
      elementReadOnly(editor, { at: target }))
  )
}

export const insertText: EditorStaticApi['insertText'] = (
  editor,
  text,
  options = {}
) => {
  executeCommand<InsertTextCommand>(
    editor,
    { options, text, type: 'insert_text' },
    (command) => {
      let handled = false

      runEditorTransaction(editor, (tx) => {
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
          getEditorTransformRegistry(editor).insertNodes(node, {
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
