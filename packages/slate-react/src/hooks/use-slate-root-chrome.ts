import { type MouseEventHandler, useMemo } from 'react'
import type { RootKey } from 'slate'

import { useRootInteractionController } from '../editable/root-interaction-controller'
import {
  useRequiredSlateRuntimeContext,
  useSlateRootEditor,
} from './use-slate-runtime'

const MAIN_ROOT_KEY: RootKey = 'main'

export type UseSlateRootChromeOptions = {
  disabled?: boolean
  selection?: 'end' | 'restore'
}

export type SlateRootChromeController = {
  props: {
    'data-slate-root-chrome': RootKey
    onMouseDownCapture: MouseEventHandler<HTMLElement>
    onMouseUpCapture: MouseEventHandler<HTMLElement>
  }
  root: RootKey
}

export function useSlateRootChrome(
  root: RootKey = MAIN_ROOT_KEY,
  { disabled = false, selection = 'restore' }: UseSlateRootChromeOptions = {}
): SlateRootChromeController {
  const editor = useSlateRootEditor(root)
  const { getLastSelectionForRoot, getMountedViewEditor } =
    useRequiredSlateRuntimeContext()
  const { onMouseDownCapture, onMouseUpCapture } = useRootInteractionController(
    {
      disabled,
      editor,
      getLastSelectionForRoot,
      getMountedViewEditor,
      root,
      selection,
    }
  )

  return useMemo(
    () => ({
      props: {
        'data-slate-root-chrome': root,
        onMouseDownCapture,
        onMouseUpCapture,
      },
      root,
    }),
    [onMouseDownCapture, onMouseUpCapture, root]
  )
}
