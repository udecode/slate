import type { RefObject } from 'react'
import type { AndroidInputManager } from '../hooks/android-input-manager/android-input-manager'
import { useAndroidInputManager } from '../hooks/android-input-manager/use-android-input-manager'
import type { RuntimeSelectionChangeHandler } from './runtime-selection-engine'

export type RuntimeAndroidInputManager = AndroidInputManager

export const useRuntimeAndroidEngine = ({
  node,
  onDOMSelectionChange,
  receivedUserInput,
  scheduleOnDOMSelectionChange,
}: {
  node: RefObject<HTMLElement | null>
  onDOMSelectionChange: RuntimeSelectionChangeHandler
  receivedUserInput: RefObject<boolean>
  scheduleOnDOMSelectionChange: RuntimeSelectionChangeHandler
}) =>
  useAndroidInputManager({
    node,
    onDOMSelectionChange,
    receivedUserInput,
    scheduleOnDOMSelectionChange,
  })
