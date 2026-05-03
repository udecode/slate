import { Editor, type EditorStaticApi } from '../interfaces/editor'
import { Point } from '../interfaces/point'

export const isStart: EditorStaticApi['isStart'] = (editor, point, at) => {
  // PERF: If the offset isn't `0` we know it's not the start.
  if (point.offset !== 0) {
    return false
  }

  const start = Editor.point(editor, at, { edge: 'start' })
  return Point.equals(point, start)
}
