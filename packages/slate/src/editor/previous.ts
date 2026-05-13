import { Editor, type EditorStaticApi } from '../interfaces/editor'
import { LocationApi, type Span } from '../interfaces/location'
import { NodeApi } from '../interfaces/node'
import { nodes } from './nodes'

export const previous: EditorStaticApi['previous'] = (editor, options = {}) => {
  const { mode = 'lowest', voids = false } = options
  let { match, at = Editor.getSnapshot(editor).selection } = options

  if (!at) {
    return
  }

  const pointBeforeLocation = Editor.before(editor, at, { voids })

  if (!pointBeforeLocation) {
    return
  }

  const [, to] = Editor.first(editor, [])

  // The search location is from the start of the document to the path of
  // the point before the location passed in
  const span: Span = [pointBeforeLocation.path, to]

  if (LocationApi.isPath(at) && at.length === 0) {
    throw new Error('Cannot get the previous node from the root node!')
  }

  if (match == null) {
    if (LocationApi.isPath(at)) {
      const [parent] = Editor.parent(editor, at)
      const children = NodeApi.isEditor(parent)
        ? Editor.getChildren(editor)
        : parent.children
      match = (n) => !NodeApi.isEditor(n) && children.includes(n)
    } else {
      match = () => true
    }
  }

  const [previous] = nodes(editor, {
    reverse: true,
    at: span,
    match,
    mode,
    voids,
  })

  return previous
}
