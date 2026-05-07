import type { Editor, ValueOf } from 'slate'
import {
  type DOMEditorOptions,
  EDITOR_TO_PENDING_SELECTION,
  withDOM,
} from 'slate-dom'
import {
  getEditorTransformRegistry,
  setEditorTransformRegistry,
} from '../editable/runtime-editor-api'
import type { ReactEditor } from './react-editor'

const ANDROID_USER_AGENT_RE = /Android/

export interface ReactEditorOptions extends DOMEditorOptions {}

/**
 * `withReact` adds React and DOM specific behaviors to the editor.
 *
 * TypeScript value generics are preserved from the editor passed to this
 * plugin.
 */
export function withReact<T extends Editor<any>>(
  editor: T,
  options?: ReactEditorOptions
): T & ReactEditor<ValueOf<T>>
export function withReact(
  editor: Editor<any>,
  options: ReactEditorOptions = {}
): Editor<any> & ReactEditor {
  let e = editor as Editor<any> & ReactEditor

  e = withDOM(e, options)

  const transforms = getEditorTransformRegistry(e)

  if (
    typeof navigator !== 'undefined' &&
    ANDROID_USER_AGENT_RE.test(navigator.userAgent)
  ) {
    setEditorTransformRegistry(e, {
      ...transforms,
      insertText: (text, options) => {
        // COMPAT: Android devices, specifically Samsung devices, experience cursor jumping.
        // This issue occurs when the ⁠insertText function is called immediately after typing.
        // The problem arises because typing schedules a selection change.
        // However, this selection change is only executed after the ⁠insertText function.
        // As a result, the already obsolete selection is applied, leading to incorrect
        // final cursor position.
        EDITOR_TO_PENDING_SELECTION.delete(e)

        return transforms.insertText(text, options)
      },
    })
  }

  return e
}
