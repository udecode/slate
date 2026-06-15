import { type MouseEventHandler, useMemo } from 'react'
import type { RootKey } from 'slate'

import { useRootInteractionController } from '../editable/root-interaction-controller'
import {
  useRequiredSlateRuntimeContext,
  useSlateRootEditor,
} from './use-slate-runtime'

const MAIN_ROOT_KEY: RootKey = 'main'

/** Options for mouse interaction on root-level chrome outside editable text. */
export type UseSlateRootChromeOptions = {
  disabled?: boolean
  selection?: 'end' | 'restore'
}

/** Props and root metadata for root-level mouse interaction chrome. */
export type SlateRootChromeController = {
  props: {
    'data-slate-root-chrome': RootKey
    onMouseDownCapture: MouseEventHandler<HTMLElement>
    onMouseMoveCapture: MouseEventHandler<HTMLElement>
    onMouseUpCapture: MouseEventHandler<HTMLElement>
  }
  root: RootKey
}

/**
 * Create props for root-level mouse interaction outside editable content.
 */
export function useSlateRootChrome(
  root: RootKey = MAIN_ROOT_KEY,
  { disabled = false, selection = 'restore' }: UseSlateRootChromeOptions = {}
): SlateRootChromeController {
  const editor = useSlateRootEditor(root)
  const { getLastSelectionForRoot, getMountedViewEditor } =
    useRequiredSlateRuntimeContext()
  const { onMouseDownCapture, onMouseMoveCapture, onMouseUpCapture } =
    useRootInteractionController({
      disabled,
      editor,
      getLastSelectionForRoot,
      getMountedViewEditor,
      root,
      selection,
    })

  return useMemo(
    () => ({
      props: {
        'data-slate-root-chrome': root,
        onMouseDownCapture,
        onMouseMoveCapture,
        onMouseUpCapture,
      },
      root,
    }),
    [onMouseDownCapture, onMouseMoveCapture, onMouseUpCapture, root]
  )
}
