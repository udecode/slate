import { Editor, type EditorStaticApi } from '../interfaces/editor'
import { Location, type Span } from '../interfaces/location'
import { Node } from '../interfaces/node'
import { nodes } from './nodes'

export const next: EditorStaticApi['next'] = (editor, options = {}) => {
  const { mode = 'lowest', voids = false } = options
  let { match, at = Editor.getSnapshot(editor).selection } = options

  if (!at) {
    return
  }

  const pointAfterLocation = Editor.after(editor, at, { voids })

  if (!pointAfterLocation) return

  const [, to] = Editor.last(editor, [])

  const span: Span = [pointAfterLocation.path, to]

  if (Location.isPath(at) && at.length === 0) {
    throw new Error('Cannot get the next node from the root node!')
  }

  if (match == null) {
    if (Location.isPath(at)) {
      const [parent] = Editor.parent(editor, at)
      const children = Node.isEditor(parent)
        ? Editor.getChildren(editor)
        : parent.children
      match = (n) => !Node.isEditor(n) && children.includes(n)
    } else {
      match = () => true
    }
  }

  const [next] = nodes(editor, { at: span, match, mode, voids })
  return next
}
