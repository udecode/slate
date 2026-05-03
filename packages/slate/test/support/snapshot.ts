import type { Editor, EditorSnapshot, Value } from '../../src'

export const getTestEditorSnapshot = <V extends Value>(
  editor: Editor<V>
): EditorSnapshot<V> => editor.read((state) => state.runtime.snapshot())
