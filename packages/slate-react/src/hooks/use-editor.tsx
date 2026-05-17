import { createContext, useContext } from 'react'
import type { Editor } from 'slate'
import type { ReactEditorInstance } from '../plugin/with-react'

/**
 * A React context for sharing the editor object.
 */

export const EditorContext = createContext<ReactEditorInstance<any> | null>(
  null
)

/**
 * Get the current editor object from the React context.
 */

export const useEditor = <
  TEditor extends Editor<any> = ReactEditorInstance<any>,
>(): TEditor => {
  const editor = useContext(EditorContext)

  if (!editor) {
    throw new Error(
      `The \`useEditor\` hook must be used inside the <Slate> component's context.`
    )
  }

  return editor as unknown as TEditor
}
