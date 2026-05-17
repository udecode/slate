import type { Value } from 'slate'
import type { DOMApi, DOMClipboardApi } from 'slate-dom'
import { DOMEditor, type DOMEditorInterface } from 'slate-dom/internal'

/**
 * A React and DOM-specific version of the `Editor` interface.
 */

export interface ReactEditor<V extends Value = Value> extends DOMEditor<V> {
  api: DOMEditor<V>['api'] & {
    clipboard: DOMClipboardApi
    dom: DOMApi
  }
}

export interface ReactEditorInterface extends DOMEditorInterface {}

export const ReactEditor: ReactEditorInterface = DOMEditor
