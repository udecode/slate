import { Editor, type EditorInterface, type Value } from '../interfaces/editor'
import type { DescendantIn } from '../interfaces/node'
import { Node } from '../interfaces/node'
import { Range } from '../interfaces/range'

export const fragment = (<V extends Value>(
  editor: import('../interfaces/editor').Editor<V>,
  at: import('../interfaces').Location
): DescendantIn<V>[] => {
  const range = Editor.range(editor, at)

  if (Range.isCollapsed(range)) {
    return []
  }

  return Node.fragment(editor, range) as DescendantIn<V>[]
}) satisfies EditorInterface['fragment']
