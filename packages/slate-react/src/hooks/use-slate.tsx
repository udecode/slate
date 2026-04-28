import { useContext, useReducer } from 'react'
import type { ReactEditor } from '../plugin/react-editor'
import { useIsomorphicLayoutEffect } from './use-isomorphic-layout-effect'
import { SlateSelectorContext } from './use-slate-selector'
import { useSlateStatic } from './use-slate-static'

export const useSlate = <
  TEditor extends ReactEditor<any> = ReactEditor<any>,
>(): TEditor => {
  const { addEventListener } = useContext(SlateSelectorContext)
  const [, forceRender] = useReducer((s) => s + 1, 0)

  if (!addEventListener) {
    throw new Error(
      `The \`useSlate\` hook must be used inside the <Slate> component's context.`
    )
  }

  useIsomorphicLayoutEffect(
    () => addEventListener(forceRender),
    [addEventListener]
  )

  return useSlateStatic<TEditor>()
}

export const useSlateWithV = <
  TEditor extends ReactEditor<any> = ReactEditor<any>,
>(): {
  editor: TEditor
  v: number
} => {
  const editor = useSlate<TEditor>()
  const [v, incrementVersion] = useReducer((state) => state + 1, 0)

  useIsomorphicLayoutEffect(
    () => editor.subscribe(() => incrementVersion()),
    [editor]
  )

  return { editor, v }
}
