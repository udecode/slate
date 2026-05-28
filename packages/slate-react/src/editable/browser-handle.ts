import {
  type EditorApplyOperationsOptions,
  type Operation,
  type Path,
  type Range,
  RangeApi,
  type RuntimeId,
} from 'slate'
import {
  didSyncTextPathToDOM,
  getSlateNodeElementByPath,
} from '../hooks/use-slate-node-ref'
import type { ReactRuntimeEditor } from '../plugin/react-editor'
import {
  createSlateViewBoundaryGraph,
  type SlateViewBoundaryGraphNodeInput,
  type SlateViewBoundaryPoint,
} from '../view-boundary-graph'
import {
  createSlateViewSelection,
  readSlateViewSelection,
  writeSlateViewSelection,
} from '../view-selection'
import {
  beginEditableEventFrame,
  type EditableCommand,
  getEditableKernelTrace,
  recordEditableKernelTrace,
} from './editing-kernel'
import type { EditableInputController } from './input-state'
import {
  applyEditableCommand,
  applyModelOwnedHistoryIntent,
} from './mutation-controller'
import { getProjectedNativeAffordanceMatrix } from './projected-native-affordance'
import { Editor } from './runtime-editor-api'
import { readRuntimeSelection } from './runtime-selection-state'
import {
  executeEditableSelectionImport,
  setEditableModelSelectionPreference,
  syncEditableDOMSelectionToEditor,
  syncEditorSelectionFromDOM,
} from './selection-controller'

export type SlateBrowserHandle = {
  applyOperations: (
    operations: readonly Operation[],
    options?: EditorApplyOperationsOptions
  ) => void
  createRangeRef: (
    selection: Range,
    affinity?: 'forward' | 'backward' | 'outward' | 'inward'
  ) => string
  deleteBackward: () => void
  deleteForward: () => void
  deleteFragment: () => void
  focus: () => void
  getKernelTrace: () => unknown[]
  getLastCommit: () => unknown
  getElementByPath: (path: Path) => HTMLElement | null
  getPathByRuntimeId: (runtimeId: RuntimeId) => Path | null
  getProjectedNativeAffordanceMatrix: () => unknown
  getRuntimeId: (path: Path) => RuntimeId | null
  getSelection: () => Range | null
  getText: () => string
  getViewSelection: () => unknown
  importDOMSelection: () => Range | null
  insertBreak: () => void
  insertData: (payload: { html?: string | null; text?: string }) => void
  insertText: (text: string) => void
  redo: () => void
  resolveRangeRef: (id: string) => Range | null
  selectAll: () => void
  selectRange: (selection: Range) => void
  setViewSelection: (
    selection: {
      anchor: SlateViewBoundaryPoint
      focus: SlateViewBoundaryPoint
      graph: readonly SlateViewBoundaryGraphNodeInput[]
    } | null
  ) => void
  undo: () => void
  unrefRangeRef: (id: string) => Range | null
}

export type SlateBrowserHandleElement = HTMLDivElement & {
  __slateBrowserHandle?: SlateBrowserHandle
}

type RefBox<T> = {
  current: T
}

export const attachSlateBrowserHandle = ({
  browserHandleNextId,
  browserHandleRangeRefs,
  editor,
  element,
  inputController,
  applyInputRules,
  forceRender,
  isPartialDOMBackedSelection,
  setExplicitPartialDOMBackedSelection,
}: {
  applyInputRules?: (input: {
    data: unknown
    inputType: string
    selection: Range | null
  }) => boolean
  browserHandleNextId: RefBox<number>
  browserHandleRangeRefs: RefBox<
    Map<string, ReturnType<typeof Editor.rangeRef>>
  >
  editor: ReactRuntimeEditor
  element: SlateBrowserHandleElement
  inputController: EditableInputController
  forceRender: () => void
  isPartialDOMBackedSelection: (selection: Range | null) => boolean
  setExplicitPartialDOMBackedSelection: (nextValue: boolean) => void
}) => {
  const getCurrentHandleElement = () =>
    (editor.api.dom.resolveDOMNode(
      editor
    ) as SlateBrowserHandleElement | null) ?? element

  const refocusHandleElement = () => {
    const focusHandleElement = () => {
      getCurrentHandleElement().focus({ preventScroll: true })
    }

    focusHandleElement()
    queueMicrotask(focusHandleElement)
    setTimeout(focusHandleElement)
  }
  const runCommand = (
    command: EditableCommand,
    { forceRenderAfter = true }: { forceRenderAfter?: boolean } = {}
  ) => {
    const previousIsUpdatingSelection =
      inputController.state.isUpdatingSelection

    setEditableModelSelectionPreference({
      inputController,
      preferModelSelection: true,
      reason: 'browser-handle',
      selectionSource: 'model-owned',
    })
    inputController.state.isUpdatingSelection = true
    inputController.state.selectionChangeOrigin = 'browser-handle'

    const selectionBefore = readRuntimeSelection(editor)
    beginEditableEventFrame(editor, {
      eventFamily: 'repair',
      focusOwner: 'editor',
      inputIntent: null,
      modelSelectionBefore: selectionBefore,
      selectionSource: 'model-owned',
      targetOwner: 'editor',
    })

    applyEditableCommand({ command, editor })
    syncEditableDOMSelectionToEditor({
      editor,
      scrollSelectionIntoView: () => {},
      partialDOMBackedSelection: isPartialDOMBackedSelection(
        readRuntimeSelection(editor)
      ),
      state: inputController.state,
    })
    refocusHandleElement()
    recordEditableKernelTrace({
      editor,
      trace: {
        command,
        eventFamily: 'repair',
        intent: null,
        nativeAllowed: false,
        ownership: 'model-owned',
        repair: null,
        selectionChangeOrigin: 'browser-handle',
        selectionAfter: readRuntimeSelection(editor),
        selectionBefore,
        selectionSource: 'model-owned',
        stateAfter: 'model-owned',
        stateBefore: 'model-owned',
        targetOwner: 'editor',
      },
    })

    if (forceRenderAfter) {
      forceRender()
    }

    setTimeout(() => {
      if (inputController.state.selectionChangeOrigin === 'browser-handle') {
        inputController.state.isUpdatingSelection = previousIsUpdatingSelection
      }
    })
  }

  const handle: SlateBrowserHandle = {
    applyOperations: (operations, options) => {
      editor.update((tx) => {
        tx.operations.replay(operations, options)
      })
      forceRender()
    },
    createRangeRef: (selection, affinity) => {
      const id = String(browserHandleNextId.current++)
      const rangeRef = Editor.rangeRef(editor, selection, {
        affinity,
      })

      browserHandleRangeRefs.current.set(id, rangeRef)

      return id
    },
    deleteBackward: () => {
      runCommand({ direction: 'backward', kind: 'delete' })
    },
    deleteForward: () => {
      runCommand({ direction: 'forward', kind: 'delete' })
    },
    deleteFragment: () => {
      runCommand({ kind: 'delete-fragment' })
    },
    focus: () => {
      setEditableModelSelectionPreference({
        inputController,
        preferModelSelection: true,
        reason: 'browser-handle',
        selectionSource: 'model-owned',
      })
      inputController.state.selectionChangeOrigin = 'browser-handle'
      editor.api.dom.focus()
      forceRender()
    },
    getKernelTrace: () => [...getEditableKernelTrace(editor)],
    getLastCommit: () => Editor.getLastCommit(editor),
    getElementByPath: (path) => getSlateNodeElementByPath(editor, path),
    getPathByRuntimeId: (runtimeId) =>
      Editor.getPathByRuntimeId(editor, runtimeId),
    getProjectedNativeAffordanceMatrix,
    getRuntimeId: (path) => Editor.getRuntimeId(editor, path),
    getSelection: () => {
      const selection = readRuntimeSelection(editor)

      return selection
        ? {
            anchor: {
              offset: selection.anchor.offset,
              path: [...selection.anchor.path],
            },
            focus: {
              offset: selection.focus.offset,
              path: [...selection.focus.path],
            },
          }
        : null
    },
    getText: () => Editor.string(editor, []),
    getViewSelection: () => readSlateViewSelection(editor),
    importDOMSelection: () => {
      const selectionBefore = readRuntimeSelection(editor)

      executeEditableSelectionImport({
        importSelection: () => {
          setEditableModelSelectionPreference({
            inputController,
            preferModelSelection: false,
            selectionSource: 'dom-current',
          })
          syncEditorSelectionFromDOM({
            editor,
            ignoreModelSelectionPreference: true,
            inputController,
          })
        },
        selectionPolicy: { kind: 'import-dom', reason: 'unknown-selection' },
      })

      const selectionAfter = readRuntimeSelection(editor)

      recordEditableKernelTrace({
        editor,
        trace: {
          command: null,
          eventFamily: 'selectionchange',
          intent: null,
          nativeAllowed: true,
          ownership: 'native-allowed',
          repair: null,
          selectionChangeOrigin: 'browser-handle',
          selectionAfter,
          selectionBefore,
          selectionPolicy: { kind: 'import-dom', reason: 'unknown-selection' },
          selectionSource: inputController.state.selectionSource,
          stateAfter: 'dom-selection',
          stateBefore: 'idle',
          targetOwner: 'editor',
        },
      })

      return selectionAfter
    },
    insertBreak: () => {
      runCommand({ kind: 'insert-break', variant: 'paragraph' })
    },
    insertData: ({ html, text }) => {
      const data = new DataTransfer()

      if (html) {
        data.setData('text/html', html)
      }

      if (text) {
        data.setData('text/plain', text)
      }

      runCommand({ data, kind: 'insert-data' })
    },
    insertText: (text) => {
      const selection = readRuntimeSelection(editor)
      if (
        applyInputRules?.({
          data: text,
          inputType: 'insertText',
          selection,
        })
      ) {
        return
      }

      const path = selection ? RangeApi.start(selection).path : null
      runCommand(
        { kind: 'insert-text', text },
        {
          forceRenderAfter: false,
        }
      )
      if (!path || !didSyncTextPathToDOM(editor, path)) {
        forceRender()
      }
    },
    redo: () => {
      if (!applyModelOwnedHistoryIntent({ direction: 'redo', editor })) {
        return
      }

      forceRender()
      refocusHandleElement()
    },
    resolveRangeRef: (id) => {
      const rangeRef = browserHandleRangeRefs.current.get(id)
      const selection = rangeRef?.current ?? null

      return selection
        ? {
            anchor: {
              offset: selection.anchor.offset,
              path: [...selection.anchor.path],
            },
            focus: {
              offset: selection.focus.offset,
              path: [...selection.focus.path],
            },
          }
        : null
    },
    selectAll: () => {
      runCommand({ kind: 'select-all' })
    },
    selectRange: (selection) => {
      const previousIsUpdatingSelection =
        inputController.state.isUpdatingSelection
      setEditableModelSelectionPreference({
        inputController,
        preferModelSelection: true,
        reason: 'browser-handle',
        selectionSource: 'model-owned',
      })
      inputController.state.isUpdatingSelection = true
      inputController.state.selectionChangeOrigin = 'browser-handle'
      editor.update((tx) => {
        tx.selection.set(selection)
      })
      setExplicitPartialDOMBackedSelection(
        isPartialDOMBackedSelection(selection)
      )
      refocusHandleElement()
      const syncDOMSelection = () => {
        syncEditableDOMSelectionToEditor({
          editor,
          scrollSelectionIntoView: () => {},
          partialDOMBackedSelection: isPartialDOMBackedSelection(selection),
          state: inputController.state,
        })
      }

      syncDOMSelection()
      queueMicrotask(syncDOMSelection)
      setTimeout(syncDOMSelection)
      setTimeout(() => {
        if (inputController.state.selectionChangeOrigin === 'browser-handle') {
          inputController.state.isUpdatingSelection =
            previousIsUpdatingSelection
        }
      })
    },
    setViewSelection: (selection) => {
      writeSlateViewSelection(
        editor,
        selection
          ? createSlateViewSelection(
              createSlateViewBoundaryGraph(selection.graph),
              {
                anchor: selection.anchor,
                focus: selection.focus,
              }
            )
          : null
      )
    },
    undo: () => {
      if (!applyModelOwnedHistoryIntent({ direction: 'undo', editor })) {
        return
      }

      forceRender()
      refocusHandleElement()
    },
    unrefRangeRef: (id) => {
      const rangeRef = browserHandleRangeRefs.current.get(id)

      if (!rangeRef) {
        return null
      }

      browserHandleRangeRefs.current.delete(id)

      const selection = rangeRef.unref()

      return selection
        ? {
            anchor: {
              offset: selection.anchor.offset,
              path: [...selection.anchor.path],
            },
            focus: {
              offset: selection.focus.offset,
              path: [...selection.focus.path],
            },
          }
        : null
    },
  }

  element.__slateBrowserHandle = handle

  return () => {
    if (element.__slateBrowserHandle === handle) {
      element.__slateBrowserHandle = undefined
    }
  }
}
