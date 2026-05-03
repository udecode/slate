import { Editor, type EditorStaticApi } from '../interfaces/editor'
import { Point } from '../interfaces/point'

export const isEnd: EditorStaticApi['isEnd'] = (editor, point, at) => {
  const end = Editor.point(editor, at, { edge: 'end' })
  return Point.equals(point, end)
}
