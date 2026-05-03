import {
  type ComponentPropsWithRef,
  type FormEvent,
  type InputEvent as ReactInputEvent,
  type RefObject,
  useMemo,
} from 'react'
import type { Range, RuntimeId } from 'slate'
import type { EditableKeyDownHandler } from '../components/editable'
import type { MountedTopLevelRange } from '../large-document/large-document-commands'
import type { ReactEditor } from '../plugin/react-editor'
import type { DOMRepairQueue } from './dom-repair-queue'
import type {
  EditableInputController,
  EditableInputControllerState,
} from './input-state'
import type { EditableRepairRequest } from './mutation-controller'
import type { RuntimeAndroidInputManager } from './runtime-android-engine'
import { useRuntimeBeforeInputEvents } from './runtime-before-input-events'
import { useRuntimeBrowserHandle } from './runtime-browser-handle-events'
import { useRuntimeClipboardEvents } from './runtime-clipboard-events'
import { useRuntimeCompositionEvents } from './runtime-composition-events'
import { useRuntimeDragEvents } from './runtime-drag-events'
import type { Editor } from './runtime-editor-api'
import { useRuntimeFocusMouseEvents } from './runtime-focus-mouse-events'
import { useRuntimeInputEvents } from './runtime-input-events'
import type { useRuntimeKernelTraceEngine } from './runtime-kernel-trace'
import { useRuntimeKeyboardEvents } from './runtime-keyboard-events'
import type { RuntimeSelectionImportController } from './runtime-selection-engine'
import { useRuntimeTargetBridge } from './runtime-target-bridge'

type DeferredOperation = () => void

type ApplyInputRules = ({
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

type EditableRootEventHandlers = ReturnType<
  typeof useRuntimeBeforeInputEvents
> &
  ReturnType<typeof useRuntimeInputEvents> &
  ReturnType<typeof useRuntimeClipboardEvents> &
  ReturnType<typeof useRuntimeDragEvents> &
  ReturnType<typeof useRuntimeCompositionEvents> &
  ReturnType<typeof useRuntimeFocusMouseEvents> &
  ReturnType<typeof useRuntimeKeyboardEvents>

type EditableRepairRuntime = {
  domRepairQueue: DOMRepairQueue
  forceRender: () => void
  requestEditableRepair: (request: EditableRepairRequest) => void
}

type EditableKernelTraceRuntime = ReturnType<typeof useRuntimeKernelTraceEngine>

export type EditableEventRuntimeCore = {
  android: {
    managerRef: RefObject<RuntimeAndroidInputManager | null | undefined>
  }
  composition: {
    setComposing: (nextValue: boolean) => void
  }
  repair: EditableRepairRuntime
  selection: RuntimeSelectionImportController
  trace: EditableKernelTraceRuntime
}

export type EditableEventRuntime = EditableEventRuntimeCore & {
  handlers: EditableRootEventHandlers
}

export const useEditableEventRuntime = ({
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
  onKeyDown,
  onUserInput,
  processing,
  readOnly,
  repair,
  rootRef,
  selection,
  setComposing,
  setExplicitShellBackedSelection,
  shellBackedSelection,
  state,
  syncDOMSelectionToEditor,
  trace,
}: {
  androidInputManagerRef: RefObject<
    RuntimeAndroidInputManager | null | undefined
  >
  applyInputRules: ApplyInputRules
  browserHandleNextId: RefObject<number>
  browserHandleRangeRefs: RefObject<
    Map<string, ReturnType<typeof Editor.rangeRef>>
  >
  callbacks: EditableRootCallbackProps
  deferredOperations: RefObject<DeferredOperation[]>
  editor: ReactEditor
  handledDOMBeforeInputRef: RefObject<boolean>
  inputController: EditableInputController
  isShellBackedSelection: (selection: Range | null) => boolean
  largeDocument: {
    mode: 'dom-present' | 'shell'
    mountedTopLevelRuntimeIds: ReadonlySet<RuntimeId> | null
    mountedTopLevelRanges?: readonly MountedTopLevelRange[]
  } | null
  onDOMBeforeInput?: (event: InputEvent) => boolean | void
  onKeyDown?: EditableKeyDownHandler
  onUserInput: () => void
  processing: RefObject<boolean>
  readOnly: boolean
  repair: EditableRepairRuntime
  rootRef: RefObject<HTMLDivElement | null>
  selection: RuntimeSelectionImportController
  setComposing: (nextValue: boolean) => void
  setExplicitShellBackedSelection: (nextValue: boolean) => void
  shellBackedSelection: boolean
  state: EditableInputControllerState
  syncDOMSelectionToEditor: () => void
  trace: EditableKernelTraceRuntime
}): EditableEventRuntime => {
  const runtime = useMemo<EditableEventRuntimeCore>(
    () => ({
      android: {
        managerRef: androidInputManagerRef,
      },
      composition: {
        setComposing,
      },
      repair,
      selection,
      trace,
    }),
    [androidInputManagerRef, repair, selection, setComposing, trace]
  )

  useRuntimeTargetBridge({
    editor,
    inputController,
    syncDOMSelectionToEditor,
  })
  useRuntimeBrowserHandle({
    applyInputRules,
    browserHandleNextId,
    browserHandleRangeRefs,
    editor,
    forceRender: runtime.repair.forceRender,
    inputController,
    isShellBackedSelection,
    rootRef,
    setExplicitShellBackedSelection,
  })

  const beforeInputHandlers = useRuntimeBeforeInputEvents({
    androidInputManagerRef: runtime.android.managerRef,
    applyInputRules,
    deferredOperations,
    editor,
    handledDOMBeforeInputRef,
    inputController,
    onBeforeInput: callbacks.onBeforeInput as
      | ((event: FormEvent<HTMLDivElement>) => boolean | void)
      | undefined,
    onDOMBeforeInput,
    onInput: callbacks.onInput,
    onKeyDown,
    onUserInput,
    processing,
    readOnly,
    repair: runtime.repair,
    selection: runtime.selection,
    setComposing: runtime.composition.setComposing,
    trace: runtime.trace,
  })
  const inputHandlers = useRuntimeInputEvents({
    androidInputManagerRef: runtime.android.managerRef,
    deferredOperations,
    editor,
    handledDOMBeforeInputRef,
    inputController,
    onInput: callbacks.onInput as
      | ((event: ReactInputEvent<HTMLDivElement>) => boolean | void)
      | undefined,
    repair: runtime.repair,
    rootRef,
    trace: runtime.trace,
  })
  const clipboardHandlers = useRuntimeClipboardEvents({
    editor,
    inputController,
    onCopy: callbacks.onCopy,
    onCut: callbacks.onCut,
    onPaste: callbacks.onPaste,
    readOnly,
    repair: runtime.repair,
    setExplicitShellBackedSelection,
    shellBackedSelection,
    trace: runtime.trace,
  })
  const dragHandlers = useRuntimeDragEvents({
    editor,
    inputController,
    onDragEnd: callbacks.onDragEnd,
    onDragOver: callbacks.onDragOver,
    onDragStart: callbacks.onDragStart,
    onDrop: callbacks.onDrop,
    readOnly,
    repair: runtime.repair,
    state,
    trace: runtime.trace,
  })
  const compositionHandlers = useRuntimeCompositionEvents({
    androidInputManagerRef: runtime.android.managerRef,
    editor,
    inputController,
    onCompositionEnd: callbacks.onCompositionEnd,
    onCompositionStart: callbacks.onCompositionStart,
    onCompositionUpdate: callbacks.onCompositionUpdate,
    setComposing: runtime.composition.setComposing,
    trace: runtime.trace,
  })
  const focusMouseHandlers = useRuntimeFocusMouseEvents({
    editor,
    inputController,
    onBlur: callbacks.onBlur,
    onClick: callbacks.onClick,
    onFocus: callbacks.onFocus,
    onMouseDown: callbacks.onMouseDown,
    onMouseUp: callbacks.onMouseUp,
    readOnly,
    selection: runtime.selection,
    state,
    syncDOMSelectionToEditor,
    trace: runtime.trace,
  })
  const keyboardHandlers = useRuntimeKeyboardEvents({
    editor,
    inputController,
    largeDocument,
    onKeyDown,
    readOnly,
    runtime,
    setExplicitShellBackedSelection,
    shellBackedSelection,
  })
  const handlers = useMemo(
    () => ({
      ...beforeInputHandlers,
      ...inputHandlers,
      ...clipboardHandlers,
      ...dragHandlers,
      ...compositionHandlers,
      ...focusMouseHandlers,
      ...keyboardHandlers,
    }),
    [
      beforeInputHandlers,
      clipboardHandlers,
      compositionHandlers,
      dragHandlers,
      focusMouseHandlers,
      inputHandlers,
      keyboardHandlers,
    ]
  )

  return useMemo(
    () => ({
      ...runtime,
      handlers,
    }),
    [handlers, runtime]
  )
}
