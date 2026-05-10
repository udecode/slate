import {
  type ComponentPropsWithRef,
  type ForwardedRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { Range, RuntimeId } from 'slate'
import { type DOMRange, IS_READ_ONLY } from 'slate-dom'
import type {
  EditableInputRule,
  EditableKeyDownHandler,
} from '../components/editable'
import {
  EditorSelectorContext,
  useFlushDeferredSelectorsOnRender,
} from '../hooks/use-editor-selector'
import { useIsomorphicLayoutEffect } from '../hooks/use-isomorphic-layout-effect'
import { useTrackUserInput } from '../hooks/use-track-user-input'
import { ReactEditor } from '../plugin/react-editor'
import type { MountedTopLevelRange } from '../rendering-strategy/rendering-strategy-commands'
import { isSelectionShellBacked } from '../rendering-strategy/rendering-strategy-commands'
import { usePendingInsertionMarksEffect } from './composition-state'
import type { DOMRepairQueue } from './dom-repair-queue'
import { getEditableInputRules } from './editable-input-rules'
import {
  createEditableInputController,
  createEditableInputControllerState,
} from './input-controller'
import {
  attachEditableGlobalDragLifecycleListeners,
  useEditableRootRef,
} from './input-router'
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
import {
  createRuntimeSelectionChangeHandler,
  createRuntimeSelectionChangeScheduler,
  createRuntimeSelectionImportController,
} from './runtime-selection-engine'
import { readRuntimeSelection } from './runtime-selection-state'
import {
  attachEditableSelectionChangeListener,
  useEditableSelectionReconciler,
} from './selection-reconciler'
import { subscribeSelectionOnlyDOMExport } from './selection-runtime'

type DeferredOperation = () => void

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
  | 'onMouseUp'
  | 'onPaste'
  | 'ref'
>

export const useEditableRootRuntime = ({
  autoFocus,
  callbacks,
  editor,
  forwardedRef,
  inputRules,
  renderingStrategy,
  onDOMBeforeInput,
  onKeyDown,
  readOnly,
  scrollSelectionIntoView,
}: {
  autoFocus?: boolean
  callbacks: EditableRootCallbackProps
  editor: ReactEditor
  forwardedRef?: ForwardedRef<HTMLDivElement>
  inputRules?: readonly EditableInputRule[]
  renderingStrategy: {
    type: 'staged' | 'shell' | 'virtualized'
    mountedTopLevelRuntimeIds: ReadonlySet<RuntimeId> | null
    mountedTopLevelRanges?: readonly MountedTopLevelRange[]
  } | null
  onDOMBeforeInput?: (event: InputEvent) => boolean | void
  onKeyDown?: EditableKeyDownHandler
  readOnly: boolean
  scrollSelectionIntoView: (editor: ReactEditor, domRange: DOMRange) => void
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
  const preferModelSelectionForInputRef = useRef(false)
  const detachNativeInputListenersRef = useRef<(() => void) | null>(null)
  const domRepairQueueRef = useRef<DOMRepairQueue | null>(null)
  const effectiveInputRules = useMemo(
    () => getEditableInputRules(editor, inputRules),
    [editor, inputRules]
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

  const renderingStrategyRef = useRef(renderingStrategy)
  renderingStrategyRef.current = renderingStrategy

  const [explicitShellBackedSelection, setExplicitShellBackedSelection] =
    useState(false)
  const isShellBackedSelection = useCallback((selection: Range | null) => {
    const currentRenderingStrategy = renderingStrategyRef.current

    return currentRenderingStrategy?.type === 'shell' ||
      currentRenderingStrategy?.type === 'virtualized'
      ? isSelectionShellBacked(
          selection,
          currentRenderingStrategy.mountedTopLevelRuntimeIds,
          currentRenderingStrategy.mountedTopLevelRanges ?? null
        )
      : false
  }, [])
  const modelSelection = readRuntimeSelection(editor)
  const modelShellBackedSelection = isShellBackedSelection(modelSelection)
  const shellBackedSelection =
    explicitShellBackedSelection || modelShellBackedSelection

  const controllerState = useMemo(createEditableInputControllerState, [])
  const inputController = useMemo(
    () =>
      createEditableInputController({
        preferModelSelectionForInputRef,
        state: controllerState,
      }),
    [controllerState]
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

  const androidInputManagerRef = useRef<
    RuntimeAndroidInputManager | null | undefined
  >(undefined)
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
    [editor, inputController, readOnly]
  )
  const scheduleOnDOMSelectionChange = useMemo(
    () => createRuntimeSelectionChangeScheduler(onDOMSelectionChange),
    [onDOMSelectionChange]
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

  androidInputManagerRef.current = useRuntimeAndroidEngine({
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
    shellBackedSelection,
    state,
  })
  const { addEventListener: addSelectorEventListener } = useContext(
    EditorSelectorContext
  )

  useIsomorphicLayoutEffect(() => {
    return subscribeSelectionOnlyDOMExport({
      addSelectorEventListener,
      getModelSelection: () => readRuntimeSelection(editor),
      inputController,
      shouldSkipDOMExport: (modelSelection) =>
        isShellBackedSelection(modelSelection),
      syncDOMSelectionToEditor,
    })
  }, [
    addSelectorEventListener,
    editor,
    inputController,
    isShellBackedSelection,
    syncDOMSelectionToEditor,
  ])

  const repairRuntime = useRuntimeRepairEngine({
    editor,
    inputController,
    syncDOMSelectionToEditor,
  })
  domRepairQueueRef.current = repairRuntime.domRepairQueue
  const traceRuntime = useRuntimeKernelTraceEngine({
    domRepairQueue: repairRuntime.domRepairQueue,
    editor,
    inputController,
  })
  const applyInputRules = useCallback(
    ({
      data,
      event,
      inputType,
      selection,
    }: {
      data: unknown
      event?: InputEvent
      inputType: string
      selection: Range | null
    }) => {
      if (!effectiveInputRules.length) {
        return false
      }

      for (const rule of effectiveInputRules) {
        const result = rule({
          data,
          editor,
          event,
          inputType,
          selection,
        })

        if (!result) {
          continue
        }

        event?.preventDefault()
        repairRuntime.requestEditableRepair(
          result === true
            ? {
                focus: true,
                kind: 'repair-caret',
                selectionSourceTransition: {
                  preferModelSelection: true,
                  reason: 'model-command',
                  selectionSource: 'model-owned',
                },
              }
            : result
        )
        return true
      }

      return false
    },
    [editor, effectiveInputRules, repairRuntime]
  )

  const eventRuntime = useEditableEventRuntime({
    androidInputManagerRef,
    applyInputRules,
    browserHandleNextId,
    browserHandleRangeRefs,
    callbacks,
    deferredOperations,
    editor,
    handledDOMBeforeInputRef,
    inputController,
    isShellBackedSelection,
    renderingStrategy,
    onDOMBeforeInput,
    onKeyDown,
    onUserInput,
    processing,
    readOnly,
    repair: repairRuntime,
    rootRef,
    selection: selectionImportController,
    setComposing: runtimeSetComposing,
    setExplicitShellBackedSelection,
    shellBackedSelection,
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
  const editableEventBindings = useMemo<EditableRootEventBindings>(() => {
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
      onMouseUp: handlers.onMouseUp,
      onPaste: handlers.onPaste,
      ref: callbackRef,
    }
  }, [callbackRef, eventRuntime.handlers])

  useIsomorphicLayoutEffect(() => {
    const window = ReactEditor.getWindow(editor)
    const detachSelectionChangeListener = attachEditableSelectionChangeListener(
      {
        scheduleOnDOMSelectionChange,
        targetDocument: window.document,
      }
    )
    const detachGlobalDragLifecycleListeners =
      attachEditableGlobalDragLifecycleListeners({
        state,
        targetDocument: window.document,
      })

    return () => {
      detachSelectionChangeListener()
      detachGlobalDragLifecycleListeners()
    }
  }, [editor, scheduleOnDOMSelectionChange, state])

  const marks = editor.read((state) => state.marks.get())
  usePendingInsertionMarksEffect({ editor, marks })

  return {
    editableEventBindings,
    isComposing,
    receivedUserInput,
    rootRef,
    shellBackedSelection,
  }
}
