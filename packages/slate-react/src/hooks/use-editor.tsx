import { createContext, useContext } from 'react'
import type { ReactEditor } from '../plugin/react-editor'

/**
 * A React context for sharing the editor object.
 */

export const EditorContext = createContext<ReactEditor<any> | null>(null)

/**
 * Get the current editor object from the React context.
 */

export const useEditor = <
  TEditor extends ReactEditor<any> = ReactEditor<any>,
>(): TEditor => {
  const editor = useContext(EditorContext)

  if (!editor) {
    throw new Error(
      `The \`useEditor\` hook must be used inside the <Slate> component's context.`
    )
  }

  return editor as TEditor
}
