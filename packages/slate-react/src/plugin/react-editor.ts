import type { Value } from 'slate'
import { DOMEditor, type DOMEditorInterface } from 'slate-dom/internal'

/**
 * A React and DOM-specific version of the `Editor` interface.
 */

export interface ReactEditor<V extends Value = Value> extends DOMEditor<V> {}

export interface ReactEditorInterface extends DOMEditorInterface {}

// eslint-disable-next-line no-redeclare
export const ReactEditor: ReactEditorInterface = DOMEditor
