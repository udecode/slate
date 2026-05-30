import { createEditorRuntime, createEditorView } from 'slate'
import { Editor } from 'slate/internal'
import {
  isInteractiveInternalTarget,
  isNestedEditableDOMTarget,
} from '../src/editable/input-controller'
import { createEditableInputController } from '../src/editable/input-state'
import { writeCollapsedModelSelectionDOMPreference } from '../src/editable/model-selection-dom-preference'
import {
  completeEditableSelectionChangeImport,
  executeEditableSelectionExport,
  executeEditableSelectionImport,
  isEditableModelSelectionPreferredForInput,
  isSelectionInEditorView,
  prepareEditableSelectionChangeImport,
  setEditableModelSelectionPreference,
  shouldApplyDOMSelectionChange,
  shouldImportChangedExpandedDOMSelection,
  syncEditableDOMSelectionToEditor,
} from '../src/editable/selection-controller'
import { ReactEditor } from '../src/plugin/react-editor'
import { createReactEditor } from '../src/plugin/with-react'

test('selection import executes only for import-dom policy', () => {
  let calls = 0
  const importSelection = () => {
    calls++
  }

  expect(
    executeEditableSelectionImport({
      importSelection,
      selectionPolicy: { kind: 'preserve-model', reason: 'model-owned' },
    })
  ).toBe(false)
  expect(calls).toBe(0)

  expect(
    executeEditableSelectionImport({
      importSelection,
      selectionPolicy: { kind: 'import-dom', reason: 'native-selection' },
    })
  ).toBe(true)
  expect(calls).toBe(1)
})

test('selection export executes only for export-model policy', () => {
  let calls = 0
  const exportSelection = () => {
    calls++
  }

  expect(
    executeEditableSelectionExport({
      exportSelection,
      selectionPolicy: { kind: 'import-dom', reason: 'native-selection' },
    })
  ).toBe(false)
  expect(calls).toBe(0)

  expect(
    executeEditableSelectionExport({
      exportSelection,
      selectionPolicy: { kind: 'export-model', reason: 'model-owned' },
    })
  ).toBe(true)
  expect(calls).toBe(1)
})

test('nested editable DOM targets are owned by their closest editor root', () => {
  const outerEditor = document.createElement('div')
  const childEditor = document.createElement('div')
  const childText = document.createTextNode('child')

  outerEditor.setAttribute('data-slate-editor', 'true')
  childEditor.setAttribute('data-slate-editor', 'true')
  childEditor.append(childText)
  outerEditor.append(childEditor)

  expect(isNestedEditableDOMTarget(outerEditor, childText)).toBe(true)
  expect(isNestedEditableDOMTarget(childEditor, childText)).toBe(false)
  expect(isNestedEditableDOMTarget(outerEditor, outerEditor)).toBe(false)
})

test('nested editable DOM targets are interactive boundaries for containing editors', () => {
  const editor = createReactEditor()
  const outerEditor = document.createElement('div')
  const childEditor = document.createElement('div')
  const childText = document.createTextNode('child')

  outerEditor.setAttribute('data-slate-editor', 'true')
  childEditor.setAttribute('data-slate-editor', 'true')
  childEditor.append(childText)
  outerEditor.append(childEditor)

  vi.spyOn(ReactEditor, 'assertDOMNode').mockReturnValue(outerEditor)

  expect(isInteractiveInternalTarget(editor, childText)).toBe(true)

  vi.restoreAllMocks()
})

test('failed DOM selection export clears the updating guard', () => {
  vi.useFakeTimers()

  const editor = createReactEditor()
  const editorElement = document.createElement('div')
  const textNode = document.createTextNode('abc')
  const domSelection = document.getSelection()

  if (!domSelection) {
    throw new Error('Expected document selection')
  }

  editorElement.append(textNode)
  document.body.append(editorElement)

  const domRange = document.createRange()
  domRange.setStart(textNode, 0)
  domRange.setEnd(textNode, 1)

  Editor.replace(editor, {
    children: [{ type: 'paragraph', children: [{ text: 'abc' }] }],
    selection: {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 1 },
    },
  })

  vi.spyOn(ReactEditor, 'findDocumentOrShadowRoot').mockReturnValue(document)
  vi.spyOn(ReactEditor, 'assertDOMNode').mockReturnValue(editorElement)
  vi.spyOn(ReactEditor, 'resolveDOMRange').mockReturnValue(domRange)
  vi.spyOn(domSelection, 'setBaseAndExtent').mockImplementation(() => {
    throw new Error('stale DOM bridge')
  })

  const state = {
    isUpdatingSelection: false,
    selectionChangeOrigin: null,
  }

  try {
    syncEditableDOMSelectionToEditor({
      editor,
      scrollSelectionIntoView: vi.fn(),
      partialDOMBackedSelection: false,
      state,
    })

    expect(state.isUpdatingSelection).toBe(true)

    vi.runOnlyPendingTimers()

    expect(state.isUpdatingSelection).toBe(false)
    expect(state.selectionChangeOrigin).toBe('programmatic-export')
  } finally {
    editorElement.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
  }
})

test('model selection export is owned by the matching root view only', () => {
  const runtime = createEditorRuntime({
    initialValue: {
      roots: {
        child: [{ type: 'paragraph', children: [{ text: 'child' }] }],
        main: [{ type: 'paragraph', children: [{ text: 'main' }] }],
      },
    },
  })
  const mainEditor = createEditorView(runtime, { root: 'main' }) as any
  const childEditor = createEditorView(runtime, { root: 'child' }) as any

  childEditor.update((tx: any) => {
    tx.selection.set({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })
  })

  const childSelection = childEditor.read((state: any) => state.selection.get())

  expect(isSelectionInEditorView(mainEditor, childSelection)).toBe(false)
  expect(isSelectionInEditorView(childEditor, childSelection)).toBe(true)

  const resolveDOMRange = vi.spyOn(ReactEditor, 'resolveDOMRange')

  syncEditableDOMSelectionToEditor({
    editor: mainEditor,
    scrollSelectionIntoView: vi.fn(),
    partialDOMBackedSelection: false,
    state: {
      isUpdatingSelection: false,
      selectionChangeOrigin: null,
    },
  })

  expect(resolveDOMRange).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

test('model selection export preserves preferred collapsed DOM point', () => {
  vi.useFakeTimers()

  const editor = createReactEditor()
  const editorElement = document.createElement('div')
  const firstLine = document.createTextNode('first line')
  const secondLine = document.createTextNode('second line')
  const domSelection = document.getSelection()
  const selection = {
    anchor: { path: [0, 0], offset: firstLine.textContent!.length },
    focus: { path: [0, 0], offset: firstLine.textContent!.length },
  }

  if (!domSelection) {
    throw new Error('Expected document selection')
  }

  editorElement.setAttribute('data-slate-editor', 'true')
  editorElement.append(firstLine, secondLine)
  document.body.append(editorElement)

  Editor.replace(editor, {
    children: [
      {
        type: 'paragraph',
        children: [
          { text: `${firstLine.textContent}${secondLine.textContent}` },
        ],
      },
    ],
    selection,
  })

  vi.spyOn(ReactEditor, 'findDocumentOrShadowRoot').mockReturnValue(document)
  vi.spyOn(ReactEditor, 'assertDOMNode').mockReturnValue(editorElement)
  vi.spyOn(ReactEditor, 'resolveDOMRange').mockImplementation(() => {
    const fallbackRange = document.createRange()

    fallbackRange.setStart(firstLine, firstLine.textContent!.length)
    fallbackRange.setEnd(firstLine, firstLine.textContent!.length)

    return fallbackRange
  })

  writeCollapsedModelSelectionDOMPreference(editor, selection, {
    node: secondLine,
    offset: 0,
  })

  try {
    syncEditableDOMSelectionToEditor({
      editor,
      scrollSelectionIntoView: vi.fn(),
      partialDOMBackedSelection: false,
      state: {
        isUpdatingSelection: false,
        outsideFocusBoundarySettleUntil: 0,
        selectionChangeOrigin: null,
      },
    })

    expect(domSelection.anchorNode).toBe(secondLine)
    expect(domSelection.anchorOffset).toBe(0)
  } finally {
    editorElement.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
  }
})

test('native editor-owned selectionchange clears model preference before DOM import', () => {
  const inputController = createEditableInputController({
    preferModelSelectionForInputRef: { current: true },
    state: {
      activeIntent: null,
      isComposing: false,
      isDraggingInternally: false,
      isUpdatingSelection: false,
      latestElement: null,
      pendingDOMSelectionImport: false,
      selectionChangeOrigin: null,
      selectionSource: 'model-owned',
    },
  })

  expect(
    prepareEditableSelectionChangeImport({
      domSelectionBelongsToEditor: true,
      inputController,
      selectionChangeOrigin: 'native-user',
    })
  ).toBe(true)
  expect(inputController.preferModelSelectionForInputRef.current).toBe(false)
  expect(inputController.state.selectionSource).toBe('dom-current')
})

test('native selectionchange outside the editor does not clear model preference', () => {
  const inputController = createEditableInputController({
    preferModelSelectionForInputRef: { current: true },
    state: {
      activeIntent: null,
      isComposing: false,
      isDraggingInternally: false,
      isUpdatingSelection: false,
      latestElement: null,
      pendingDOMSelectionImport: false,
      selectionChangeOrigin: null,
      selectionSource: 'model-owned',
    },
  })

  expect(
    prepareEditableSelectionChangeImport({
      domSelectionBelongsToEditor: false,
      inputController,
      selectionChangeOrigin: 'native-user',
    })
  ).toBe(false)
  expect(inputController.preferModelSelectionForInputRef.current).toBe(true)
  expect(inputController.state.selectionSource).toBe('model-owned')
})

test('native editor-owned selectionchange with unresolved Slate range keeps model preference', () => {
  const inputController = createEditableInputController({
    preferModelSelectionForInputRef: { current: true },
    state: {
      activeIntent: null,
      isComposing: false,
      isDraggingInternally: false,
      isUpdatingSelection: false,
      latestElement: null,
      pendingDOMSelectionImport: false,
      selectionChangeOrigin: null,
      selectionSource: 'model-owned',
    },
  })

  expect(
    prepareEditableSelectionChangeImport({
      domSelectionBelongsToEditor: true,
      domSelectionCanImport: false,
      inputController,
      selectionChangeOrigin: 'native-user',
    })
  ).toBe(false)
  expect(inputController.preferModelSelectionForInputRef.current).toBe(true)
  expect(inputController.state.selectionSource).toBe('model-owned')
})

test('repair-induced editor-owned selectionchange does not clear model preference', () => {
  const inputController = createEditableInputController({
    preferModelSelectionForInputRef: { current: true },
    state: {
      activeIntent: null,
      isComposing: false,
      isDraggingInternally: false,
      isUpdatingSelection: false,
      latestElement: null,
      pendingDOMSelectionImport: false,
      selectionChangeOrigin: null,
      selectionSource: 'model-owned',
    },
  })

  expect(
    prepareEditableSelectionChangeImport({
      domSelectionBelongsToEditor: true,
      inputController,
      selectionChangeOrigin: 'repair-induced',
    })
  ).toBe(false)
  expect(inputController.preferModelSelectionForInputRef.current).toBe(true)
  expect(inputController.state.selectionSource).toBe('model-owned')
})

test('changed expanded DOM selection can override stale programmatic origin', () => {
  expect(
    shouldImportChangedExpandedDOMSelection({
      currentSelection: {
        anchor: { path: [0, 1], offset: 8 },
        focus: { path: [0, 1], offset: 8 },
      },
      nextSelection: {
        anchor: { path: [0, 1], offset: 0 },
        focus: { path: [0, 1], offset: 8 },
      },
      selectionChangeOrigin: 'programmatic-export',
    })
  ).toBe(true)
})

test('changed expanded DOM import ignores same, collapsed, and repair ranges', () => {
  const currentSelection = {
    anchor: { path: [0, 1], offset: 8 },
    focus: { path: [0, 1], offset: 8 },
  }

  expect(
    shouldImportChangedExpandedDOMSelection({
      currentSelection,
      nextSelection: currentSelection,
      selectionChangeOrigin: 'programmatic-export',
    })
  ).toBe(false)
  expect(
    shouldImportChangedExpandedDOMSelection({
      currentSelection,
      nextSelection: {
        anchor: { path: [0, 1], offset: 7 },
        focus: { path: [0, 1], offset: 7 },
      },
      selectionChangeOrigin: 'programmatic-export',
    })
  ).toBe(false)
  expect(
    shouldImportChangedExpandedDOMSelection({
      currentSelection,
      nextSelection: {
        anchor: { path: [0, 1], offset: 0 },
        focus: { path: [0, 1], offset: 8 },
      },
      selectionChangeOrigin: 'repair-induced',
    })
  ).toBe(false)
})

test('DOM selectionchange import only accepts native collapsed changes', () => {
  expect(
    shouldApplyDOMSelectionChange({
      changedExpandedDOMSelection: false,
      selectionChangeOrigin: 'native-user',
    })
  ).toBe(true)
  expect(
    shouldApplyDOMSelectionChange({
      changedExpandedDOMSelection: false,
      selectionChangeOrigin: 'programmatic-export',
    })
  ).toBe(false)
  expect(
    shouldApplyDOMSelectionChange({
      changedExpandedDOMSelection: false,
      selectionChangeOrigin: 'repair-induced',
    })
  ).toBe(false)
  expect(
    shouldApplyDOMSelectionChange({
      changedExpandedDOMSelection: true,
      selectionChangeOrigin: 'programmatic-export',
    })
  ).toBe(true)
})

test('model-owned programmatic selectionchange keeps its ownership guard', () => {
  const inputController = createEditableInputController({
    preferModelSelectionForInputRef: { current: true },
    state: {
      activeIntent: null,
      isComposing: false,
      isDraggingInternally: false,
      isUpdatingSelection: false,
      latestElement: null,
      pendingDOMSelectionImport: false,
      selectionChangeOrigin: 'programmatic-export',
      selectionSource: 'model-owned',
    },
  })

  completeEditableSelectionChangeImport({
    inputController,
    selectionChangeOrigin: 'programmatic-export',
  })

  expect(inputController.state.selectionChangeOrigin).toBe(
    'programmatic-export'
  )
  expect(inputController.preferModelSelectionForInputRef.current).toBe(true)
})

test('model-owned browser-handle selectionchange keeps its ownership guard', () => {
  const inputController = createEditableInputController({
    preferModelSelectionForInputRef: { current: true },
    state: {
      activeIntent: null,
      isComposing: false,
      isDraggingInternally: false,
      isUpdatingSelection: false,
      latestElement: null,
      pendingDOMSelectionImport: false,
      selectionChangeOrigin: 'browser-handle',
      selectionSource: 'model-owned',
    },
  })

  completeEditableSelectionChangeImport({
    inputController,
    selectionChangeOrigin: 'browser-handle',
  })

  expect(inputController.state.selectionChangeOrigin).toBe('browser-handle')
  expect(inputController.preferModelSelectionForInputRef.current).toBe(true)
})

test('repair-induced selectionchange clears its origin after model repair', () => {
  const inputController = createEditableInputController({
    preferModelSelectionForInputRef: { current: true },
    state: {
      activeIntent: null,
      isComposing: false,
      isDraggingInternally: false,
      isUpdatingSelection: false,
      latestElement: null,
      pendingDOMSelectionImport: false,
      selectionChangeOrigin: 'repair-induced',
      selectionSource: 'model-owned',
    },
  })

  completeEditableSelectionChangeImport({
    inputController,
    selectionChangeOrigin: 'repair-induced',
  })

  expect(inputController.state.selectionChangeOrigin).toBe(null)
  expect(inputController.preferModelSelectionForInputRef.current).toBe(true)
  expect(inputController.state.selectionSource).toBe('model-owned')
})

test('native selectionchange clears its origin after import handling', () => {
  const inputController = createEditableInputController({
    preferModelSelectionForInputRef: { current: false },
    state: {
      activeIntent: null,
      isComposing: false,
      isDraggingInternally: false,
      isUpdatingSelection: false,
      latestElement: null,
      pendingDOMSelectionImport: false,
      selectionChangeOrigin: 'native-user',
      selectionSource: 'dom-current',
    },
  })

  completeEditableSelectionChangeImport({
    inputController,
    selectionChangeOrigin: 'native-user',
  })

  expect(inputController.state.selectionChangeOrigin).toBe(null)
})

test('native insertText ignores stale repair and programmatic model preference', () => {
  for (const reason of ['programmatic-export', 'repair-induced'] as const) {
    const inputController = createEditableInputController({
      preferModelSelectionForInputRef: { current: true },
      state: {
        activeIntent: null,
        isComposing: false,
        isDraggingInternally: false,
        isUpdatingSelection: false,
        latestElement: null,
        pendingDOMSelectionImport: false,
        selectionChangeOrigin: reason,
        selectionSource: 'model-owned',
      },
    })

    setEditableModelSelectionPreference({
      inputController,
      preferModelSelection: true,
      reason,
      selectionSource: 'model-owned',
    })

    expect(
      isEditableModelSelectionPreferredForInput({
        inputController,
        inputType: 'insertText',
      })
    ).toBe(false)
    expect(
      isEditableModelSelectionPreferredForInput({
        inputController,
        inputType: 'deleteContentBackward',
      })
    ).toBe(true)
  }
})

test('native insertText preserves explicit model-owned input guards', () => {
  for (const reason of [
    'browser-handle',
    'composition',
    'internal-control',
    'model-command',
    'partial-dom-backed',
  ] as const) {
    const inputController = createEditableInputController({
      preferModelSelectionForInputRef: { current: true },
      state: {
        activeIntent: null,
        isComposing: false,
        isDraggingInternally: false,
        isUpdatingSelection: false,
        latestElement: null,
        pendingDOMSelectionImport: false,
        selectionChangeOrigin: null,
        selectionSource: 'model-owned',
      },
    })

    setEditableModelSelectionPreference({
      inputController,
      preferModelSelection: true,
      reason,
      selectionSource: 'model-owned',
    })

    expect(
      isEditableModelSelectionPreferredForInput({
        inputController,
        inputType: 'insertText',
      })
    ).toBe(true)
  }
})
