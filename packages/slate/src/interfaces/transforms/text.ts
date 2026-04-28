import type { DescendantIn, Editor, Location, Value } from '../../index'
import type { TextUnit } from '../../types/types'

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

export interface TextMutationMethods<V extends Value = Value> {
  /**
   * Delete content in the editor.
   */
  delete: (editor: Editor<V>, options?: TextDeleteOptions) => void

  /**
   * Insert a fragment in the editor
   * at the specified location or (if not defined) the current selection or (if not defined) the end of the document.
   */
  insertFragment: (
    editor: Editor<V>,
    fragment: DescendantIn<V>[],
    options?: TextInsertFragmentOptions
  ) => void

  /**
   * Insert a string of text in the editor
   * at the specified location or (if not defined) the current selection or (if not defined) the end of the document.
   */
  insertText: (
    editor: Editor<V>,
    text: string,
    options?: TextInsertTextOptions
  ) => void

  /**
   * Remove a string of text at a point or the current selection anchor.
   */
  removeText: (
    editor: Editor<V>,
    text: string,
    options?: TextRemoveTextOptions
  ) => void
}
