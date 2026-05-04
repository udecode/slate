import { useState } from 'react'
import { type CreateEditorOptions, createEditor, type Value } from 'slate'

import type { ReactEditor } from '../plugin/react-editor'
import { withReact } from '../plugin/with-react'

export type SlateEditorComposer<
  V extends Value,
  E extends ReactEditor<V> = ReactEditor<V>,
> = (editor: ReactEditor<V>) => E

export type UseSlateEditorOptions<
  V extends Value = Value,
  E extends ReactEditor<V> = ReactEditor<V>,
> = CreateEditorOptions<V> & {
  withEditor?: SlateEditorComposer<V, E>
}

export const useSlateEditor = <
  V extends Value = Value,
  E extends ReactEditor<V> = ReactEditor<V>,
>(
  options: UseSlateEditorOptions<V, E> = {}
): E => {
  const [editor] = useState(() => {
    const { withEditor, ...editorOptions } = options
    const reactEditor = withReact(createEditor<V>(editorOptions))

    return withEditor ? withEditor(reactEditor) : (reactEditor as unknown as E)
  })

  return editor
}
