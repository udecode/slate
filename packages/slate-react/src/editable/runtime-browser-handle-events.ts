import type { RefObject } from 'react'
import type { Range } from 'slate'
import { useIsomorphicLayoutEffect } from '../hooks/use-isomorphic-layout-effect'
import type { ReactRuntimeEditor } from '../plugin/react-editor'
import {
  attachSlateBrowserHandle,
  type SlateBrowserHandleElement,
} from './browser-handle'
import type { EditableInputController } from './input-state'
import type { Editor } from './runtime-editor-api'

type DeferredInputRule = ({
  data,
  event,
  inputType,
  selection,
}: {
  data: unknown
  event?: InputEvent
  inputType: string
  selection: Range | null
}) => boolean

export const useRuntimeBrowserHandle = ({
  applyInputRules,
  browserHandleNextId,
  browserHandleRangeRefs,
  editor,
  forceRender,
  inputController,
  isShellBackedSelection,
  rootRef,
  setExplicitShellBackedSelection,
}: {
  applyInputRules: DeferredInputRule
  browserHandleNextId: RefObject<number>
  browserHandleRangeRefs: RefObject<
    Map<string, ReturnType<typeof Editor.rangeRef>>
  >
  editor: ReactRuntimeEditor
  forceRender: () => void
  inputController: EditableInputController
  isShellBackedSelection: (selection: Range | null) => boolean
  rootRef: RefObject<HTMLDivElement | null>
  setExplicitShellBackedSelection: (nextValue: boolean) => void
}) => {
  useIsomorphicLayoutEffect(() => {
    if (!rootRef.current) {
      return
    }

    return attachSlateBrowserHandle({
      browserHandleNextId,
      browserHandleRangeRefs,
      editor,
      element: rootRef.current as SlateBrowserHandleElement,
      inputController,
      applyInputRules,
      forceRender,
      isShellBackedSelection,
      setExplicitShellBackedSelection,
    })
  }, [
    applyInputRules,
    browserHandleNextId,
    browserHandleRangeRefs,
    editor,
    forceRender,
    inputController,
    isShellBackedSelection,
    rootRef,
    setExplicitShellBackedSelection,
  ])
}
