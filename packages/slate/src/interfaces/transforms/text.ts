import { Editor, Location, type Node, Range, Transforms } from '../../index'
import type { TextUnit } from '../../types/types'
import { getDefaultInsertLocation } from '../../utils'

export interface TextDeleteOptions {
  at?: Location
  distance?: number
  unit?: TextUnit
  reverse?: boolean
  hanging?: boolean
  voids?: boolean
}

export interface TextInsertFragmentOptions {
  at?: Location
  hanging?: boolean
  voids?: boolean
  batchDirty?: boolean
}

export interface TextInsertTextOptions {
  at?: Location
  voids?: boolean
}

export interface TextRemoveTextOptions {
  at?: { path: number[]; offset: number }
}

export interface TextTransforms {
  /**
   * Delete content in the editor.
   */
  delete: (editor: Editor, options?: TextDeleteOptions) => void

  /**
   * Insert a fragment in the editor
   * at the specified location or (if not defined) the current selection or (if not defined) the end of the document.
   */
  insertFragment: (
    editor: Editor,
    fragment: Node[],
    options?: TextInsertFragmentOptions
  ) => void

  /**
   * Insert a string of text in the editor
   * at the specified location or (if not defined) the current selection or (if not defined) the end of the document.
   */
  insertText: (
    editor: Editor,
    text: string,
    options?: TextInsertTextOptions
  ) => void

  /**
   * Remove a string of text at a point or the current selection anchor.
   */
  removeText: (
    editor: Editor,
    text: string,
    options?: TextRemoveTextOptions
  ) => void
}

// eslint-disable-next-line no-redeclare
export const TextTransforms: TextTransforms = {
  delete(editor, options) {
    editor.delete(options)
  },
  insertFragment(editor, fragment, options) {
    editor.insertFragment(fragment, options)
  },
  insertText(
    editor: Editor,
    text: string,
    options: TextInsertTextOptions = {}
  ): void {
    const { voids = false } = options
    const defaultAt = options.at ?? getDefaultInsertLocation(editor)
    const preflightAt = (() => {
      if (Location.isPath(defaultAt)) {
        return Editor.range(editor, defaultAt)
      }

      if (Location.isRange(defaultAt) && Range.isCollapsed(defaultAt)) {
        return defaultAt.anchor
      }

      return defaultAt
    })()

    if (
      Location.isPoint(preflightAt) &&
      ((!voids && Editor.void(editor, { at: preflightAt })) ||
        Editor.elementReadOnly(editor, { at: preflightAt }))
    ) {
      return
    }

    Editor.withoutNormalizing(editor, () => {
      const preserveNullSelection =
        options.at != null && editor.selection == null
      let { at = getDefaultInsertLocation(editor) } = options

      if (Location.isPath(at)) {
        at = Editor.range(editor, at)
      }

      if (Location.isRange(at)) {
        if (Range.isCollapsed(at)) {
          at = at.anchor
        } else {
          const end = Range.end(at)
          if (!voids && Editor.void(editor, { at: end })) {
            return
          }
          const start = Range.start(at)
          const startRef = Editor.pointRef(editor, start)
          const endRef = Editor.pointRef(editor, end)
          Transforms.delete(editor, { at, voids })
          const startPoint = startRef.unref()
          const endPoint = endRef.unref()

          at = startPoint || endPoint!

          if (options.at == null) {
            Transforms.setSelection(editor, { anchor: at, focus: at })
          } else if (preserveNullSelection) {
            Transforms.deselect(editor)
          }
        }
      }

      if (
        (!voids && Editor.void(editor, { at })) ||
        Editor.elementReadOnly(editor, { at })
      ) {
        return
      }

      const { path, offset } = at
      if (text.length > 0)
        editor.apply({ type: 'insert_text', path, offset, text })
    })
  },
  removeText(
    editor: Editor,
    text: string,
    options: TextRemoveTextOptions = {}
  ) {
    const point = options.at ?? Editor.getSnapshot(editor).selection?.anchor

    if (!point) {
      throw new Error(
        'removeText requires a location when the editor has no selection'
      )
    }

    editor.apply({
      type: 'remove_text',
      path: point.path,
      offset: point.offset,
      text,
    })
  },
}
