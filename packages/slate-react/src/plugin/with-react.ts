import type { BaseEditor, ValueOf } from 'slate'
import { EDITOR_TO_PENDING_SELECTION, withDOM } from 'slate-dom'
import type { ReactEditor } from './react-editor'

const ANDROID_USER_AGENT_RE = /Android/

/**
 * `withReact` adds React and DOM specific behaviors to the editor.
 *
 * TypeScript value generics are preserved from the editor passed to this
 * plugin.
 */
export function withReact<T extends BaseEditor<any>>(
  editor: T,
  clipboardFormatKey?: string
): T & ReactEditor<ValueOf<T>>
export function withReact(
  editor: BaseEditor<any>,
  clipboardFormatKey = 'x-slate-fragment'
): BaseEditor<any> & ReactEditor {
  let e = editor as BaseEditor<any> & ReactEditor

  e = withDOM(e, clipboardFormatKey)

  const { insertText } = e

  if (
    typeof navigator !== 'undefined' &&
    ANDROID_USER_AGENT_RE.test(navigator.userAgent)
  ) {
    e.insertText = (text, options) => {
      // COMPAT: Android devices, specifically Samsung devices, experience cursor jumping.
      // This issue occurs when the ⁠insertText function is called immediately after typing.
      // The problem arises because typing schedules a selection change.
      // However, this selection change is only executed after the ⁠insertText function.
      // As a result, the already obsolete selection is applied, leading to incorrect
      // final cursor position.
      EDITOR_TO_PENDING_SELECTION.delete(e)

      return insertText(text, options)
    }
  }

  return e
}
