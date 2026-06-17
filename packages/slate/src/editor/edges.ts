import { Editor, type EditorStaticApi } from '../interfaces/editor'

export const edges: EditorStaticApi['edges'] = (editor, at) => {
  return [
    Editor.point(editor, at, { edge: 'start' }),
    Editor.point(editor, at, { edge: 'end' }),
  ]
}
