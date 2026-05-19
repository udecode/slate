import { type RefObject, useMemo } from 'react'
import { useIsomorphicLayoutEffect } from '../hooks/use-isomorphic-layout-effect'
import type { ReactRuntimeEditor } from '../plugin/react-editor'
import type { DOMRepairQueue } from './dom-repair-queue'
import type { EditableInputController } from './input-controller'
import type { RuntimeAndroidInputManager } from './runtime-android-engine'
import {
  createRuntimeSelectionChangeHandler,
  createRuntimeSelectionChangeScheduler,
  createRuntimeSelectionImportController,
} from './runtime-selection-engine'

export const useEditableRootSelectionImport = ({
  androidInputManagerRef,
  domRepairQueueRef,
  editor,
  inputController,
  processing,
  readOnly,
}: {
  androidInputManagerRef: RefObject<
    RuntimeAndroidInputManager | null | undefined
  >
  domRepairQueueRef: RefObject<DOMRepairQueue | null>
  editor: ReactRuntimeEditor
  inputController: EditableInputController
  processing: RefObject<boolean>
  readOnly: boolean
}) => {
  const onDOMSelectionChange = useMemo(
    () =>
      createRuntimeSelectionChangeHandler({
        androidInputManagerRef,
        domRepairQueueRef,
        editor,
        inputController,
        processing,
        readOnly,
      }),
    [
      androidInputManagerRef,
      domRepairQueueRef,
      editor,
      inputController,
      processing,
      readOnly,
    ]
  )
  const scheduleOnDOMSelectionChange = useMemo(
    () => createRuntimeSelectionChangeScheduler(onDOMSelectionChange),
    [onDOMSelectionChange]
  )
  useIsomorphicLayoutEffect(
    () => () => {
      scheduleOnDOMSelectionChange.cancel()
      onDOMSelectionChange.cancel()
    },
    [onDOMSelectionChange, scheduleOnDOMSelectionChange]
  )
  const selectionImportController = useMemo(
    () =>
      createRuntimeSelectionImportController({
        editor,
        inputController,
        onDOMSelectionChange,
        scheduleOnDOMSelectionChange,
      }),
    [
      editor,
      inputController,
      onDOMSelectionChange,
      scheduleOnDOMSelectionChange,
    ]
  )

  return {
    onDOMSelectionChange,
    scheduleOnDOMSelectionChange,
    selectionImportController,
  }
}
