import {
  type ComponentPropsWithRef,
  type ForwardedRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { Range } from 'slate'
import type { DOMRange } from 'slate-dom'
import { IS_READ_ONLY } from 'slate-dom/internal'
import type {
  EditableDOMBeforeInputHandler,
  EditableDOMStrategyRuntime,
  EditableKeyDownHandler,
} from '../components/editable'
import { isSelectionPartialDOMBacked } from '../dom-strategy/dom-strategy-commands'
import { useFlushDeferredSelectorsOnRender } from '../hooks/use-editor-selector'
import { useTrackUserInput } from '../hooks/use-track-user-input'
import type { ReactRuntimeEditor } from '../plugin/react-editor'
import { usePendingInsertionMarksEffect } from './composition-state'
import type { DOMRepairQueue } from './dom-repair-queue'
import {
  createEditableInputController,
  createEditableInputControllerState,
} from './input-controller'
import { useEditableRootRef } from './input-router'
import type { DeferredOperation } from './model-input-strategy'
import { useProjectionDOMRepairBridge } from './projection-repair-bridge'
import { useEditableRootCommitWakeup } from './root-selector-sources'
import {
  type RuntimeAndroidInputManager,
  useRuntimeAndroidEngine,
} from './runtime-android-engine'
import { useRuntimeCompositionEngine } from './runtime-composition-engine'
import type { Editor } from './runtime-editor-api'
import { useEditableEventRuntime } from './runtime-event-engine'
import { useRuntimeKernelTraceEngine } from './runtime-kernel-trace'
import { useRuntimeRepairEngine } from './runtime-repair-engine'
import { useEditableRootGlobalLifecycle } from './runtime-root-lifecycle'
import { useEditableRootSelectionExport } from './runtime-root-selection-export'
import { useEditableRootSelectionImport } from './runtime-root-selection-import'
import { readRuntimeSelection } from './runtime-selection-state'
import { setEditableModelSelectionPreference } from './selection-controller'
import { useEditableSelectionReconciler } from './selection-reconciler'

type EditableRootCallbackProps = Pick<
  ComponentPropsWithRef<'div'>,
  | 'onBeforeInput'
  | 'onBlur'
  | 'onClick'
  | 'onCompositionEnd'
  | 'onCompositionStart'
  | 'onCompositionUpdate'
  | 'onCopy'
  | 'onCut'
  | 'onDragEnd'
  | 'onDragOver'
  | 'onDragStart'
  | 'onDrop'
  | 'onFocus'
  | 'onInput'
  | 'onMouseDown'
  | 'onMouseUp'
  | 'onPaste'
>

type EditableRootEventBindings = Pick<
  ComponentPropsWithRef<'div'>,
  | 'onBeforeInput'
  | 'onBlur'
  | 'onClick'
  | 'onCompositionEnd'
  | 'onCompositionStart'
  | 'onCompositionUpdate'
  | 'onCopy'
  | 'onCut'
  | 'onDragEnd'
  | 'onDragOver'
  | 'onDragStart'
  | 'onDrop'
  | 'onFocus'
  | 'onInput'
  | 'onInputCapture'
  | 'onKeyDown'
  | 'onKeyDownCapture'
  | 'onMouseDown'
  | 'onMouseDownCapture'
  | 'onMouseUp'
  | 'onPaste'
  | 'ref'
>

export const useEditableRootRuntime = ({
  autoFocus,
  callbacks,
  deferNativeTextInputRepair,
  editor,
  forwardedRef,
  domStrategyRuntime,
  onDOMBeforeInput,
  onKeyDown,
  readOnly,
  scrollSelectionIntoView,
}: {
  autoFocus?: boolean
  callbacks: EditableRootCallbackProps
  deferNativeTextInputRepair?: boolean
  editor: ReactRuntimeEditor
  forwardedRef?: ForwardedRef<HTMLDivElement>
  domStrategyRuntime: EditableDOMStrategyRuntime | null
  onDOMBeforeInput?: EditableDOMBeforeInputHandler
  onKeyDown?: EditableKeyDownHandler
  readOnly: boolean
  scrollSelectionIntoView: (
    editor: ReactRuntimeEditor,
    domRange: DOMRange
  ) => void
}) => {
  useEditableRootCommitWakeup()
  useFlushDeferredSelectorsOnRender()

  const [isComposing, setIsComposing] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const browserHandleRangeRefs = useRef(
    new Map<string, ReturnType<typeof Editor.rangeRef>>()
  )
  const browserHandleNextId = useRef(0)
  const deferredOperations = useRef<DeferredOperation[]>([])
  const handledDOMBeforeInputRef = useRef(false)
  const [preferModelSelectionForInputRef] = useState(() => ({
    current: false,
  }))
  const detachNativeInputListenersRef = useRef<(() => void) | null>(null)
  const [domRepairQueueRef] = useState<{ current: DOMRepairQueue | null }>(
    () => ({
      current: null,
    })
  )
  const processing = useRef(false)
  const { onUserInput, receivedUserInput } = useTrackUserInput()

  useEffect(
    () => () => {
      browserHandleRangeRefs.current.forEach((rangeRef) => {
        rangeRef.unref()
      })
      browserHandleRangeRefs.current.clear()
    },
    []
  )

  IS_READ_ONLY.set(editor, readOnly)

  const [domStrategyRuntimeCell] = useState(() => ({
    current: domStrategyRuntime,
  }))
  domStrategyRuntimeCell.current = domStrategyRuntime

  const [
    explicitPartialDOMBackedSelection,
    setExplicitPartialDOMBackedSelection,
  ] = useState(false)
  const isPartialDOMBackedSelection = useCallback(
    (selection: Range | null) => {
      const currentDOMStrategyRuntime = domStrategyRuntimeCell.current

      return currentDOMStrategyRuntime?.type === 'partial-dom' ||
        currentDOMStrategyRuntime?.type === 'staged' ||
        currentDOMStrategyRuntime?.type === 'virtualized'
        ? isSelectionPartialDOMBacked(
            selection,
            currentDOMStrategyRuntime.mountedTopLevelRuntimeIds,
            currentDOMStrategyRuntime.mountedTopLevelRanges ?? null
          )
        : false
    },
    [domStrategyRuntimeCell]
  )
  const modelSelection = readRuntimeSelection(editor)
  const modelPartialDOMBackedSelection =
    isPartialDOMBackedSelection(modelSelection)
  const partialDOMBackedSelection =
    explicitPartialDOMBackedSelection || modelPartialDOMBackedSelection

  useEffect(() => {
    if (explicitPartialDOMBackedSelection && !modelPartialDOMBackedSelection) {
      setExplicitPartialDOMBackedSelection(false)
    }
  }, [explicitPartialDOMBackedSelection, modelPartialDOMBackedSelection])

  const [controllerState] = useState(createEditableInputControllerState)
  const inputController = useMemo(
    () =>
      createEditableInputController({
        preferModelSelectionForInputRef,
        state: controllerState,
      }),
    [controllerState, preferModelSelectionForInputRef]
  )
  const state = inputController.state

  const runtimeSetComposing = useRuntimeCompositionEngine({
    editor,
    inputController,
    setIsComposing,
  })

  useEffect(() => {
    if (rootRef.current && autoFocus) {
      rootRef.current.focus()
    }
  }, [autoFocus])

  const [androidInputManagerRef] = useState<{
    current: RuntimeAndroidInputManager | null | undefined
  }>(() => ({ current: undefined }))
  const {
    onDOMSelectionChange,
    scheduleOnDOMSelectionChange,
    selectionImportController,
  } = useEditableRootSelectionImport({
    androidInputManagerRef,
    domRepairQueueRef,
    editor,
    inputController,
    processing,
    readOnly,
  })

  androidInputManagerRef.current = useRuntimeAndroidEngine({
    inputController,
    node: rootRef,
    onDOMSelectionChange,
    receivedUserInput,
    scheduleOnDOMSelectionChange,
  })

  const { syncDOMSelectionToEditor } = useEditableSelectionReconciler({
    androidInputManagerRef,
    editor,
    inputController,
    rootRef,
    scrollSelectionIntoView,
    partialDOMBackedSelection,
    state,
  })
  useEditableRootSelectionExport({
    editor,
    inputController,
    isPartialDOMBackedSelection,
    syncDOMSelectionToEditor,
  })

  const repairRuntime = useRuntimeRepairEngine({
    editor,
    inputController,
    scrollSelectionIntoView,
    syncDOMSelectionToEditor,
  })
  useProjectionDOMRepairBridge({
    inputController,
    requestEditableRepair: repairRuntime.requestEditableRepair,
  })
  domRepairQueueRef.current = repairRuntime.domRepairQueue
  const traceRuntime = useRuntimeKernelTraceEngine({
    domRepairQueue: repairRuntime.domRepairQueue,
    editor,
    inputController,
  })
  const rootInteractionSelectionBridge = useMemo(
    () => ({
      beforeModelSelection: () => {
        setEditableModelSelectionPreference({
          inputController,
          preferModelSelection: true,
          reason: 'programmatic-export',
          selectionSource: 'model-owned',
        })
        inputController.state.selectionChangeOrigin = 'programmatic-export'
      },
      importDOMSelection: () => {
        setEditableModelSelectionPreference({
          inputController,
          preferModelSelection: false,
          selectionSource: 'dom-current',
        })
        inputController.state.selectionChangeOrigin = 'native-user'
        selectionImportController.syncDOMSelectionFromRuntime()
        selectionImportController.flushSelectionChange()
      },
      isPartialDOMBackedSelection,
      syncDOMSelectionToEditor,
    }),
    [
      inputController,
      isPartialDOMBackedSelection,
      selectionImportController,
      syncDOMSelectionToEditor,
    ]
  )
  const applyInputRules = useCallback(() => false, [])

  const eventRuntime = useEditableEventRuntime({
    androidInputManagerRef,
    applyInputRules,
    browserHandleNextId,
    browserHandleRangeRefs,
    callbacks,
    deferredOperations,
    deferNativeTextInputRepair,
    editor,
    handledDOMBeforeInputRef,
    inputController,
    isPartialDOMBackedSelection,
    domStrategyRuntime,
    onDOMBeforeInput,
    onKeyDown,
    onUserInput,
    processing,
    readOnly,
    repair: repairRuntime,
    rootRef,
    selection: selectionImportController,
    setComposing: runtimeSetComposing,
    setExplicitPartialDOMBackedSelection,
    partialDOMBackedSelection,
    state,
    syncDOMSelectionToEditor,
    trace: traceRuntime,
  })

  const callbackRef = useEditableRootRef({
    detachNativeInputListenersRef,
    editor,
    forwardedRef,
    onDOMBeforeInput: eventRuntime.handlers.onDOMBeforeInput,
    onDOMInput: eventRuntime.handlers.onDOMInput,
    onDOMSelectionChange,
    rootRef,
    scheduleOnDOMSelectionChange,
  })
  const editableEventBindings = useMemo(() => {
    const handlers = eventRuntime.handlers

    return {
      onBeforeInput: handlers.onReactBeforeInput,
      onBlur: handlers.onBlur,
      onClick: handlers.onClick,
      onCompositionEnd: handlers.onCompositionEnd,
      onCompositionStart: handlers.onCompositionStart,
      onCompositionUpdate: handlers.onCompositionUpdate,
      onCopy: handlers.onCopy,
      onCut: handlers.onCut,
      onDragEnd: handlers.onDragEnd,
      onDragOver: handlers.onDragOver,
      onDragStart: handlers.onDragStart,
      onDrop: handlers.onDrop,
      onFocus: handlers.onFocus,
      onInput: handlers.onInput,
      onInputCapture: handlers.onInputCapture,
      onKeyDown: handlers.onKeyDown,
      onKeyDownCapture: handlers.onKeyDownCapture,
      onMouseDown: handlers.onMouseDown,
      onMouseDownCapture: handlers.onMouseDownCapture,
      onMouseUp: handlers.onMouseUp,
      onPaste: handlers.onPaste,
      ref: callbackRef,
    } satisfies EditableRootEventBindings
  }, [callbackRef, eventRuntime.handlers])

  useEditableRootGlobalLifecycle({
    editor,
    readOnly,
    rootRef,
    scheduleOnDOMSelectionChange,
    state,
  })

  const marks = editor.read((state) => state.marks.get())
  usePendingInsertionMarksEffect({ editor, marks })

  return {
    editableEventBindings,
    isComposing,
    receivedUserInput,
    rootRef,
    rootInteractionSelectionBridge,
    partialDOMBackedSelection,
  }
}
