import { useState } from 'react'
import type { Value } from 'slate'

import {
  type CreateReactEditorOptions,
  createReactEditor,
} from '../plugin/with-react'

export type UseSlateEditorOptions<
  V extends Value = Value,
  TExtensions extends readonly unknown[] = readonly [],
> = CreateReactEditorOptions<V, TExtensions>

export const useSlateEditor = <
  V extends Value = Value,
  const TExtensions extends readonly unknown[] = readonly [],
>(
  options: UseSlateEditorOptions<V, TExtensions> = {}
) => {
  const [editor] = useState(() => createReactEditor(options))

  return editor
}
