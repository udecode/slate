import { type KeyboardEvent, useCallback } from 'react'
import type { RuntimeId } from 'slate'
import type { EditableKeyDownHandler } from '../components/editable'
import type { MountedTopLevelRange } from '../dom-strategy/dom-strategy-commands'
import { useOptionalSlateRuntimeContext } from '../hooks/use-slate-runtime'
import type { ReactRuntimeEditor } from '../plugin/react-editor'
import { prepareEditableKeyDownKernel } from './editing-kernel'
import { useEditableKeyboardHandler } from './input-router'
import type { EditableInputController } from './input-state'
import { applyEditableKeyDown } from './keyboard-input-strategy'
import type { EditableEventRuntimeCore } from './runtime-event-engine'

const WHITESPACE_KEY_RE = /\s/

export const shouldFlushPendingNativeTextInputForKeyDown = (
  decision: ReturnType<typeof prepareEditableKeyDownKernel>,
  event: KeyboardEvent<HTMLDivElement>
) => {
  const hasCommandModifier = event.altKey || event.ctrlKey || event.metaKey
  const isTextShortcutBoundary =
    event.key.length === 1 && WHITESPACE_KEY_RE.test(event.key)

  if (decision.intent === 'composition') {
    return false
  }

  if (decision.intent === 'text-insert' && !hasCommandModifier) {
    return isTextShortcutBoundary
  }

  if (decision.targetOwner === 'internal-control') {
    return decision.intent === 'history'
  }

  return (
    decision.shouldForceDOMImport ||
    decision.intent === 'history' ||
    decision.intent === 'native-selection-move' ||
    (hasCommandModifier && decision.targetOwner === 'editor')
  )
}

export const useRuntimeKeyboardEvents = ({
  editor,
  inputController,
  domStrategyRuntime,
  flushPendingNativeTextInput,
  onKeyDown,
  readOnly,
  runtime,
  setExplicitPartialDOMBackedSelection,
  partialDOMBackedSelection,
}: {
  editor: ReactRuntimeEditor
  inputController: EditableInputController
  domStrategyRuntime: {
    type: 'staged' | 'partial-dom' | 'virtualized'
    mountedTopLevelRuntimeIds: ReadonlySet<RuntimeId> | null
    mountedTopLevelRanges?: readonly MountedTopLevelRange[]
  } | null
  flushPendingNativeTextInput?: () => void
  onKeyDown?: EditableKeyDownHandler
  readOnly: boolean
  runtime: EditableEventRuntimeCore
  setExplicitPartialDOMBackedSelection: (nextValue: boolean) => void
  partialDOMBackedSelection: boolean
}) => {
  const slateRuntimeContext = useOptionalSlateRuntimeContext()
  const runKeyDownEvent = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const decision = prepareEditableKeyDownKernel({
        editor,
        event,
        inputController,
        domStrategyRuntime,
      })

      if (shouldFlushPendingNativeTextInputForKeyDown(decision, event)) {
        flushPendingNativeTextInput?.()
      }

      inputController.state.activeIntent = decision.intent
      runtime.selection.applyKeyDownSelectionPolicy(decision)
      runtime.trace.beginKeyDownEventFrame(decision)
      const keyDownWorkerResult = applyEditableKeyDown({
        androidInputManagerRef: runtime.android.managerRef,
        editor,
        event,
        forceRender: runtime.repair.forceRender,
        inputController,
        domStrategyRuntime,
        getActiveContentRootOwner:
          slateRuntimeContext?.getActiveContentRootOwner,
        getContentRootOwnerViewEditor:
          slateRuntimeContext?.getContentRootOwnerViewEditor,
        getMountedViewEditor: slateRuntimeContext?.getMountedViewEditor,
        onKeyDown,
        readOnly,
        setExplicitPartialDOMBackedSelection,
        setComposing: runtime.composition.setComposing,
        partialDOMBackedSelection,
      })
      if (keyDownWorkerResult.repair) {
        runtime.repair.requestEditableRepair(keyDownWorkerResult.repair)
      }
      if (
        !readOnly &&
        !keyDownWorkerResult.handled &&
        decision.intent === 'native-selection-move' &&
        (event.key === 'ArrowUp' || event.key === 'ArrowDown')
      ) {
        setTimeout(() => {
          runtime.selection.syncDOMSelectionFromRuntime()
        })
      }
      runtime.trace.recordKeyDownTrace({
        decision,
        eventKey: event.key,
        handled: keyDownWorkerResult.handled,
      })
    },
    [
      editor,
      flushPendingNativeTextInput,
      inputController,
      domStrategyRuntime,
      onKeyDown,
      readOnly,
      runtime,
      slateRuntimeContext,
      setExplicitPartialDOMBackedSelection,
      partialDOMBackedSelection,
    ]
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      runKeyDownEvent(event)
    },
    [runKeyDownEvent]
  )

  const handleKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const decision = prepareEditableKeyDownKernel({
        editor,
        event,
        inputController,
        domStrategyRuntime,
      })

      if (
        decision.targetOwner !== 'internal-control' ||
        decision.intent !== 'history'
      ) {
        return
      }

      flushPendingNativeTextInput?.()
      runtime.selection.applyKeyDownSelectionPolicy(decision)
      runtime.trace.beginKeyDownEventFrame(decision)
      const keyDownWorkerResult = applyEditableKeyDown({
        androidInputManagerRef: runtime.android.managerRef,
        editor,
        event,
        forceRender: runtime.repair.forceRender,
        inputController,
        domStrategyRuntime,
        getActiveContentRootOwner:
          slateRuntimeContext?.getActiveContentRootOwner,
        getContentRootOwnerViewEditor:
          slateRuntimeContext?.getContentRootOwnerViewEditor,
        getMountedViewEditor: slateRuntimeContext?.getMountedViewEditor,
        onKeyDown,
        readOnly,
        setExplicitPartialDOMBackedSelection,
        setComposing: runtime.composition.setComposing,
        partialDOMBackedSelection,
      })
      if (keyDownWorkerResult.repair) {
        runtime.repair.requestEditableRepair(keyDownWorkerResult.repair)
      }
      runtime.trace.recordKeyDownTrace({
        decision,
        eventKey: event.key,
        handled: keyDownWorkerResult.handled,
      })
    },
    [
      editor,
      flushPendingNativeTextInput,
      inputController,
      domStrategyRuntime,
      onKeyDown,
      readOnly,
      runtime,
      slateRuntimeContext,
      setExplicitPartialDOMBackedSelection,
      partialDOMBackedSelection,
    ]
  )

  return {
    onKeyDownCapture: useEditableKeyboardHandler({
      handleKeyboard: handleKeyDownCapture,
    }),
    onKeyDown: useEditableKeyboardHandler({
      handleKeyboard: handleKeyDown,
    }),
  }
}
