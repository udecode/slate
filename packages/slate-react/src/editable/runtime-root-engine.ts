import {
  type ComponentPropsWithRef,
  type ForwardedRef,
  type KeyboardEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { Editor, Range, RuntimeId } from 'slate'
import { type DOMRange, IS_READ_ONLY } from 'slate-dom'
import type {
  EditableInputRule,
  EditableKeyCommandHandler,
} from '../components/editable'
import { useIsomorphicLayoutEffect } from '../hooks/use-isomorphic-layout-effect'
import { SlateSelectorContext } from '../hooks/use-slate-selector'
import { useTrackUserInput } from '../hooks/use-track-user-input'
import type { MountedTopLevelRange } from '../large-document/large-document-commands'
import { isSelectionShellBacked } from '../large-document/large-document-commands'
import { ReactEditor } from '../plugin/react-editor'
import { usePendingInsertionMarksEffect } from './composition-state'
import type { DOMRepairQueue } from './dom-repair-queue'
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
  | 'onKeyDown'
  | 'onMouseDown'
  | 'onMouseUp'
  | 'onPaste'
>

export const useEditableRootRuntime = ({
  autoFocus,
  callbacks,
  editor,
  forwardedRef,
  inputRules,
  largeDocument,
  onDOMBeforeInput,
  onKeyCommand,
  readOnly,
  scrollSelectionIntoView,
}: {
  autoFocus?: boolean
  callbacks: EditableRootCallbackProps
  editor: ReactEditor
  forwardedRef?: ForwardedRef<HTMLDivElement>
  inputRules?: readonly EditableInputRule[]
  largeDocument: {
    mountedTopLevelRuntimeIds: ReadonlySet<RuntimeId> | null
    mountedTopLevelRanges?: readonly MountedTopLevelRange[]
  } | null
  onDOMBeforeInput?: (event: InputEvent) => boolean | void
  onKeyCommand?: EditableKeyCommandHandler
  readOnly: boolean
  scrollSelectionIntoView: (editor: ReactEditor, domRange: DOMRange) => void
}) => {
  useEditableRootCommitWakeup()

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
  const processing = useRef(false)
  const { onUserInput, receivedUserInput } = useTrackUserInput()

  IS_READ_ONLY.set(editor, readOnly)

  const largeDocumentRef = useRef(largeDocument)
  largeDocumentRef.current = largeDocument

  const [explicitShellBackedSelection, setExplicitShellBackedSelection] =
    useState(false)
  const isShellBackedSelection = useCallback((selection: Range | null) => {
    const currentLargeDocument = largeDocumentRef.current

    return currentLargeDocument
      ? isSelectionShellBacked(
          selection,
          currentLargeDocument.mountedTopLevelRuntimeIds,
          currentLargeDocument.mountedTopLevelRanges ?? null
        )
      : false
  }, [])
  const shellBackedSelection = explicitShellBackedSelection

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
  const { addEventListener: addSelectorEventListener } =
    useContext(SlateSelectorContext)

  useIsomorphicLayoutEffect(() => {
    return subscribeSelectionOnlyDOMExport({
      addSelectorEventListener,
      getModelSelection: () => readRuntimeSelection(editor),
      inputController,
      syncDOMSelectionToEditor,
    })
  }, [
    addSelectorEventListener,
    editor,
    inputController,
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
      if (!inputRules?.length) {
        return false
      }

      for (const rule of inputRules) {
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
    [editor, inputRules, repairRuntime]
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
    largeDocument,
    onDOMBeforeInput,
    onKeyCommand: onKeyCommand as
      | ((event: KeyboardEvent<HTMLDivElement>) => boolean | void)
      | undefined,
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

  const marks = editor.getMarks()
  usePendingInsertionMarksEffect({ editor, marks })

  return {
    callbackRef,
    eventRuntime,
    isComposing,
    receivedUserInput,
    rootRef,
    shellBackedSelection,
  }
}
